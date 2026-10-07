<script lang="ts">
	import { onMount } from 'svelte';
	import { fitCanvas, type CanvasSize } from '../../core/canvas';
	import { createGameLoop, type GameLoop } from '../../core/gameLoop';
	import { bindInput } from '../../core/input';
	import type { GameProps } from '../../core/types';
	import { advance, createGame, start, turn, type Cell, type SnakeState } from './logic';

	let { paused, onScore, onGameOver }: GameProps = $props();

	// Colours from the app palette (see app.css).
	const BACKGROUND = '#1a1c2c';
	const BOARD = '#333c57';
	const BODY = '#38b764';
	const HEAD = '#a7f070';
	const DEAD = '#b13e53';
	const FOOD = '#ef7d57';
	const TEXT = '#f4f4f4';
	/** Space (CSS px) kept between the board and the edges of the play area. */
	const MARGIN = 8;

	let canvas: HTMLCanvasElement;
	let loop: GameLoop | undefined;

	onMount(() => {
		const context = canvas.getContext('2d')!;
		let size: CanvasSize = { width: 0, height: 0 };
		let state: SnakeState = createGame(Math.random);

		function update(ms: number) {
			const before = state;
			state = advance(state, ms, Math.random);
			if (state.score !== before.score) onScore(state.score);
			if (state.over) {
				loop?.stop();
				render();
				onGameOver(state.score);
			}
		}

		function render() {
			const { width, height } = size;
			// Whole-pixel cells keep the edges crisp; the board is centred and the rest is letterboxed.
			const cellSize = Math.max(1, Math.floor((Math.min(width, height) - MARGIN * 2) / state.size));
			const boardSize = cellSize * state.size;
			const left = Math.floor((width - boardSize) / 2);
			const top = Math.floor((height - boardSize) / 2);
			const gap = Math.max(1, Math.floor(cellSize / 10));

			const fillCell = ({ x, y }: Cell, colour: string) => {
				context.fillStyle = colour;
				context.fillRect(left + x * cellSize + gap, top + y * cellSize + gap, cellSize - gap * 2, cellSize - gap * 2);
			};

			context.fillStyle = BACKGROUND;
			context.fillRect(0, 0, width, height);
			context.fillStyle = BOARD;
			context.fillRect(left, top, boardSize, boardSize);

			if (state.food) fillCell(state.food, FOOD);
			for (let i = state.snake.length - 1; i >= 0; i--) {
				fillCell(state.snake[i], i > 0 ? BODY : state.over ? DEAD : HEAD);
			}

			if (!state.started) {
				const fontSize = Math.max(12, Math.round(cellSize * 0.9));
				const centreX = left + boardSize / 2;
				const centreY = top + boardSize * 0.3;
				context.fillStyle = TEXT;
				context.textAlign = 'center';
				context.textBaseline = 'middle';
				context.font = `${fontSize}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
				context.fillText('Swipe or use arrow keys', centreX, centreY);
				context.fillText('to start', centreX, centreY + fontSize * 1.4);
			}
		}

		loop = createGameLoop({ step: 1000 / 60, update, render });
		// Resizing (rotating the phone, resizing the window) just redraws at the new scale.
		const stopFitting = fitCanvas(canvas, (next) => {
			size = next;
			render();
		});
		// Bound to the whole canvas, so swipes in the margins around the board count too.
		const unbind = bindInput(canvas, {
			onAction: (action, repeat) => {
				if (paused || repeat) return;
				state = action === 'action' ? start(state) : turn(state, action);
			},
			onTap: () => {
				if (!paused) state = start(state);
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
