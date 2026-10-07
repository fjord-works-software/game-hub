// Falling Blocks rules as pure functions over an immutable state: no DOM, no canvas, no timers.
// FallingBlocks.svelte feeds in elapsed time and input, and draws whatever state comes back.

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
/** 0 is the spawn orientation; each step is a quarter turn clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Cell {
	x: number;
	y: number;
}

/** A piece's position is the top-left corner of its bounding box on the board. */
export interface Piece {
	type: PieceType;
	rotation: Rotation;
	x: number;
	y: number;
}

/** Rows from top to bottom, each COLS wide; null is empty, otherwise the type of piece that locked there. */
export type Board = (PieceType | null)[][];

/** Full rows waiting to be removed: they stay on the board briefly so the game can animate them away. */
export interface Clearing {
	/** Indices of the full rows, top to bottom. */
	rows: number[];
	/** Milliseconds since the piece locked. */
	elapsed: number;
}

export interface FallingBlocksState {
	board: Board;
	piece: Piece;
	/** Upcoming pieces; queue[0] is shown as "next". */
	queue: PieceType[];
	score: number;
	lines: number;
	level: number;
	/** Pieces wait for the first input before falling. */
	started: boolean;
	over: boolean;
	/** Milliseconds accumulated towards the next gravity drop. */
	fallElapsed: number;
	/** Milliseconds the piece has spent resting on something. */
	lockElapsed: number;
	/** Moves and rotations that restarted the lock delay since the piece last reached a new lowest row. */
	lockResets: number;
	/** The lowest row the piece has reached. */
	lowestY: number;
	/**
	 * Set from the moment a piece completes rows until they're removed and the next piece arrives.
	 * Meanwhile `piece` is the piece that just locked (already part of the board), and input is ignored.
	 */
	clearing: Clearing | null;
}

/** Returns a number in [0, 1), like Math.random; injectable so tests are deterministic. */
export type Random = () => number;

export const COLS = 10;
export const VISIBLE_ROWS = 20;
/** Rows above the visible board, where pieces spawn and rotate. */
export const HIDDEN_ROWS = 2;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
/** The pause between completing rows and the next piece arriving, while the rows are animated away. */
const LINE_CLEAR_DELAY_MS = 300;
const LINES_PER_LEVEL = 10;
/** Points for clearing 0-4 lines at once, multiplied by the level. */
const LINE_SCORES = [0, 100, 300, 500, 800];
const SOFT_DROP_POINTS = 1;
const HARD_DROP_POINTS = 2;
/** Gravity stops speeding up past this level. */
const MAX_SPEED_LEVEL = 20;

// Spawn orientations. Rotating the matrix gives the other orientations (as in the Super Rotation System).
const SHAPES: Record<PieceType, number[][]> = {
	I: [
		[0, 0, 0, 0],
		[1, 1, 1, 1],
		[0, 0, 0, 0],
		[0, 0, 0, 0]
	],
	O: [
		[1, 1],
		[1, 1]
	],
	T: [
		[0, 1, 0],
		[1, 1, 1],
		[0, 0, 0]
	],
	S: [
		[0, 1, 1],
		[1, 1, 0],
		[0, 0, 0]
	],
	Z: [
		[1, 1, 0],
		[0, 1, 1],
		[0, 0, 0]
	],
	J: [
		[1, 0, 0],
		[1, 1, 1],
		[0, 0, 0]
	],
	L: [
		[0, 0, 1],
		[1, 1, 1],
		[0, 0, 0]
	]
};

const rotateClockwise = (matrix: number[][]) => matrix.map((_, i) => matrix.map((row) => row[i]).reverse());

/** The filled cells of each piece in each rotation, relative to its bounding box. */
const OFFSETS = Object.fromEntries(
	PIECE_TYPES.map((type) => {
		const rotations: Cell[][] = [];
		let matrix = SHAPES[type];
		for (let r = 0; r < 4; r++) {
			rotations.push(matrix.flatMap((row, y) => row.flatMap((filled, x) => (filled ? [{ x, y }] : []))));
			matrix = rotateClockwise(matrix);
		}
		return [type, rotations];
	})
) as Record<PieceType, Cell[][]>;

// Super Rotation System wall kicks: offsets tried in order when a rotation is blocked.
// The published tables count y upwards, so y is negated when applied to the board.
const KICKS: Record<string, [number, number][]> = {
	'0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
	'1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
	'1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
	'2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
	'2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
	'3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
	'3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
	'0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};
const I_KICKS: Record<string, [number, number][]> = {
	'0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
	'1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
	'1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
	'2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
	'2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
	'3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
	'3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
	'0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

/** A piece type's cells in a rotation, relative to its bounding box (for drawing the preview). */
export function shapeCells(type: PieceType, rotation: Rotation = 0): Cell[] {
	return OFFSETS[type][rotation];
}

/** The board cells a piece covers. */
export function cells(piece: Piece): Cell[] {
	return OFFSETS[piece.type][piece.rotation].map(({ x, y }) => ({ x: piece.x + x, y: piece.y + y }));
}

export function emptyBoard(): Board {
	return Array.from({ length: ROWS }, () => Array<PieceType | null>(COLS).fill(null));
}

export function collides(board: Board, piece: Piece): boolean {
	return cells(piece).some(({ x, y }) => x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x] !== null);
}

function grounded(board: Board, piece: Piece): boolean {
	return collides(board, { ...piece, y: piece.y + 1 });
}

/** How many rows a piece can fall before it lands. */
export function dropDistance(board: Board, piece: Piece): number {
	let distance = 0;
	while (!collides(board, { ...piece, y: piece.y + distance + 1 })) distance++;
	return distance;
}

/** Where the current piece would land: drawn as a guide. */
export function ghost(state: FallingBlocksState): Piece {
	return { ...state.piece, y: state.piece.y + dropDistance(state.board, state.piece) };
}

/** Milliseconds per row of gravity at a level (the standard curve: 1s at level 1, much faster later). */
export function fallInterval(level: number): number {
	const n = Math.min(level, MAX_SPEED_LEVEL) - 1;
	return 1000 * (0.8 - n * 0.007) ** n;
}

/**
 * Takes the next piece type from the queue, first topping it up with a shuffled "bag" of all seven
 * when it's running low, so the queue is never empty (there's always a "next" to show) and every
 * piece appears once in each run of seven.
 */
export function takeFromQueue(queue: PieceType[], random: Random): [PieceType, PieceType[]] {
	let full = queue;
	if (queue.length < 2) {
		const bag = [...PIECE_TYPES];
		for (let i = bag.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[bag[i], bag[j]] = [bag[j], bag[i]];
		}
		full = [...queue, ...bag];
	}
	return [full[0], full.slice(1)];
}

/** A new piece, centred at the top with its lowest row just inside the visible board. */
export function spawn(type: PieceType): Piece {
	const width = SHAPES[type][0].length;
	return { type, rotation: 0, x: Math.floor((COLS - width) / 2), y: HIDDEN_ROWS - 1 };
}

export function createGame(random: Random): FallingBlocksState {
	const [type, queue] = takeFromQueue([], random);
	const piece = spawn(type);
	return {
		board: emptyBoard(),
		piece,
		queue,
		score: 0,
		lines: 0,
		level: 1,
		started: false,
		over: false,
		fallElapsed: 0,
		lockElapsed: 0,
		lockResets: 0,
		lowestY: piece.y,
		clearing: null
	};
}

/** Whether there's a piece to control: not once the game is over, nor while full rows are being cleared. */
function controllable(state: FallingBlocksState): boolean {
	return !state.over && !state.clearing;
}

export function start(state: FallingBlocksState): FallingBlocksState {
	return state.started || state.over ? state : { ...state, started: true };
}

/** Replace the piece, noting a new lowest row (which earns back the lock-delay resets). */
function withPiece(state: FallingBlocksState, piece: Piece): FallingBlocksState {
	if (piece.y <= state.lowestY) return { ...state, piece };
	return { ...state, piece, lowestY: piece.y, lockResets: 0 };
}

/** After a successful move or rotation: if the piece was resting, restart its lock delay (a limited number of times). */
function shifted(state: FallingBlocksState, piece: Piece): FallingBlocksState {
	const wasResting = grounded(state.board, state.piece);
	const next = withPiece(state, piece);
	if (!wasResting || next.lockResets >= MAX_LOCK_RESETS) return next;
	return { ...next, lockElapsed: 0, lockResets: next.lockResets + 1 };
}

/** Clear full rows, dropping everything above them. */
export function clearLines(board: Board): { board: Board; cleared: number } {
	const kept = board.filter((row) => row.some((cell) => cell === null));
	const cleared = ROWS - kept.length;
	const fresh = Array.from({ length: cleared }, () => Array<PieceType | null>(COLS).fill(null));
	return { board: [...fresh, ...kept], cleared };
}

/** Bring in the next piece from the queue (or end the game if there's no room for it). */
function spawnNext(state: FallingBlocksState, random: Random): FallingBlocksState {
	const [type, queue] = takeFromQueue(state.queue, random);
	const piece = spawn(type);
	return {
		...state,
		piece,
		queue,
		over: collides(state.board, piece),
		fallElapsed: 0,
		lockElapsed: 0,
		lockResets: 0,
		lowestY: piece.y
	};
}

/**
 * Fix the piece in place and score any rows it completes. With no full rows the next piece arrives
 * at once; otherwise the rows stay for a moment while they're animated away (see `advance`).
 */
function lock(state: FallingBlocksState, random: Random): FallingBlocksState {
	const placed = cells(state.piece);
	const board = state.board.map((row) => [...row]);
	for (const { x, y } of placed) board[y][x] = state.piece.type;

	// Locking entirely above the visible board ends the game.
	if (placed.every(({ y }) => y < HIDDEN_ROWS)) return { ...state, board, over: true };

	const full = board.flatMap((row, y) => (row.every((cell) => cell !== null) ? [y] : []));
	if (full.length === 0) return spawnNext({ ...state, board }, random);
	const lines = state.lines + full.length;
	return {
		...state,
		board,
		score: state.score + LINE_SCORES[full.length] * state.level,
		lines,
		level: Math.floor(lines / LINES_PER_LEVEL) + 1,
		clearing: { rows: full, elapsed: 0 }
	};
}

/** Shift the piece one column left (-1) or right (1), if there's room. */
export function move(state: FallingBlocksState, dx: -1 | 1): FallingBlocksState {
	if (!controllable(state)) return state;
	const current = start(state);
	const piece = { ...current.piece, x: current.piece.x + dx };
	return collides(current.board, piece) ? current : shifted(current, piece);
}

/** Rotate a quarter turn (1 clockwise, -1 anticlockwise), trying wall kicks if the spot is blocked. */
export function rotate(state: FallingBlocksState, direction: 1 | -1 = 1): FallingBlocksState {
	if (!controllable(state)) return state;
	const current = start(state);
	const from = current.piece.rotation;
	const to = ((from + direction + 4) % 4) as Rotation;
	const kicks = current.piece.type === 'O' ? [[0, 0]] : (current.piece.type === 'I' ? I_KICKS : KICKS)[`${from}>${to}`];
	for (const [kx, ky] of kicks) {
		const piece = { ...current.piece, rotation: to, x: current.piece.x + kx, y: current.piece.y - ky };
		if (!collides(current.board, piece)) return shifted(current, piece);
	}
	return current;
}

/** Move down one row now (scoring a point), restarting the gravity timer. */
export function softDrop(state: FallingBlocksState): FallingBlocksState {
	if (!controllable(state)) return state;
	const current = start(state);
	const piece = { ...current.piece, y: current.piece.y + 1 };
	if (collides(current.board, piece)) return current;
	return { ...withPiece(current, piece), score: current.score + SOFT_DROP_POINTS, fallElapsed: 0 };
}

/** Drop straight to the bottom (2 points per row) and lock immediately. */
export function hardDrop(state: FallingBlocksState, random: Random): FallingBlocksState {
	if (!controllable(state)) return state;
	const current = start(state);
	const distance = dropDistance(current.board, current.piece);
	const piece = { ...current.piece, y: current.piece.y + distance };
	return lock({ ...current, piece, score: current.score + distance * HARD_DROP_POINTS }, random);
}

/**
 * Advance the clock by `ms`: gravity while falling, then the lock delay once resting, and the pause
 * while full rows are cleared. Nothing happens before the game starts.
 */
export function advance(state: FallingBlocksState, ms: number, random: Random): FallingBlocksState {
	if (!state.started || state.over) return state;

	if (state.clearing) {
		const elapsed = state.clearing.elapsed + ms;
		if (elapsed < LINE_CLEAR_DELAY_MS) return { ...state, clearing: { ...state.clearing, elapsed } };
		return spawnNext({ ...state, board: clearLines(state.board).board, clearing: null }, random);
	}

	if (grounded(state.board, state.piece)) {
		const lockElapsed = state.lockElapsed + ms;
		return lockElapsed >= LOCK_DELAY_MS ? lock(state, random) : { ...state, lockElapsed };
	}

	const interval = fallInterval(state.level);
	let fallElapsed = state.fallElapsed + ms;
	let piece = state.piece;
	while (fallElapsed >= interval) {
		const below = { ...piece, y: piece.y + 1 };
		if (collides(state.board, below)) {
			fallElapsed = 0;
			break;
		}
		piece = below;
		fallElapsed -= interval;
	}
	return { ...withPiece(state, piece), fallElapsed, lockElapsed: 0 };
}
