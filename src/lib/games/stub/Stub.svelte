<!--
	Temporary game that exercises the core framework (loop, input, canvas, shell callbacks):
	tap or press Space as many times as you can in 10 seconds; arrows or swipes steer the block.
	Removed when Snake replaces it in Phase 4.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fitCanvas, type CanvasSize } from '../../core/canvas';
	import { createGameLoop, type GameLoop } from '../../core/gameLoop';
	import { bindInput, type Direction } from '../../core/input';
	import type { GameProps } from '../../core/types';

	let { paused, onScore, onGameOver }: GameProps = $props();

	const ROUND_MS = 10_000;
	const SPEED = 0.25; // fraction of the canvas per second
	const HEADINGS: Record<Direction, [number, number]> = {
		up: [0, -1],
		down: [0, 1],
		left: [-1, 0],
		right: [1, 0]
	};

	let canvas: HTMLCanvasElement;
	let loop: GameLoop | undefined;

	onMount(() => {
		const context = canvas.getContext('2d')!;
		let size: CanvasSize = { width: 0, height: 0 };
		let score = 0;
		let remaining = ROUND_MS;
		let x = 0.5;
		let y = 0.5;
		let heading: Direction = 'right';
		let flash = 0;

		function addPoint() {
			if (paused || !loop?.running) return;
			score++;
			flash = 120;
			onScore(score);
		}

		function update(step: number) {
			const [dx, dy] = HEADINGS[heading];
			x = (x + (dx * SPEED * step) / 1000 + 1) % 1;
			y = (y + (dy * SPEED * step) / 1000 + 1) % 1;
			flash = Math.max(0, flash - step);
			remaining -= step;
			if (remaining <= 0) {
				remaining = 0;
				loop?.stop();
				render();
				onGameOver(score);
			}
		}

		function render() {
			const { width, height } = size;
			const unit = Math.min(width, height);

			context.fillStyle = flash > 0 ? '#333c57' : '#1a1c2c';
			context.fillRect(0, 0, width, height);

			context.fillStyle = '#38b764';
			context.fillRect(0, 0, (width * remaining) / ROUND_MS, 6);

			const block = unit * 0.08;
			context.fillStyle = '#ef7d57';
			context.fillRect(x * width - block / 2, y * height - block / 2, block, block);

			context.fillStyle = '#f4f4f4';
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.font = `${Math.round(unit * 0.12)}px ui-monospace, monospace`;
			context.fillText(`${Math.ceil(remaining / 1000)}s`, width / 2, height / 2 - unit * 0.12);
			context.font = `${Math.round(unit * 0.045)}px ui-monospace, monospace`;
			context.fillText('Tap or press Space to score', width / 2, height / 2 + unit * 0.04);
			context.fillText('Arrows or swipes steer', width / 2, height / 2 + unit * 0.11);
		}

		loop = createGameLoop({ step: 1000 / 60, update, render });
		const stopFitting = fitCanvas(canvas, (next) => {
			size = next;
			render();
		});
		const unbind = bindInput(canvas, {
			onAction: (action) => {
				if (action === 'action') addPoint();
				else if (!paused) heading = action;
			},
			onTap: addPoint
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
