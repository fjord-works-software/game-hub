// Brick Bash rules as pure functions over an immutable state: no DOM, no canvas, no timers.
// BrickBash.svelte feeds in elapsed time, paddle moves, and launches, and draws whatever state comes back.
// Everything is in world units: pixels of a 240x320 field, which the component scales to fit.

/** Returns a number in [0, 1), like Math.random; injectable so tests are deterministic. */
export type Random = () => number;

export const WIDTH = 240;
export const HEIGHT = 320;
/** The strip above the ceiling, where the level and lives are shown. */
export const CEILING = 16;

export const COLS = 12;
export const BRICK_WIDTH = WIDTH / COLS;
export const BRICK_HEIGHT = 8;
/** Space left above the bricks, so a ball that breaks through can bounce around behind them. */
export const BRICKS_TOP = CEILING + 24;

export const PADDLE_WIDTH = 36;
export const PADDLE_HEIGHT = 6;
/** The top of the paddle, the only side the ball bounces off. */
export const PADDLE_Y = 292;
/** How fast (world px per second) a held key or button moves the paddle. */
export const PADDLE_SPEED = 240;

/** The ball is a square this many world px across. */
export const BALL_SIZE = 5;
const HALF = BALL_SIZE / 2;

export const START_LIVES = 3;
/** World px per second at the start of level 1. */
const BASE_SPEED = 160;
/** Each level starts this much faster than the last, up to MAX_LEVEL_GAIN. */
const LEVEL_GAIN = 0.06;
const MAX_LEVEL_GAIN = 0.5;
/** Each brick hit speeds the ball up by this much, to at most MAX_HIT_GAIN over the level's speed. */
const HIT_GAIN = 0.01;
const MAX_HIT_GAIN = 0.35;
/** The steepest a ball leaves the paddle, from straight up, when it hits an end. */
const MAX_BOUNCE_ANGLE = Math.PI / 3;
/** Launches go up at a random angle from straight up between these. */
const MIN_LAUNCH_ANGLE = Math.PI / 18;
const MAX_LAUNCH_ANGLE = Math.PI / 6;
/** The furthest the ball moves in one collision check, well under a brick's height so it can't skip one. */
const MAX_MOVE = 2;

/** How long "Level clear" shows before the next level. */
export const CLEAR_MS = 1500;
/** Clearing a level scores this many points times the level number. */
export const CLEAR_BONUS = 100;

/** A brick's colour, from the bottom rows up, then the tough grey brick that takes two hits. */
export type Colour = 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'tough';

export const POINTS: Record<Colour, number> = {
	blue: 10,
	cyan: 10,
	green: 20,
	yellow: 30,
	orange: 40,
	red: 50,
	tough: 60
};

const COLOUR_CODES: Record<string, Colour> = {
	b: 'blue',
	c: 'cyan',
	g: 'green',
	y: 'yellow',
	o: 'orange',
	r: 'red',
	'#': 'tough'
};

/**
 * The hand-made levels, one string per row of 12 columns: a letter is a brick of that colour, `#` a
 * tough brick, and `.` a gap. After the last, they come round again, faster.
 */
export const LAYOUTS: string[][] = [
	// The classic rainbow wall.
	['rrrrrrrrrrrr', 'oooooooooooo', 'yyyyyyyyyyyy', 'gggggggggggg', 'cccccccccccc', 'bbbbbbbbbbbb'],
	// A pyramid with a tough cap.
	['.....##.....', '....#rr#....', '...oooooo...', '..yyyyyyyy..', '.gggggggggg.', 'cccccccccccc', 'bbbbbbbbbbbb'],
	// A checkerboard under a tough roof.
	['############', 'r.r.r.r.r.r.', '.o.o.o.o.o.o', 'y.y.y.y.y.y.', '.g.g.g.g.g.g', 'c.c.c.c.c.c.'],
	// A space invader.
	['..g......g..', '...g....g...', '..gggggggg..', '.gg.gggg.gg.', 'gggggggggggg', 'g.gggggggg.g', 'g.g......g.g', '...gg..gg...'],
	// A fortress.
	['##.######.##', '#rrrrrrrrrr#', '#o########o#', '#oooooooooo#', '#yy#yyyy#yy#', '#gggggggggg#']
];

export interface Brick {
	col: number;
	row: number;
	colour: Colour;
	/** Hits left before it breaks. */
	hits: number;
}

export interface Ball {
	/** The centre of the ball. */
	x: number;
	y: number;
	/** World px per second. */
	vx: number;
	vy: number;
}

/**
 * serve: the ball sits on the paddle until it's launched (at the start, after a lost ball, and on a
 * new level). play: the ball is moving. cleared: a pause after a level's last brick. over: the game has ended.
 */
export type Phase = 'serve' | 'play' | 'cleared' | 'over';

export interface BrickBashState {
	phase: Phase;
	/** Ms since the phase began. */
	phaseElapsed: number;
	/** From 1. */
	level: number;
	lives: number;
	score: number;
	/** The centre of the paddle. */
	paddle: number;
	ball: Ball;
	bricks: Brick[];
	/** The ball's speed, in world px per second. */
	speed: number;
}

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** The bricks of a level, from its layout. */
export function buildLevel(level: number): Brick[] {
	const layout = LAYOUTS[(level - 1) % LAYOUTS.length];
	const bricks: Brick[] = [];
	layout.forEach((line, row) => {
		[...line].forEach((code, col) => {
			const colour = COLOUR_CODES[code];
			if (colour) bricks.push({ col, row, colour, hits: colour === 'tough' ? 2 : 1 });
		});
	});
	return bricks;
}

/** The ball's speed at the start of a level. */
export function levelSpeed(level: number): number {
	return BASE_SPEED * (1 + Math.min(MAX_LEVEL_GAIN, LEVEL_GAIN * (level - 1)));
}

export function brickBox({ col, row }: Brick): Box {
	const left = col * BRICK_WIDTH;
	const top = BRICKS_TOP + row * BRICK_HEIGHT;
	return { left, top, right: left + BRICK_WIDTH, bottom: top + BRICK_HEIGHT };
}

export function paddleBox(paddle: number): Box {
	return { left: paddle - PADDLE_WIDTH / 2, top: PADDLE_Y, right: paddle + PADDLE_WIDTH / 2, bottom: PADDLE_Y + PADDLE_HEIGHT };
}

/** A still ball resting on the middle of the paddle. */
function restingBall(paddle: number): Ball {
	return { x: paddle, y: PADDLE_Y - HALF, vx: 0, vy: 0 };
}

const clampPaddle = (x: number) => Math.min(WIDTH - PADDLE_WIDTH / 2, Math.max(PADDLE_WIDTH / 2, x));

/** A new game: level 1, the ball on the paddle, waiting to be launched. */
export function createGame(): BrickBashState {
	const paddle = WIDTH / 2;
	return {
		phase: 'serve',
		phaseElapsed: 0,
		level: 1,
		lives: START_LIVES,
		score: 0,
		paddle,
		ball: restingBall(paddle),
		bricks: buildLevel(1),
		speed: levelSpeed(1)
	};
}

/** Move the paddle's centre to `x` (kept inside the walls); a ball waiting to be served goes with it. */
export function movePaddle(state: BrickBashState, x: number): BrickBashState {
	if (state.phase === 'over') return state;
	const paddle = clampPaddle(x);
	if (paddle === state.paddle) return state;
	return { ...state, paddle, ball: state.phase === 'serve' ? restingBall(paddle) : state.ball };
}

/** Send a waiting ball up, at a random angle to one side. Does nothing unless the ball is being served. */
export function launch(state: BrickBashState, random: Random): BrickBashState {
	if (state.phase !== 'serve') return state;
	const side = random() < 0.5 ? -1 : 1;
	const angle = side * (MIN_LAUNCH_ANGLE + random() * (MAX_LAUNCH_ANGLE - MIN_LAUNCH_ANGLE));
	const ball = { ...state.ball, vx: state.speed * Math.sin(angle), vy: -state.speed * Math.cos(angle) };
	return { ...state, phase: 'play', phaseElapsed: 0, ball };
}

const overlaps = (ball: Ball, box: Box) =>
	ball.x + HALF > box.left && ball.x - HALF < box.right && ball.y + HALF > box.top && ball.y - HALF < box.bottom;

/** Advance the game by `ms` milliseconds. */
export function advance(state: BrickBashState, ms: number): BrickBashState {
	const phaseElapsed = state.phaseElapsed + ms;
	switch (state.phase) {
		case 'cleared':
			if (phaseElapsed < CLEAR_MS) return { ...state, phaseElapsed };
			return nextLevel(state);
		case 'play':
			return moveBall({ ...state, phaseElapsed }, ms);
		default:
			return { ...state, phaseElapsed };
	}
}

function nextLevel(state: BrickBashState): BrickBashState {
	const level = state.level + 1;
	return {
		...state,
		phase: 'serve',
		phaseElapsed: 0,
		level,
		ball: restingBall(state.paddle),
		bricks: buildLevel(level),
		speed: levelSpeed(level)
	};
}

/**
 * Moves the ball in small steps, one axis at a time, so it bounces off whichever side of a brick it
 * actually hit. Every brick it touches in a step takes a hit.
 */
function moveBall(state: BrickBashState, ms: number): BrickBashState {
	const ball = { ...state.ball };
	let { bricks, score, speed } = state;
	const distance = (speed * ms) / 1000;
	const steps = Math.max(1, Math.ceil(distance / MAX_MOVE));
	const dt = ms / 1000 / steps;

	/** Hits every brick the ball overlaps, returning whether there were any. */
	const hitBricks = () => {
		const hit = bricks.filter((brick) => overlaps(ball, brickBox(brick)));
		if (hit.length === 0) return false;
		bricks = bricks.flatMap((brick) => {
			if (!hit.includes(brick)) return [brick];
			if (brick.hits > 1) return [{ ...brick, hits: brick.hits - 1 }];
			score += POINTS[brick.colour];
			return [];
		});
		// Each hit speeds the ball up a little, to a limit for the level.
		const faster = Math.min(levelSpeed(state.level) * (1 + MAX_HIT_GAIN), speed * (1 + HIT_GAIN) ** hit.length);
		ball.vx *= faster / speed;
		ball.vy *= faster / speed;
		speed = faster;
		return true;
	};

	for (let i = 0; i < steps; i++) {
		// Across: the side walls, then the sides of bricks.
		const fromX = ball.x;
		ball.x += ball.vx * dt;
		if (ball.x - HALF < 0) {
			ball.x = HALF;
			ball.vx = Math.abs(ball.vx);
		} else if (ball.x + HALF > WIDTH) {
			ball.x = WIDTH - HALF;
			ball.vx = -Math.abs(ball.vx);
		}
		if (hitBricks()) {
			ball.x = fromX;
			ball.vx = -ball.vx;
		}

		// Up and down: the ceiling, the tops and bottoms of bricks, then the paddle.
		const fromY = ball.y;
		ball.y += ball.vy * dt;
		if (ball.y - HALF < CEILING) {
			ball.y = CEILING + HALF;
			ball.vy = Math.abs(ball.vy);
		}
		if (hitBricks()) {
			ball.y = fromY;
			ball.vy = -ball.vy;
		}
		const paddle = paddleBox(state.paddle);
		const crossedTop = fromY + HALF <= PADDLE_Y && ball.y + HALF >= PADDLE_Y;
		if (ball.vy > 0 && crossedTop && ball.x + HALF > paddle.left && ball.x - HALF < paddle.right) {
			// Where it lands sets the angle: straight up from the middle, steeper towards the ends.
			const offset = Math.max(-1, Math.min(1, (ball.x - state.paddle) / (PADDLE_WIDTH / 2 + HALF)));
			const angle = offset * MAX_BOUNCE_ANGLE;
			ball.y = PADDLE_Y - HALF;
			ball.vx = speed * Math.sin(angle);
			ball.vy = -speed * Math.cos(angle);
		}

		if (bricks.length === 0) {
			score += CLEAR_BONUS * state.level;
			return { ...state, phase: 'cleared', phaseElapsed: 0, ball, bricks, score, speed };
		}
		if (ball.y - HALF > HEIGHT) return loseBall({ ...state, bricks, score });
	}
	return { ...state, ball, bricks, score, speed };
}

/** The ball fell past the paddle: a life is lost, and the next ball is served at the level's speed. */
function loseBall(state: BrickBashState): BrickBashState {
	const lives = state.lives - 1;
	if (lives === 0) return { ...state, phase: 'over', phaseElapsed: 0, lives };
	return {
		...state,
		phase: 'serve',
		phaseElapsed: 0,
		lives,
		ball: restingBall(state.paddle),
		speed: levelSpeed(state.level)
	};
}
