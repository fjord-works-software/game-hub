import { describe, expect, it } from 'vitest';
import {
	advance,
	createGame,
	GRID_SIZE,
	moveInterval,
	placeFood,
	start,
	step,
	turn,
	type Cell,
	type SnakeState
} from './logic';

/** Always picks the first free cell, so food placement is predictable. */
const first = () => 0;

/** A started game with a hand-placed snake and food. */
function game(snake: Cell[], overrides: Partial<SnakeState> = {}): SnakeState {
	return { ...createGame(first), snake, food: { x: 0, y: 0 }, started: true, ...overrides };
}

const at = (x: number, y: number): Cell => ({ x, y });

describe('createGame', () => {
	it('starts with a 3-long snake in the middle, heading right, waiting for input', () => {
		const state = createGame(first);
		expect(state.size).toBe(GRID_SIZE);
		expect(state.snake).toEqual([at(10, 10), at(9, 10), at(8, 10)]);
		expect(state.direction).toBe('right');
		expect(state.started).toBe(false);
		expect(state.score).toBe(0);
		expect(state.over).toBe(false);
	});

	it('places the first food off the snake', () => {
		for (const value of [0, 0.25, 0.5, 0.75, 0.9999]) {
			const state = createGame(() => value);
			expect(state.snake.some((part) => part.x === state.food!.x && part.y === state.food!.y)).toBe(false);
		}
	});
});

describe('starting', () => {
	it('does not move until the game starts', () => {
		const state = createGame(first);
		expect(advance(state, 10_000, first).snake).toEqual(state.snake);
	});

	it('starts on a tap or Space without turning', () => {
		const state = advance(start(createGame(first)), moveInterval(0), first);
		expect(state.snake[0]).toEqual(at(11, 10));
	});

	it('starts on any direction, turning if it can', () => {
		const state = advance(turn(createGame(first), 'up'), moveInterval(0), first);
		expect(state.snake[0]).toEqual(at(10, 9));
	});

	it('starts straight ahead if the first direction would reverse into the body', () => {
		const state = advance(turn(createGame(first), 'left'), moveInterval(0), first);
		expect(state.started).toBe(true);
		expect(state.snake[0]).toEqual(at(11, 10));
	});
});

describe('timing', () => {
	it('moves one cell per interval, carrying over partial time', () => {
		let state = start(createGame(first));
		state = advance(state, moveInterval(0) - 1, first);
		expect(state.snake[0]).toEqual(at(10, 10));
		state = advance(state, 1, first);
		expect(state.snake[0]).toEqual(at(11, 10));
		state = advance(state, moveInterval(0) * 2 + 5, first);
		expect(state.snake[0]).toEqual(at(13, 10));
		expect(state.elapsed).toBe(5);
	});

	it('speeds up as the score rises, down to a floor', () => {
		expect(moveInterval(0)).toBe(150);
		expect(moveInterval(10)).toBe(120);
		expect(moveInterval(10)).toBeLessThan(moveInterval(0));
		expect(moveInterval(1000)).toBe(70);
	});
});

describe('turning', () => {
	it('turns on the next move', () => {
		const state = step(turn(game([at(5, 5), at(4, 5), at(3, 5)]), 'down'), first);
		expect(state.snake[0]).toEqual(at(5, 6));
		expect(state.direction).toBe('down');
	});

	it('ignores reversing into itself and repeating the current heading', () => {
		const state = game([at(5, 5), at(4, 5), at(3, 5)]);
		expect(turn(state, 'left').queue).toEqual([]);
		expect(turn(state, 'right').queue).toEqual([]);
	});

	it('queues a second turn pressed within the same move, so a quick U-turn works', () => {
		// Moving right; up then left before the next move would otherwise be lost or reverse into the body.
		let state = turn(turn(game([at(5, 5), at(4, 5), at(3, 5)]), 'up'), 'left');
		expect(state.queue).toEqual(['up', 'left']);
		state = step(state, first);
		expect(state.snake[0]).toEqual(at(5, 4));
		state = step(state, first);
		expect(state.snake[0]).toEqual(at(4, 4));
		expect(state.over).toBe(false);
	});

	it('checks reversal against the last queued turn, not the current heading', () => {
		const state = turn(turn(game([at(5, 5), at(4, 5), at(3, 5)]), 'up'), 'down');
		expect(state.queue).toEqual(['up']);
	});

	it('keeps at most two queued turns', () => {
		const state = turn(turn(turn(game([at(5, 5), at(4, 5), at(3, 5)]), 'up'), 'left'), 'down');
		expect(state.queue).toEqual(['up', 'left']);
	});
});

describe('eating', () => {
	it('grows by one, scores a point, and places new food', () => {
		const state = step(game([at(5, 5), at(4, 5), at(3, 5)], { food: at(6, 5) }), first);
		expect(state.snake).toEqual([at(6, 5), at(5, 5), at(4, 5), at(3, 5)]);
		expect(state.score).toBe(1);
		expect(state.food).toEqual(at(0, 0));
	});

	it('moves without growing when not eating', () => {
		const state = step(game([at(5, 5), at(4, 5), at(3, 5)]), first);
		expect(state.snake).toEqual([at(6, 5), at(5, 5), at(4, 5)]);
		expect(state.score).toBe(0);
	});
});

describe('placeFood', () => {
	it('never places food on the snake', () => {
		// Snake covers every cell of the top row and most of the second on a 4x4 board.
		const snake = [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(3, 1), at(2, 1), at(1, 1)];
		for (let i = 0; i < 100; i++) {
			const food = placeFood(4, snake, () => i / 100)!;
			expect(snake.some((part) => part.x === food.x && part.y === food.y)).toBe(false);
		}
	});

	it('can reach every free cell', () => {
		const snake = [at(0, 0), at(1, 0)];
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			const food = placeFood(3, snake, () => i / 1000)!;
			seen.add(`${food.x},${food.y}`);
		}
		expect(seen.size).toBe(9 - snake.length);
	});

	it('returns null when the board is full', () => {
		expect(placeFood(2, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)], first)).toBeNull();
	});
});

describe('collisions', () => {
	it('ends the game at a wall', () => {
		const state = step(game([at(GRID_SIZE - 1, 5), at(GRID_SIZE - 2, 5), at(GRID_SIZE - 3, 5)]), first);
		expect(state.over).toBe(true);
	});

	it('ends the game when the head hits the body', () => {
		// A 5-long snake curled so that turning down runs into its own body.
		const snake = [at(5, 5), at(6, 5), at(6, 6), at(5, 6), at(4, 6)];
		const state = step(game(snake, { direction: 'left', queue: ['down'] }), first);
		expect(state.over).toBe(true);
	});

	it('lets the head move into the cell the tail is leaving', () => {
		// A 4-long snake in a tight square chases its own tail.
		const snake = [at(5, 5), at(5, 6), at(6, 6), at(6, 5)];
		const state = step(game(snake, { direction: 'up', queue: ['right'] }), first);
		expect(state.over).toBe(false);
		expect(state.snake[0]).toEqual(at(6, 5));
	});

	it('ends the game, as a win, when the snake fills the board', () => {
		// 2x2 board, 3-long snake, food in the last free cell.
		const state = step(
			game([at(0, 1), at(0, 0), at(1, 0)], { size: 2, direction: 'down', queue: ['right'], food: at(1, 1) }),
			first
		);
		expect(state.score).toBe(1);
		expect(state.food).toBeNull();
		expect(state.over).toBe(true);
	});

	it('stops moving once the game is over', () => {
		const over = step(game([at(GRID_SIZE - 1, 5), at(GRID_SIZE - 2, 5), at(GRID_SIZE - 3, 5)]), first);
		expect(advance(over, 10_000, first)).toBe(over);
		expect(turn(over, 'up')).toBe(over);
	});
});
