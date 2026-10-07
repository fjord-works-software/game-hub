// Snake rules as pure functions over an immutable state: no DOM, no canvas, no timers.
// Snake.svelte feeds in elapsed time and input, and draws whatever state comes back.
import type { Direction } from '../../core/input';

export interface Cell {
	x: number;
	y: number;
}

export interface SnakeState {
	/** The board is `size` x `size` cells. */
	size: number;
	/** Head first. */
	snake: Cell[];
	/** The direction of the most recent move. */
	direction: Direction;
	/** Turns waiting to be applied, one per move, so two quick presses within a move both count. */
	queue: Direction[];
	/** Null only once the snake fills the whole board. */
	food: Cell | null;
	score: number;
	/** The snake waits for the first input before moving. */
	started: boolean;
	over: boolean;
	/** Milliseconds accumulated towards the next move. */
	elapsed: number;
}

/** Returns a number in [0, 1), like Math.random; injectable so tests are deterministic. */
export type Random = () => number;

export const GRID_SIZE = 20;
const START_LENGTH = 3;
const MAX_QUEUED_TURNS = 2;

// Moves get faster as the snake eats, down to a floor.
const START_INTERVAL_MS = 150;
const INTERVAL_STEP_MS = 3;
const MIN_INTERVAL_MS = 70;

const OFFSETS: Record<Direction, Cell> = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 }
};

const OPPOSITES: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};

const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** Milliseconds between moves at a given score. */
export function moveInterval(score: number): number {
	return Math.max(MIN_INTERVAL_MS, START_INTERVAL_MS - score * INTERVAL_STEP_MS);
}

/** A random empty cell, or null if the snake covers the whole board. */
export function placeFood(size: number, snake: Cell[], random: Random): Cell | null {
	const free: Cell[] = [];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!snake.some((part) => part.x === x && part.y === y)) free.push({ x, y });
		}
	}
	if (free.length === 0) return null;
	return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
}

/** A new game: a short snake in the middle of the board, heading right, waiting for input. */
export function createGame(random: Random, size = GRID_SIZE): SnakeState {
	const head = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
	const snake = Array.from({ length: START_LENGTH }, (_, i) => ({ x: head.x - i, y: head.y }));
	return {
		size,
		snake,
		direction: 'right',
		queue: [],
		food: placeFood(size, snake, random),
		score: 0,
		started: false,
		over: false,
		elapsed: 0
	};
}

/** Start moving without turning (a tap or Space before the first move). */
export function start(state: SnakeState): SnakeState {
	return state.started || state.over ? state : { ...state, started: true };
}

/**
 * Queue a turn for an upcoming move. Turning back on itself or repeating the current heading is
 * ignored, compared against the last queued turn so a quick U-turn (e.g. up then left while moving
 * right) works over two moves. Any direction also starts the game.
 */
export function turn(state: SnakeState, direction: Direction): SnakeState {
	if (state.over) return state;
	const started = start(state);
	const heading = state.queue.at(-1) ?? state.direction;
	if (direction === heading || direction === OPPOSITES[heading] || state.queue.length >= MAX_QUEUED_TURNS) {
		return started;
	}
	return { ...started, queue: [...state.queue, direction] };
}

/** Move the snake one cell: apply the next queued turn, then eat, grow, or collide. */
export function step(state: SnakeState, random: Random): SnakeState {
	if (state.over) return state;

	const [next, ...queue] = state.queue;
	const direction = next ?? state.direction;
	const offset = OFFSETS[direction];
	const head = { x: state.snake[0].x + offset.x, y: state.snake[0].y + offset.y };
	const eating = state.food !== null && sameCell(head, state.food);

	// The tail moves out of its cell this move unless the snake is growing, so the head may enter it.
	const body = eating ? state.snake : state.snake.slice(0, -1);
	const hitWall = head.x < 0 || head.y < 0 || head.x >= state.size || head.y >= state.size;
	if (hitWall || body.some((part) => sameCell(part, head))) {
		return { ...state, direction, queue, over: true };
	}

	const snake = [head, ...body];
	if (!eating) return { ...state, snake, direction, queue };

	const food = placeFood(state.size, snake, random);
	return { ...state, snake, direction, queue, food, score: state.score + 1, over: food === null };
}

/** Advance the clock by `ms`, making as many moves as are due. Nothing moves before the game starts. */
export function advance(state: SnakeState, ms: number, random: Random): SnakeState {
	if (!state.started || state.over) return state;
	let current = { ...state, elapsed: state.elapsed + ms };
	while (!current.over && current.elapsed >= moveInterval(current.score)) {
		current = step({ ...current, elapsed: current.elapsed - moveInterval(current.score) }, random);
	}
	return current;
}
