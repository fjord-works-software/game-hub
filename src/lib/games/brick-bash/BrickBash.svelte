<script lang="ts">
	import { onMount } from 'svelte';
	import { fitCanvas, type CanvasSize } from '../../core/canvas';
	import { createGameLoop, type GameLoop } from '../../core/gameLoop';
	import { bindInput, type Point } from '../../core/input';
	import type { GameProps } from '../../core/types';
	import {
		advance,
		BALL_SIZE,
		brickBox,
		CEILING,
		CLEAR_BONUS,
		createGame,
		HEIGHT,
		launch,
		movePaddle,
		PADDLE_SPEED,
		paddleBox,
		WIDTH,
		type Box,
		type Brick,
		type BrickBashState,
		type Colour
	} from './logic';

	let { paused, onScore, onGameOver }: GameProps = $props();

	// Colours from the app palette (see app.css).
	const BACKGROUND = '#1a1c2c';
	const FIELD = '#21263a';
	const CEILING_LINE = '#333c57';
	const PADDLE = '#73eff7';
	const BALL = '#f4f4f4';
	const PANEL = 'rgba(26, 28, 44, 0.85)';
	const TEXT = '#f4f4f4';
	const MUTED = '#94b0c2';
	const GOLD = '#ffcd75';
	const BRICKS: Record<Colour, string> = {
		blue: '#3b5dc9',
		cyan: '#41a6f6',
		green: '#38b764',
		yellow: '#ffcd75',
		orange: '#ef7d57',
		red: '#b13e53',
		tough: '#94b0c2'
	};
	/** A tough brick that has taken its first hit. */
	const CRACKED = '#566c86';
	const FONT = `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
	/** Space (CSS px) kept between the field and the edges of the play area. */
	const MARGIN = 8;
	/** How long a broken brick flashes as it disappears. */
	const BREAK_MS = 140;

	let canvas: HTMLCanvasElement;
	let loop: GameLoop | undefined;

	onMount(() => {
		const context = canvas.getContext('2d')!;
		let size: CanvasSize = { width: 0, height: 0 };
		let state: BrickBashState = createGame();
		/** Which of left and right are held down (keys or on-screen buttons). */
		const held = { left: false, right: false };
		/** Bricks broken in the last moment, flashing as they go. */
		let breaking: { brick: Brick; age: number }[] = [];
		/** Whether the ball waiting on the paddle replaces a lost one (rather than starting a level). */
		let lostBall = false;

		/** Where the field sits on the canvas: as big as fits, centred, with the rest left as background. */
		function placement() {
			const scale = Math.max(0.1, Math.min((size.width - MARGIN * 2) / WIDTH, (size.height - MARGIN * 2) / HEIGHT));
			const width = WIDTH * scale;
			const height = HEIGHT * scale;
			return { scale, width, height, x: (size.width - width) / 2, y: (size.height - height) / 2 };
		}

		const toWorldX = (point: Point) => {
			const { x, scale } = placement();
			return (point.x - x) / scale;
		};

		/** Take a new state from input or time, reporting score changes, broken bricks, and the end of the game. */
		function commit(next: BrickBashState) {
			const before = state;
			state = next;
			if (state.bricks !== before.bricks) {
				for (const brick of before.bricks) {
					if (!state.bricks.some((other) => other.col === brick.col && other.row === brick.row)) breaking.push({ brick, age: 0 });
				}
			}
			if (state.lives < before.lives) lostBall = true;
			if (state.level !== before.level) lostBall = false;
			if (state.score !== before.score) onScore(state.score);
			if (state.phase === 'over' && before.phase !== 'over') {
				loop?.stop();
				render();
				onGameOver(state.score);
			}
		}

		function serve() {
			if (paused || state.phase !== 'serve') return;
			commit(launch(state, Math.random));
			lostBall = false;
		}

		function update(ms: number) {
			const direction = Number(held.right) - Number(held.left);
			if (direction !== 0) commit(movePaddle(state, state.paddle + (direction * PADDLE_SPEED * ms) / 1000));
			commit(advance(state, ms));
			for (const piece of breaking) piece.age += ms;
			breaking = breaking.filter((piece) => piece.age < BREAK_MS);
		}

		function render() {
			const { width, height } = size;
			const view = placement();
			const { scale } = view;
			const ratio = window.devicePixelRatio || 1;
			// Edges land on whole device pixels, so bricks stay crisp at any scale.
			const snap = (value: number) => Math.round(value * ratio) / ratio;
			const fill = (box: Box, colour: string, inset = 0) => {
				const left = snap(view.x + (box.left + inset) * scale);
				const top = snap(view.y + (box.top + inset) * scale);
				context.fillStyle = colour;
				context.fillRect(left, top, snap(view.x + (box.right - inset) * scale) - left, snap(view.y + (box.bottom - inset) * scale) - top);
			};
			const text = (value: string, x: number, y: number, fontSize: number, colour: string, align: CanvasTextAlign = 'center') => {
				context.font = `bold ${fontSize}px ${FONT}`;
				context.textAlign = align;
				context.textBaseline = 'middle';
				context.fillStyle = colour;
				context.fillText(value, x, y);
			};

			context.fillStyle = BACKGROUND;
			context.fillRect(0, 0, width, height);
			fill({ left: 0, top: 0, right: WIDTH, bottom: HEIGHT }, FIELD);
			fill({ left: 0, top: CEILING - 1, right: WIDTH, bottom: CEILING }, CEILING_LINE);

			// The strip above the ceiling: the level on the left, a small paddle for each ball left on the right.
			const stripY = view.y + (CEILING / 2) * scale;
			text(`LEVEL ${state.level}`, view.x + 4 * scale, stripY, Math.max(9, Math.round(7 * scale)), MUTED, 'left');
			for (let i = 0; i < state.lives - 1; i++) {
				const right = WIDTH - 4 - i * 16;
				fill({ left: right - 12, top: CEILING / 2 - 1.5, right, bottom: CEILING / 2 + 1.5 }, PADDLE);
			}

			// Bricks: a lighter top edge and a darker bottom one, and a crack across a tough brick that's been hit.
			for (const brick of state.bricks) {
				const box = brickBox(brick);
				const colour = brick.colour === 'tough' && brick.hits === 1 ? CRACKED : BRICKS[brick.colour];
				fill(box, colour, 0.5);
				fill({ ...box, bottom: box.top + 2 }, 'rgba(255, 255, 255, 0.25)', 0.5);
				fill({ ...box, top: box.bottom - 2 }, 'rgba(0, 0, 0, 0.25)', 0.5);
				if (colour === CRACKED) {
					const mid = (box.left + box.right) / 2;
					fill({ left: mid - 3, top: box.top + 2, right: mid - 1, bottom: box.top + 4 }, FIELD);
					fill({ left: mid - 1, top: box.top + 4, right: mid + 1, bottom: box.top + 6 }, FIELD);
					fill({ left: mid + 1, top: box.top + 3, right: mid + 3, bottom: box.top + 5 }, FIELD);
				}
			}
			for (const { brick, age } of breaking) {
				context.globalAlpha = 1 - age / BREAK_MS;
				const shrink = (age / BREAK_MS) * 3;
				fill(brickBox(brick), TEXT, 0.5 + shrink);
				context.globalAlpha = 1;
			}

			// The paddle, with a lighter top, and the ball (unless it has fallen out).
			const paddle = paddleBox(state.paddle);
			fill(paddle, PADDLE);
			fill({ ...paddle, bottom: paddle.top + 1.5 }, 'rgba(255, 255, 255, 0.5)');
			if (state.phase !== 'over' && state.phase !== 'cleared') {
				const half = BALL_SIZE / 2;
				fill({ left: state.ball.x - half, top: state.ball.y - half, right: state.ball.x + half, bottom: state.ball.y + half }, BALL);
			}

			const message = banner();
			if (message) {
				const [title, detail, highlight] = message;
				const titleSize = Math.max(16, Math.round(13 * scale));
				const detailSize = Math.max(11, Math.round(7 * scale));
				const centreX = view.x + view.width / 2;
				const centreY = view.y + 200 * scale;
				context.font = `bold ${titleSize}px ${FONT}`;
				const titleWidth = context.measureText(title).width;
				context.font = `bold ${detailSize}px ${FONT}`;
				const panelWidth = Math.min(view.width - 8 * scale, Math.max(titleWidth, context.measureText(detail).width) + titleSize * 1.5);
				const panelHeight = titleSize * 2 + detailSize;
				context.fillStyle = PANEL;
				context.beginPath();
				context.roundRect(centreX - panelWidth / 2, centreY - panelHeight / 2, panelWidth, panelHeight, 6);
				context.fill();
				text(title, centreX, centreY - detailSize * 0.6, titleSize, TEXT);
				text(detail, centreX, centreY + titleSize * 0.6, detailSize, highlight ? GOLD : MUTED);
			}
		}

		/** The message over the field, if any: a title, a detail line, and whether the detail is good news. */
		function banner(): [string, string, boolean] | null {
			switch (state.phase) {
				case 'serve':
					if (lostBall) return [state.lives === 1 ? 'Last ball' : `${state.lives} balls left`, 'Tap or press Space', false];
					return [`LEVEL ${state.level}`, 'Tap or press Space to launch', false];
				case 'cleared':
					return [`Level ${state.level} clear`, `+${CLEAR_BONUS * state.level}`, true];
				default:
					return null;
			}
		}

		loop = createGameLoop({ step: 1000 / 60, update, render });
		// Resizing (rotating the phone, resizing the window) just redraws at the new scale.
		const stopFitting = fitCanvas(canvas, (next) => {
			size = next;
			render();
		});
		// Bound to the whole canvas, so the paddle follows a finger or mouse anywhere across it, even in
		// the margins. Touch or mouse: the paddle follows; tap or click to launch. Keys: hold the arrows
		// to move, Space, Enter or Up to launch. Swipes don't move the paddle: dragging already does.
		const unbind = bindInput(canvas, {
			onPress: (point) => {
				if (!paused) commit(movePaddle(state, toWorldX(point)));
			},
			onPointerMove: (point) => {
				if (!paused) commit(movePaddle(state, toWorldX(point)));
			},
			onTap: serve,
			onHold: (action, down) => {
				if (action === 'left' || action === 'right') held[action] = down;
			},
			onAction: (action, repeat) => {
				if (!repeat && (action === 'action' || action === 'up')) serve();
			}
		});
		loop.start();

		return () => {
			loop?.stop();
			unbind();
			stopFitting();
		};
	});

	$effect(() => {
		if (paused) loop?.pause();
		else loop?.resume();
	});
</script>

<canvas bind:this={canvas}></canvas>

<style>
	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
