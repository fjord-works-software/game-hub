import { describe, expect, it } from 'vitest';
import {
	advance,
	BALL_SIZE,
	BRICK_HEIGHT,
	BRICK_WIDTH,
	BRICKS_TOP,
	brickBox,
	buildLevel,
	CEILING,
	CLEAR_BONUS,
	CLEAR_MS,
	COLS,
	createGame,
	HEIGHT,
	LAYOUTS,
	launch,
	levelSpeed,
	movePaddle,
	PADDLE_WIDTH,
	PADDLE_Y,
	POINTS,
	START_LIVES,
	WIDTH,
	type Ball,
	type Brick,
	type BrickBashState
} from './logic';

const HALF = BALL_SIZE / 2;
const STEP = 1000 / 60;

/** A game in play with a hand-placed ball and bricks. */
function playing(ball: Ball, bricks: Brick[] = [], overrides: Partial<BrickBashState> = {}): BrickBashState {
	return { ...createGame(), phase: 'play', ball, bricks, ...overrides };
}

/** A brick far out of the way, so a level isn't cleared by accident. */
const spare: Brick = { col: 0, row: 0, colour: 'blue', hits: 1 };

/** Runs the game for `ms`, in the loop's fixed steps. */
function run(state: BrickBashState, ms: number): BrickBashState {
	for (let t = 0; t < ms; t += STEP) state = advance(state, STEP);
	return state;
}

describe('levels', () => {
	it('has layouts exactly 12 columns wide', () => {
		for (const layout of LAYOUTS) for (const line of layout) expect(line).toHaveLength(COLS);
	});

	it('builds bricks from a layout, with tough ones taking two hits', () => {
		const bricks = buildLevel(2);
		expect(bricks[0]).toEqual({ col: 5, row: 0, colour: 'tough', hits: 2 });
		expect(bricks.filter((brick) => brick.row === 2)).toHaveLength(6);
		expect(bricks.find((brick) => brick.colour === 'red')).toMatchObject({ hits: 1 });
	});

	it('comes back round to the first layout after the last', () => {
		expect(buildLevel(LAYOUTS.length + 1)).toEqual(buildLevel(1));
	});

	it('starts each level a bit faster, up to a limit', () => {
		expect(levelSpeed(2)).toBeGreaterThan(levelSpeed(1));
		expect(levelSpeed(50)).toBe(levelSpeed(100));
	});

	it('places bricks in a grid that fills the width', () => {
		expect(BRICK_WIDTH * COLS).toBe(WIDTH);
		expect(brickBox({ col: 11, row: 2, colour: 'red', hits: 1 })).toEqual({
			left: 11 * BRICK_WIDTH,
			top: BRICKS_TOP + 2 * BRICK_HEIGHT,
			right: WIDTH,
			bottom: BRICKS_TOP + 3 * BRICK_HEIGHT
		});
	});
});

describe('serving', () => {
	it('starts on level 1 with the ball resting on the middle of the paddle', () => {
		const state = createGame();
		expect(state).toMatchObject({ phase: 'serve', level: 1, lives: START_LIVES, score: 0, paddle: WIDTH / 2 });
		expect(state.ball).toEqual({ x: WIDTH / 2, y: PADDLE_Y - HALF, vx: 0, vy: 0 });
	});

	it('carries the waiting ball with the paddle, which stays inside the walls', () => {
		let state = movePaddle(createGame(), 50);
		expect(state.ball.x).toBe(50);
		state = movePaddle(state, -100);
		expect(state.paddle).toBe(PADDLE_WIDTH / 2);
		state = movePaddle(state, 1000);
		expect(state.paddle).toBe(WIDTH - PADDLE_WIDTH / 2);
	});

	it('leaves the ball alone once it is in play', () => {
		const ball = { x: 100, y: 200, vx: 0, vy: -100 };
		expect(movePaddle(playing(ball, [spare]), 30).ball).toEqual(ball);
	});

	it('launches up and to one side, at the level speed', () => {
		const left = launch(createGame(), () => 0.2);
		const right = launch(createGame(), () => 0.8);
		expect(left.phase).toBe('play');
		expect(left.ball.vx).toBeLessThan(0);
		expect(right.ball.vx).toBeGreaterThan(0);
		for (const { ball } of [left, right]) {
			expect(ball.vy).toBeLessThan(0);
			expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(levelSpeed(1));
			// Never flat: well above 45 degrees.
			expect(Math.abs(ball.vy)).toBeGreaterThan(Math.abs(ball.vx));
		}
	});

	it('only launches a waiting ball', () => {
		const state = playing({ x: 100, y: 200, vx: 0, vy: -100 }, [spare]);
		expect(launch(state, () => 0.5)).toBe(state);
	});

	it('keeps the ball still until it is launched', () => {
		const state = run(createGame(), 1000);
		expect(state.phase).toBe('serve');
		expect(state.ball).toEqual(createGame().ball);
	});
});

describe('bouncing', () => {
	it('bounces off the side walls and the ceiling', () => {
		let state = playing({ x: HALF + 1, y: 200, vx: -120, vy: 0 }, [spare], { speed: 120 });
		state = run(state, 100);
		expect(state.ball.vx).toBe(120);
		expect(state.ball.x).toBeGreaterThan(HALF);

		state = playing({ x: WIDTH - HALF - 1, y: 200, vx: 120, vy: 0 }, [spare], { speed: 120 });
		expect(run(state, 100).ball.vx).toBe(-120);

		state = playing({ x: 200, y: CEILING + HALF + 1, vx: 0, vy: -120 }, [spare], { speed: 120 });
		state = run(state, 100);
		expect(state.ball.vy).toBe(120);
		expect(state.ball.y - HALF).toBeGreaterThanOrEqual(CEILING);
	});

	it('bounces straight back up off the middle of the paddle', () => {
		const state = run(playing({ x: WIDTH / 2, y: PADDLE_Y - 10, vx: 0, vy: 120 }, [spare], { speed: 120 }), 200);
		expect(state.ball.vy).toBeLessThan(0);
		expect(state.ball.vx).toBeCloseTo(0);
	});

	it('angles the ball towards whichever end of the paddle it hits', () => {
		const at = (x: number) =>
			run(playing({ x, y: PADDLE_Y - 10, vx: 0, vy: 120 }, [spare], { speed: 120 }), 200).ball;
		const left = at(WIDTH / 2 - PADDLE_WIDTH / 2 + 2);
		const right = at(WIDTH / 2 + PADDLE_WIDTH / 4);
		expect(left.vx).toBeLessThan(0);
		expect(right.vx).toBeGreaterThan(0);
		expect(Math.abs(left.vx)).toBeGreaterThan(Math.abs(right.vx)); // the end is steeper than halfway
		for (const ball of [left, right]) {
			expect(ball.vy).toBeLessThan(0);
			// Even off the very end, it never goes flatter than 60 degrees from straight up.
			expect(Math.abs(ball.vy)).toBeGreaterThanOrEqual(120 * Math.cos(Math.PI / 3) - 1e-9);
			expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(120);
		}
	});

	it('lets a ball that misses the paddle fall past it', () => {
		const state = run(playing({ x: 10, y: PADDLE_Y - 10, vx: 0, vy: 120 }, [spare], { speed: 120 }), 200);
		expect(state.ball.vy).toBeGreaterThan(0);
		expect(state.ball.y).toBeGreaterThan(PADDLE_Y);
	});
});

describe('bricks', () => {
	const target: Brick = { col: 6, row: 4, colour: 'yellow', hits: 1 };
	const box = brickBox(target);
	const centreX = (box.left + box.right) / 2;

	it('breaks a brick hit from below, scores it, and sends the ball back down', () => {
		const state = run(playing({ x: centreX, y: box.bottom + 6, vx: 0, vy: -150 }, [target, spare], { speed: 150 }), 100);
		expect(state.bricks).toEqual([spare]);
		expect(state.score).toBe(POINTS.yellow);
		expect(state.ball.vy).toBeGreaterThan(0);
	});

	it('bounces sideways off the side of a brick', () => {
		const y = (box.top + box.bottom) / 2;
		const state = run(playing({ x: box.left - 6, y, vx: 150, vy: 0 }, [target, spare], { speed: 150 }), 100);
		expect(state.bricks).toEqual([spare]);
		expect(state.ball.vx).toBeLessThan(0);
	});

	it('takes two hits to break a tough brick, scoring only when it breaks', () => {
		const tough: Brick = { ...target, colour: 'tough', hits: 2 };
		let state = run(playing({ x: centreX, y: box.bottom + 6, vx: 0, vy: -150 }, [tough, spare], { speed: 150 }), 100);
		expect(state.bricks).toEqual([{ ...tough, hits: 1 }, spare]);
		expect(state.score).toBe(0);
		state = run({ ...state, ball: { x: centreX, y: box.bottom + 6, vx: 0, vy: -150 } }, 100);
		expect(state.bricks).toEqual([spare]);
		expect(state.score).toBe(POINTS.tough);
	});

	it('cannot slip through a row of bricks, even at top speed', () => {
		const row = Array.from({ length: COLS }, (_, col): Brick => ({ col, row: 6, colour: 'blue', hits: 1 }));
		const speed = levelSpeed(100) * 1.35;
		let state = playing({ x: 33, y: brickBox(row[0]).bottom + 40, vx: 0, vy: -speed }, [...row, spare], { speed });
		state = run(state, 400);
		expect(state.bricks).toHaveLength(COLS); // one broken
		expect(state.ball.vy).toBeGreaterThan(0);
		expect(state.ball.y).toBeGreaterThan(brickBox(row[0]).bottom);
	});

	it('speeds the ball up a little with each hit, to a limit', () => {
		const state = run(playing({ x: centreX, y: box.bottom + 6, vx: 0, vy: -150 }, [target, spare], { speed: 150 }), 100);
		expect(state.speed).toBeCloseTo(150 * 1.01);
		expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeCloseTo(state.speed);

		const capped = levelSpeed(1) * 1.35;
		const fast = run(playing({ x: centreX, y: box.bottom + 6, vx: 0, vy: -capped }, [target, spare], { speed: capped }), 50);
		expect(fast.speed).toBeCloseTo(capped);
	});
});

describe('lives and levels', () => {
	it('loses a life when the ball falls out, and serves the next at the level speed', () => {
		const state = run(playing({ x: 10, y: HEIGHT - 5, vx: 0, vy: 200 }, [spare], { speed: 200 }), 100);
		expect(state.phase).toBe('serve');
		expect(state.lives).toBe(START_LIVES - 1);
		expect(state.speed).toBe(levelSpeed(1));
		expect(state.ball).toMatchObject({ x: state.paddle, vx: 0, vy: 0 });
	});

	it('ends the game when the last ball is lost', () => {
		const state = run(playing({ x: 10, y: HEIGHT - 5, vx: 0, vy: 200 }, [spare], { speed: 200, lives: 1 }), 100);
		expect(state.phase).toBe('over');
		expect(state.lives).toBe(0);
	});

	it('scores a bonus for clearing a level, pauses, then serves the next level', () => {
		const target: Brick = { col: 6, row: 4, colour: 'red', hits: 1 };
		const box = brickBox(target);
		let state = playing({ x: box.left + 10, y: box.bottom + 6, vx: 0, vy: -150 }, [target], { speed: 150, score: 7 });
		state = run(state, 100);
		expect(state.phase).toBe('cleared');
		expect(state.score).toBe(7 + POINTS.red + CLEAR_BONUS);

		state = run(state, CLEAR_MS - 200);
		expect(state.phase).toBe('cleared');
		state = run(state, 300);
		expect(state).toMatchObject({ phase: 'serve', level: 2, speed: levelSpeed(2) });
		expect(state.bricks).toEqual(buildLevel(2));
		expect(state.ball).toMatchObject({ x: state.paddle, vx: 0, vy: 0 });
	});

	it('stops moving once the game is over', () => {
		const over: BrickBashState = { ...createGame(), phase: 'over', lives: 0 };
		expect(movePaddle(over, 10)).toBe(over);
		expect(launch(over, () => 0.5)).toBe(over);
	});
});
