import { describe, expect, it } from 'vitest';
import {
	advance,
	cells,
	clearLines,
	collides,
	COLS,
	createGame,
	emptyBoard,
	fallInterval,
	ghost,
	hardDrop,
	HIDDEN_ROWS,
	move,
	rotate,
	ROWS,
	softDrop,
	spawn,
	takeFromQueue,
	type Board,
	type Cell,
	type Piece,
	type PieceType,
	type Random,
	type FallingBlocksState
} from './logic';

const first: Random = () => 0;

/** A small deterministic random sequence (a linear congruential generator). */
function seeded(seed: number): Random {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

/** A started game with a hand-placed piece (and optionally a board). */
function game(piece: Piece, overrides: Partial<FallingBlocksState> = {}): FallingBlocksState {
	return { ...createGame(first), piece, lowestY: piece.y, started: true, ...overrides };
}

/** A board whose bottom rows are drawn as text: '#' is a locked block, '.' is empty. */
function board(...rows: string[]): Board {
	const b = emptyBoard();
	rows.forEach((row, i) => {
		const y = ROWS - rows.length + i;
		[...row].forEach((ch, x) => {
			if (ch === '#') b[y][x] = 'Z';
		});
	});
	return b;
}

const sorted = (list: Cell[]) => [...list].sort((a, b) => a.y - b.y || a.x - b.x);
const at = (x: number, y: number): Cell => ({ x, y });
const piece = (type: PieceType, x: number, y: number, rotation: Piece['rotation'] = 0): Piece => ({ type, rotation, x, y });
const isEmpty = (b: Board) => b.every((row) => row.every((cell) => cell === null));

describe('createGame', () => {
	it('starts with an empty 10x22 board, a piece at the top, and a next piece, waiting for input', () => {
		const state = createGame(first);
		expect(state.board).toHaveLength(ROWS);
		expect(state.board.every((row) => row.length === COLS)).toBe(true);
		expect(isEmpty(state.board)).toBe(true);
		expect(state.piece.rotation).toBe(0);
		expect(state.queue.length).toBeGreaterThan(0);
		expect(state).toMatchObject({ score: 0, lines: 0, level: 1, started: false, over: false });
	});
});

describe('spawn', () => {
	it('centres pieces with their lowest row just inside the visible board', () => {
		expect(sorted(cells(spawn('T')))).toEqual([at(4, 1), at(3, 2), at(4, 2), at(5, 2)]);
		expect(sorted(cells(spawn('I')))).toEqual([at(3, 2), at(4, 2), at(5, 2), at(6, 2)]);
		expect(sorted(cells(spawn('O')))).toEqual([at(4, 1), at(5, 1), at(4, 2), at(5, 2)]);
		for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as PieceType[]) {
			expect(Math.max(...cells(spawn(type)).map((c) => c.y))).toBe(HIDDEN_ROWS);
		}
	});
});

describe('takeFromQueue (7-bag)', () => {
	it('deals every piece exactly once in each run of seven', () => {
		const random = seeded(42);
		let queue: PieceType[] = [];
		const dealt: PieceType[] = [];
		for (let i = 0; i < 21; i++) {
			const [type, rest] = takeFromQueue(queue, random);
			dealt.push(type);
			queue = rest;
		}
		for (let run = 0; run < 3; run++) {
			expect([...dealt.slice(run * 7, run * 7 + 7)].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
		}
	});

	it('always leaves a next piece to preview', () => {
		let queue: PieceType[] = [];
		for (let i = 0; i < 30; i++) {
			queue = takeFromQueue(queue, seeded(i))[1];
			expect(queue.length).toBeGreaterThan(0);
		}
	});
});

describe('starting', () => {
	it('nothing falls until the first input', () => {
		const state = createGame(first);
		expect(advance(state, 10_000, first).piece).toEqual(state.piece);
	});

	it('any move, rotation, or drop starts the game', () => {
		const state = createGame(first);
		expect(move(state, -1).started).toBe(true);
		expect(rotate(state).started).toBe(true);
		expect(softDrop(state).started).toBe(true);
		expect(hardDrop(state, first).started).toBe(true);
	});
});

describe('moving', () => {
	it('moves one column left or right', () => {
		const state = game(piece('T', 3, 5));
		expect(move(state, -1).piece.x).toBe(2);
		expect(move(state, 1).piece.x).toBe(4);
	});

	it('stops at the walls', () => {
		expect(move(game(piece('T', 0, 5)), -1).piece.x).toBe(0);
		expect(move(game(piece('T', 7, 5)), 1).piece.x).toBe(7);
	});

	it('stops at locked blocks', () => {
		// T at x=3 covers columns 3-5 on its lower row (row 21); a block sits at column 6.
		const state = game(piece('T', 3, 20), { board: board('......#...') });
		expect(move(state, 1).piece.x).toBe(3);
	});
});

describe('rotating', () => {
	it('turns clockwise through four orientations and back', () => {
		const start = game(piece('T', 3, 5));
		const once = rotate(start);
		expect(once.piece.rotation).toBe(1);
		// T pointing right: a vertical bar with a nub on the right.
		expect(sorted(cells(once.piece))).toEqual([at(4, 5), at(4, 6), at(5, 6), at(4, 7)]);
		const fourTimes = rotate(rotate(rotate(once)));
		expect(sorted(cells(fourTimes.piece))).toEqual(sorted(cells(start.piece)));
	});

	it('turns anticlockwise', () => {
		expect(rotate(game(piece('T', 3, 5)), -1).piece.rotation).toBe(3);
	});

	it('leaves the O piece where it is', () => {
		const state = game(piece('O', 4, 5));
		expect(sorted(cells(rotate(state).piece))).toEqual(sorted(cells(state.piece)));
	});

	it('kicks a piece off the left wall', () => {
		// T pointing right with its bar in column 0: pointing down would poke out of the board.
		const rotated = rotate(game(piece('T', -1, 5, 1)));
		expect(rotated.piece).toMatchObject({ rotation: 2, x: 0, y: 5 });
	});

	it('kicks the I piece off the wall using its own kick table', () => {
		// Vertical I in column 0; turning it flat needs it to move two columns right.
		const rotated = rotate(game(piece('I', -2, 5, 1)));
		expect(rotated.piece.rotation).toBe(2);
		expect(sorted(cells(rotated.piece))).toEqual([at(0, 7), at(1, 7), at(2, 7), at(3, 7)]);
	});

	it('kicks a piece up off the floor', () => {
		// T flat on the floor: pointing right would poke through the floor, so it kicks left and up.
		const rotated = rotate(game(piece('T', 3, 20)));
		expect(rotated.piece).toMatchObject({ rotation: 1, x: 2, y: 19 });
	});

	it('stays put when every kick is blocked', () => {
		const t = piece('T', 3, 10);
		const full = emptyBoard().map((row) => row.map((): PieceType | null => 'Z'));
		for (const { x, y } of cells(t)) full[y][x] = null;
		const state = game(t, { board: full });
		expect(rotate(state).piece).toEqual(t);
	});
});

describe('dropping', () => {
	it('soft drop moves down one row for a point', () => {
		const dropped = softDrop(game(piece('T', 3, 5)));
		expect(dropped.piece.y).toBe(6);
		expect(dropped.score).toBe(1);
	});

	it('soft drop does nothing (and scores nothing) on the floor', () => {
		const dropped = softDrop(game(piece('T', 3, 20)));
		expect(dropped.piece.y).toBe(20);
		expect(dropped.score).toBe(0);
	});

	it('hard drop lands, locks, scores 2 per row, and brings in the next piece', () => {
		const state = game(spawn('T'));
		const dropped = hardDrop(state, first);
		// From row 1 to row 20: 19 rows.
		expect(dropped.score).toBe(38);
		expect(dropped.board[21].slice(3, 6)).toEqual(['T', 'T', 'T']);
		expect(dropped.board[20][4]).toBe('T');
		expect(dropped.piece).toEqual(spawn(state.queue[0]));
		expect(dropped.queue).not.toEqual(state.queue);
		expect(dropped.clearing).toBeNull();
	});

	it('the ghost shows where the piece will land', () => {
		const state = game(piece('T', 3, 1), { board: board('##########', '##########') });
		expect(ghost(state)).toMatchObject({ x: 3, y: 18 });
		expect(state.piece.y).toBe(1);
	});
});

describe('gravity', () => {
	it('falls one row per interval at level 1', () => {
		let state = game(piece('T', 3, 1));
		state = advance(state, 999, first);
		expect(state.piece.y).toBe(1);
		state = advance(state, 1, first);
		expect(state.piece.y).toBe(2);
	});

	it('gets faster with each level, then levels off', () => {
		expect(fallInterval(1)).toBe(1000);
		expect(fallInterval(2)).toBeCloseTo(793, 0);
		expect(fallInterval(10)).toBeCloseTo(64.1, 0);
		expect(fallInterval(5)).toBeLessThan(fallInterval(4));
		expect(fallInterval(30)).toBe(fallInterval(20));
	});

	it('falls faster at higher levels', () => {
		// Level 5 is about 355ms per row: two rows in a second.
		expect(advance(game(piece('T', 3, 1), { level: 5 }), 1000, first).piece.y).toBe(3);
	});
});

describe('locking', () => {
	it('locks after resting on something for half a second', () => {
		let state = game(piece('T', 3, 20));
		state = advance(state, 499, first);
		expect(isEmpty(state.board)).toBe(true);
		state = advance(state, 1, first);
		expect(state.board[21].slice(3, 6)).toEqual(['T', 'T', 'T']);
	});

	it('moving or rotating while resting restarts the lock delay, up to 15 times', () => {
		let state = game(piece('T', 3, 20));
		for (let i = 0; i < 15; i++) {
			state = advance(state, 400, first);
			state = move(state, i % 2 === 0 ? -1 : 1);
		}
		expect(state.lockResets).toBe(15);
		expect(state.lockElapsed).toBe(0);
		expect(isEmpty(state.board)).toBe(true);

		state = advance(state, 400, first);
		state = move(state, -1); // the 16th move doesn't restart it
		expect(state.lockElapsed).toBe(400);
		state = advance(state, 100, first);
		expect(isEmpty(state.board)).toBe(false);
	});

	it('reaching a new lowest row earns the resets back', () => {
		const state = softDrop(game(piece('T', 3, 5), { lockResets: 15 }));
		expect(state.lockResets).toBe(0);
	});
});

describe('clearing lines', () => {
	it('removes full rows and drops the rows above', () => {
		const { board: cleared, cleared: count } = clearLines(board('#.........', '##########'));
		expect(count).toBe(1);
		expect(cleared[21][0]).toBe('Z');
		expect(cleared[21].slice(1).every((cell) => cell === null)).toBe(true);
		expect(cleared[20].every((cell) => cell === null)).toBe(true);
	});

	it('scores 100 / 300 / 500 / 800 for one to four lines at level 1', () => {
		for (const [rows, points] of [
			[1, 100],
			[2, 300],
			[3, 500],
			[4, 800]
		]) {
			// A vertical I dropped into column 0 completes `rows` rows; it falls 17 rows (34 points).
			const state = game(piece('I', -2, 1, 1), { board: board(...Array(rows).fill('.#########')) });
			const dropped = hardDrop(state, first);
			expect(dropped.lines).toBe(rows);
			expect(dropped.score).toBe(points + 34);
		}
	});

	it('moves what was above a cleared line down with it', () => {
		const state = game(piece('I', -2, 1, 1), { board: board('...#......', '.#########') });
		const cleared = advance(hardDrop(state, first), 300, first);
		expect(cleared.lines).toBe(1);
		expect(cleared.board[21][3]).toBe('Z');
		expect(cleared.board[21][0]).toBe('I');
	});

	it('pauses for 0.3 s with the full rows still on the board, then removes them and brings in the next piece', () => {
		const state = game(piece('I', -2, 1, 1), { board: board('.#########', '..........', '.#########') });
		const dropped = hardDrop(state, first);
		expect(dropped.clearing).toEqual({ rows: [19, 21], elapsed: 0 });
		expect(dropped.board[19].every((cell) => cell !== null)).toBe(true);
		expect(dropped.board[21].every((cell) => cell !== null)).toBe(true);
		// Scored straight away, so the score updates as the rows shatter.
		expect(dropped.lines).toBe(2);

		const waiting = advance(dropped, 299, first);
		expect(waiting.clearing?.elapsed).toBe(299);
		expect(waiting.piece).toEqual(dropped.piece);

		const next = advance(waiting, 1, first);
		expect(next.clearing).toBeNull();
		expect(next.piece).toEqual(spawn(dropped.queue[0]));
		// The I's cells in rows 18 and 20 are all that's left, now on the bottom two rows.
		expect(next.board[20][0]).toBe('I');
		expect(next.board[21][0]).toBe('I');
		expect(next.board[21].slice(1).every((cell) => cell === null)).toBe(true);
	});

	it('ignores input while the rows are being cleared', () => {
		const dropped = hardDrop(game(piece('I', -2, 1, 1), { board: board('.#########') }), first);
		expect(move(dropped, -1)).toBe(dropped);
		expect(rotate(dropped)).toBe(dropped);
		expect(softDrop(dropped)).toBe(dropped);
		expect(hardDrop(dropped, first)).toBe(dropped);
	});

	it('multiplies line points by the level, and levels up every 10 lines', () => {
		const clearOne = (state: FallingBlocksState) =>
			advance(hardDrop({ ...state, piece: piece('I', -2, 1, 1), lowestY: 1, board: board('.#########') }, first), 300, first);
		let state = clearOne(game(piece('T', 3, 1), { lines: 9 }));
		expect(state.score).toBe(100 + 34); // scored at level 1
		expect(state.lines).toBe(10);
		expect(state.level).toBe(2);
		state = clearOne(state);
		expect(state.score).toBe(134 + 200 + 34); // scored at level 2
	});
});

describe('game over', () => {
	it('ends when the next piece has no room', () => {
		const b = emptyBoard();
		for (let x = 3; x <= 6; x++) b[HIDDEN_ROWS][x] = 'Z';
		const state = hardDrop(game(piece('O', 0, 20), { board: b }), first);
		expect(state.over).toBe(true);
	});

	it('ends when the piece after a line clear has no room', () => {
		// Blocks in rows 1 and 2, out of the falling I's way. When the bottom row clears they drop to rows 2 and 3,
		// and every piece spawns partly in row 2.
		const b = board('.#########');
		for (let x = 3; x <= 6; x++) b[1][x] = b[2][x] = 'Z';
		const dropped = hardDrop(game(piece('I', -2, 1, 1), { board: b }), first);
		expect(dropped.over).toBe(false);
		expect(advance(dropped, 300, first).over).toBe(true);
	});

	it('ends when a piece locks entirely above the visible board', () => {
		const b = emptyBoard();
		b[HIDDEN_ROWS][4] = 'Z';
		b[HIDDEN_ROWS][5] = 'Z';
		const state = game(piece('O', 4, 0), { board: b });
		expect(collides(b, state.piece)).toBe(false);
		expect(advance(state, 500, first).over).toBe(true);
	});

	it('ignores input and time once over', () => {
		const over = { ...game(piece('T', 3, 5)), over: true };
		expect(move(over, -1)).toBe(over);
		expect(rotate(over)).toBe(over);
		expect(softDrop(over)).toBe(over);
		expect(hardDrop(over, first)).toBe(over);
		expect(advance(over, 1000, first)).toBe(over);
	});
});
