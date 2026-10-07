<script lang="ts">
	import { onMount } from 'svelte';
	import { fitCanvas, type CanvasSize } from '../../core/canvas';
	import { createGameLoop, type GameLoop } from '../../core/gameLoop';
	import { bindInput } from '../../core/input';
	import type { GameProps } from '../../core/types';
	import { drawClouds, drawCrosshair, drawDeer, drawHud, drawShot, drawTree, HUD_TOP, paintScenery } from './art';
	import {
		advance,
		createGame,
		DEER_PER_ROUND,
		HEIGHT,
		hitsNeeded,
		PERFECT_BONUS,
		shoot,
		start,
		targetAt,
		WIDTH,
		type BuckFeverState,
		type Point
	} from './logic';

	let { paused, onScore, onGameOver }: GameProps = $props();

	// Colours from the app palette (see app.css).
	const BACKGROUND = '#1a1c2c';
	const PANEL = 'rgba(26, 28, 44, 0.8)';
	const TEXT = '#f4f4f4';
	const MUTED = '#94b0c2';
	const GOLD = '#ffcd75';
	const FONT = `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
	/** A tap this close to a deer (CSS px) hits it, however small it's drawn. */
	const TOUCH_TARGET = 44;
	/** How far (world px) each arrow-key press moves the crosshair. */
	const AIM_STEP = 6;
	const SHOT_MS = 160;

	let canvas: HTMLCanvasElement;
	let loop: GameLoop | undefined;

	onMount(() => {
		const context = canvas.getContext('2d')!;
		// The scene is drawn at its own 320x180 resolution, then scaled up to fill the space in two
		// steps: by the next whole number with hard edges, then smoothly down to the exact size. Every
		// world pixel comes out the same size, which a direct resize to an odd scale can't do.
		const scene = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
		const sceneContext = scene.getContext('2d')!;
		const upscaled = document.createElement('canvas');
		const upscaledContext = upscaled.getContext('2d')!;
		const scenery = paintScenery();
		let size: CanvasSize = { width: 0, height: 0 };
		let state: BuckFeverState = createGame(Math.random);
		let time = 0;
		// The crosshair appears once the player aims (mouse, arrow keys) or shoots.
		let aim: Point = { x: WIDTH / 2, y: 110 };
		let aimed = false;
		let shots: (Point & { age: number; onTree: boolean })[] = [];

		/** Where the scene sits on the canvas: as big as fits, centred, with the rest left as background. */
		function placement() {
			const ratio = window.devicePixelRatio || 1;
			const scale = Math.min(size.width / WIDTH, size.height / HEIGHT);
			const width = WIDTH * scale;
			const height = HEIGHT * scale;
			const snap = (value: number) => Math.round(value * ratio) / ratio;
			return { scale, width, height, x: snap((size.width - width) / 2), y: snap((size.height - height) / 2) };
		}

		const toWorld = (point: Point): Point => {
			const { x, y, scale } = placement();
			return { x: (point.x - x) / scale, y: (point.y - y) / scale };
		};

		/** Take a new state from input or time, reporting score changes and the end of the game. */
		function commit(next: BuckFeverState) {
			const before = state;
			state = next;
			if (state.score !== before.score) onScore(state.score);
			if (state.phase === 'over' && before.phase !== 'over') {
				loop?.stop();
				render();
				onGameOver(state.score);
			}
		}

		function fire() {
			const before = state;
			const minHitSize = TOUCH_TARGET / placement().scale;
			const onTree = targetAt(state, aim, minHitSize)?.kind === 'tree';
			commit(shoot(state, aim, minHitSize, Math.random));
			if (state.shells !== before.shells) shots.push({ ...aim, age: 0, onTree });
		}

		function update(ms: number) {
			time += ms;
			commit(advance(state, ms, Math.random));
			for (const shot of shots) shot.age += ms;
			shots = shots.filter((shot) => shot.age < SHOT_MS);
		}

		function render() {
			// The scene, back to front: each lane's grass covers the hooves of the deer in it, and the
			// trees in the row just in front of a lane cover the deer running behind them.
			sceneContext.drawImage(scenery.sky, 0, 0);
			drawClouds(sceneContext, scenery.cloud, time);
			sceneContext.drawImage(scenery.land, 0, 0);
			scenery.tufts.forEach((tufts, lane) => {
				for (const deer of state.deer) if (deer.lane === lane) drawDeer(sceneContext, deer);
				sceneContext.drawImage(tufts, 0, 0);
				for (const tree of state.trees) if (tree.row === lane) drawTree(sceneContext, tree);
			});
			for (const shot of shots) drawShot(sceneContext, shot.x, shot.y, shot.age, shot.onTree);
			drawHud(sceneContext, state, time);
			if (aimed && state.phase !== 'over') drawCrosshair(sceneContext, aim.x, aim.y);

			const view = placement();
			const { scale } = view;
			context.fillStyle = BACKGROUND;
			context.fillRect(0, 0, size.width, size.height);
			const multiple = Math.max(1, Math.ceil(scale * (window.devicePixelRatio || 1) - 0.001));
			if (upscaled.width !== WIDTH * multiple) {
				upscaled.width = WIDTH * multiple;
				upscaled.height = HEIGHT * multiple;
			}
			// Set every frame: resizing a canvas resets its drawing settings.
			upscaledContext.imageSmoothingEnabled = false;
			upscaledContext.drawImage(scene, 0, 0, upscaled.width, upscaled.height);
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = 'high';
			context.drawImage(upscaled, view.x, view.y, view.width, view.height);

			// Text is drawn at screen resolution, sized with the scene.
			const text = (value: string, x: number, y: number, fontSize: number, colour: string, align: CanvasTextAlign = 'center') => {
				context.font = `bold ${fontSize}px ${FONT}`;
				context.textAlign = align;
				context.textBaseline = 'middle';
				context.fillStyle = colour;
				context.fillText(value, x, y);
			};
			const world = (x: number, y: number) => ({ x: view.x + x * scale, y: view.y + y * scale });

			const roundLabel = world(WIDTH - 6, (HUD_TOP + HEIGHT) / 2);
			text(`ROUND ${state.round}`, roundLabel.x, roundLabel.y, Math.max(9, Math.round(7 * scale)), MUTED, 'right');

			const message = banner();
			if (message) {
				const [title, detail, highlight] = message;
				const titleSize = Math.max(16, Math.round(12 * scale));
				const detailSize = Math.max(11, Math.round(7 * scale));
				const centre = world(WIDTH / 2, 66);
				const measure = (value: string, fontSize: number) => {
					context.font = `bold ${fontSize}px ${FONT}`;
					return context.measureText(value).width;
				};
				const width = Math.max(measure(title, titleSize), measure(detail, detailSize)) + titleSize * 1.5;
				const height = titleSize + detailSize + titleSize;
				context.fillStyle = PANEL;
				context.beginPath();
				context.roundRect(centre.x - width / 2, centre.y - height / 2, width, height, 6);
				context.fill();
				text(title, centre.x, centre.y - detailSize * 0.6, titleSize, TEXT);
				text(detail, centre.x, centre.y + titleSize * 0.6, detailSize, highlight ? GOLD : MUTED);
			}

			// Held upright, the scene is a small strip: suggest turning the phone, in the space above it.
			if (size.height > size.width && view.y > 64) {
				const hintSize = Math.max(12, Math.round(size.width / 28));
				text('↻', size.width / 2, view.y / 2 - hintSize * 1.4, hintSize * 2, MUTED);
				text('Turn your phone sideways', size.width / 2, view.y / 2 + hintSize * 0.4, hintSize, MUTED);
				text('for a bigger view', size.width / 2, view.y / 2 + hintSize * 1.8, hintSize, MUTED);
			}
		}

		/** The message over the field, if any: a title, a detail line, and whether the detail is good news. */
		function banner(): [string, string, boolean] | null {
			const needed = hitsNeeded(state.round);
			const hits = state.results.filter(Boolean).length;
			switch (state.phase) {
				case 'waiting':
					return ['Tap or click to start', `Hit ${needed} of ${DEER_PER_ROUND} deer each round`, false];
				case 'intro':
					return [`ROUND ${state.round}`, `Hit ${needed} of ${DEER_PER_ROUND}`, false];
				case 'tally':
					if (hits === DEER_PER_ROUND) return [`${hits} of ${DEER_PER_ROUND}`, `Perfect! +${PERFECT_BONUS * state.round}`, true];
					return [`${hits} of ${DEER_PER_ROUND}`, hits >= needed ? 'Round clear' : `Needed ${needed}`, hits >= needed];
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
		// Bound to the whole canvas, so taps in the margins around the scene still count.
		// Touch or mouse: press to shoot where you press (the mouse also aims as it moves).
		// Keys: arrows move the crosshair, Space or Enter shoots.
		const unbind = bindInput(canvas, {
			onPress: (point) => {
				if (paused) return;
				if (state.phase === 'waiting') return commit(start(state));
				aim = toWorld(point);
				aimed = true;
				fire();
			},
			onPointerMove: (point) => {
				aim = toWorld(point);
				aimed = true;
			},
			onAction: (action, repeat) => {
				if (paused) return;
				if (action === 'action') {
					if (repeat) return; // one shot per press
					if (state.phase === 'waiting') commit(start(state));
					else fire();
					return;
				}
				const dx = action === 'left' ? -1 : action === 'right' ? 1 : 0;
				const dy = action === 'up' ? -1 : action === 'down' ? 1 : 0;
				aim = {
					x: Math.min(WIDTH - 1, Math.max(0, aim.x + dx * AIM_STEP)),
					y: Math.min(HUD_TOP - 1, Math.max(0, aim.y + dy * AIM_STEP))
				};
				aimed = true;
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
		/* The crosshair is drawn in the scene. */
		cursor: none;
	}
</style>
