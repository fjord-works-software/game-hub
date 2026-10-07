<script lang="ts">
	import { onMount } from 'svelte';
	import { fitCanvas, type CanvasSize } from '../../core/canvas';
	import { createGameLoop, type GameLoop } from '../../core/gameLoop';
	import { bindInput } from '../../core/input';
	import type { GameProps } from '../../core/types';
	import {
		advance,
		cells,
		COLS,
		createGame,
		ghost,
		hardDrop,
		HIDDEN_ROWS,
		move,
		rotate,
		shapeCells,
		softDrop,
		VISIBLE_ROWS,
		type Cell,
		type PieceType,
		type FallingBlocksState
	} from './logic';

	let { paused, onScore, onGameOver }: GameProps = $props();

	// Colours from the app palette (see app.css), plus one per piece.
	const BACKGROUND = '#1a1c2c';
	const BOARD = '#21263a';
	const GRID = '#2c3350';
	const TEXT = '#f4f4f4';
	const MUTED = '#94b0c2';
	const COLOURS: Record<PieceType, string> = {
		I: '#73eff7',
		O: '#ffcd75',
		T: '#c15fd6',
		S: '#a7f070',
		Z: '#b13e53',
		J: '#3b5dc9',
		L: '#ef7d57'
	};
	const FONT = `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
	/** Space (CSS px) kept between the game and the edges of the play area. */
	const MARGIN = 8;
	/** The next/lines/level panel, in cells: beside the board on wide screens, above it on tall ones. */
	const SIDE_PANEL_COLS = 5;
	const TOP_PANEL_ROWS = 4;
	const PANEL_GAP = 1;
	/** Line clears: the rows above drop into place over this long, a little inside the rules' pause. */
	const SETTLE_MS = 160;
	/** Line clears: the cleared blocks shatter into fragments that fly up, fall, and fade. */
	const FRAGMENT_LIFE_MS = 700;
	const FRAGMENT_GRAVITY = 30; // board cells per second squared

	let canvas: HTMLCanvasElement;
	let loop: GameLoop | undefined;

	interface Rect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	/** A quarter of a cleared block, in board cells: where it started, how fast it was thrown, and how long ago. */
	interface Fragment {
		x: number;
		y: number;
		vx: number;
		vy: number;
		colour: string;
		age: number;
	}

	/** Whichever arrangement (panel beside or above the board) gives the bigger cells, centred in the canvas. */
	function arrange({ width, height }: CanvasSize): { cell: number; board: Rect; panel: Rect; beside: boolean } {
		const room = { width: width - MARGIN * 2, height: height - MARGIN * 2 };
		const besideCell = Math.floor(Math.min(room.width / (COLS + PANEL_GAP + SIDE_PANEL_COLS), room.height / VISIBLE_ROWS));
		const aboveCell = Math.floor(Math.min(room.width / COLS, room.height / (VISIBLE_ROWS + PANEL_GAP + TOP_PANEL_ROWS)));
		const beside = besideCell >= aboveCell;
		const cell = Math.max(1, beside ? besideCell : aboveCell);
		const boardWidth = cell * COLS;
		const boardHeight = cell * VISIBLE_ROWS;
		const totalWidth = beside ? cell * (COLS + PANEL_GAP + SIDE_PANEL_COLS) : boardWidth;
		const totalHeight = beside ? boardHeight : cell * (VISIBLE_ROWS + PANEL_GAP + TOP_PANEL_ROWS);
		const left = Math.floor((width - totalWidth) / 2);
		const top = Math.floor((height - totalHeight) / 2);
		return beside
			? {
					cell,
					beside,
					board: { x: left, y: top, width: boardWidth, height: boardHeight },
					panel: { x: left + boardWidth + cell * PANEL_GAP, y: top, width: cell * SIDE_PANEL_COLS, height: boardHeight }
				}
			: {
					cell,
					beside,
					board: { x: left, y: top + cell * (TOP_PANEL_ROWS + PANEL_GAP), width: boardWidth, height: boardHeight },
					panel: { x: left, y: top, width: boardWidth, height: cell * TOP_PANEL_ROWS }
				};
	}

	onMount(() => {
		const context = canvas.getContext('2d')!;
		let size: CanvasSize = { width: 0, height: 0 };
		let state: FallingBlocksState = createGame(Math.random);
		let fragments: Fragment[] = [];

		/** Burst each block in the full rows into four fragments, thrown up and away from the middle. */
		function shatter(rows: number[]) {
			for (const y of rows) {
				state.board[y].forEach((type, x) => {
					if (!type) return;
					for (let quarter = 0; quarter < 4; quarter++) {
						const qx = quarter % 2;
						const qy = Math.floor(quarter / 2);
						fragments.push({
							x: x + 0.25 + qx * 0.5,
							y: y + 0.25 + qy * 0.5,
							vx: (qx - 0.5) * (1 + Math.random() * 3) + (x - (COLS - 1) / 2) * 0.4,
							vy: -(2 + Math.random() * 6) + qy * 1.5,
							colour: Math.random() < 0.2 ? TEXT : COLOURS[type],
							age: 0
						});
					}
				});
			}
		}

		/** Take a new state from input or time, reporting score changes and the end of the game. */
		function commit(next: FallingBlocksState) {
			const before = state;
			state = next;
			if (state.clearing && !before.clearing) shatter(state.clearing.rows);
			if (state.score !== before.score) onScore(state.score);
			if (state.over && !before.over) {
				loop?.stop();
				fragments = [];
				render();
				onGameOver(state.score);
			}
		}

		function update(ms: number) {
			commit(advance(state, ms, Math.random));
			for (const fragment of fragments) fragment.age += ms;
			fragments = fragments.filter((fragment) => fragment.age < FRAGMENT_LIFE_MS);
		}

		function render() {
			const { cell, board, panel, beside } = arrange(size);
			const gap = Math.max(1, Math.floor(cell / 12));

			const block = (x: number, y: number, colour: string) => {
				context.fillStyle = colour;
				context.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);
			};
			// Board cells, skipping the hidden rows above the visible board. Rows dropping after a line
			// clear sit between rows, so a cell partly in view is drawn and the clip below trims it.
			const boardBlock = ({ x, y }: Cell, colour: string) => {
				if (y > HIDDEN_ROWS - 1) block(board.x + x * cell, board.y + (y - HIDDEN_ROWS) * cell, colour);
			};

			context.fillStyle = BACKGROUND;
			context.fillRect(0, 0, size.width, size.height);

			// Board with a faint grid.
			context.fillStyle = BOARD;
			context.fillRect(board.x, board.y, board.width, board.height);
			context.fillStyle = GRID;
			for (let x = 1; x < COLS; x++) context.fillRect(board.x + x * cell, board.y, 1, board.height);
			for (let y = 1; y < VISIBLE_ROWS; y++) context.fillRect(board.x, board.y + y * cell, board.width, 1);

			// Everything on the board is clipped to it, so dropping rows and fragments stay inside.
			context.save();
			context.beginPath();
			context.rect(board.x, board.y, board.width, board.height);
			context.clip();

			// While full rows are being cleared they're gone (shattered, below), and the rows above
			// drop into the gap, speeding up like they're falling.
			const { clearing } = state;
			const settled = clearing ? Math.min(1, clearing.elapsed / SETTLE_MS) ** 2 : 0;
			state.board.forEach((row, y) => {
				if (clearing?.rows.includes(y)) return;
				const drop = clearing ? clearing.rows.filter((cleared) => cleared > y).length * settled : 0;
				row.forEach((type, x) => {
					if (type) boardBlock({ x, y: y + drop }, COLOURS[type]);
				});
			});

			if (!state.over && !clearing) {
				// Ghost: an outline where the piece will land (its centre stays clear).
				const colour = COLOURS[state.piece.type];
				context.strokeStyle = colour;
				context.globalAlpha = 0.6;
				context.lineWidth = gap * 2;
				for (const { x, y } of cells(ghost(state))) {
					if (y >= HIDDEN_ROWS) {
						context.strokeRect(board.x + x * cell + gap * 2, board.y + (y - HIDDEN_ROWS) * cell + gap * 2, cell - gap * 4, cell - gap * 4);
					}
				}
				context.globalAlpha = 1;
				for (const c of cells(state.piece)) boardBlock(c, colour);
			}

			for (const { x, y, vx, vy, colour, age } of fragments) {
				const seconds = age / 1000;
				const life = age / FRAGMENT_LIFE_MS;
				const side = cell * 0.42 * (1 - 0.4 * life);
				const fragmentX = x + vx * seconds;
				const fragmentY = y + vy * seconds + 0.5 * FRAGMENT_GRAVITY * seconds ** 2 - HIDDEN_ROWS;
				context.globalAlpha = 1 - life ** 2;
				context.fillStyle = colour;
				context.fillRect(board.x + fragmentX * cell - side / 2, board.y + fragmentY * cell - side / 2, side, side);
			}
			context.globalAlpha = 1;
			context.restore();

			// Panel: next piece, lines, and level.
			const labelSize = Math.max(10, Math.round(cell * 0.6));
			const valueSize = Math.max(12, Math.round(cell * 0.95));
			const text = (value: string, x: number, y: number, fontSize: number, colour: string) => {
				context.fillStyle = colour;
				context.font = `${fontSize}px ${FONT}`;
				context.textAlign = 'left';
				context.textBaseline = 'top';
				context.fillText(value, x, y);
			};
			const preview = (type: PieceType, x: number, y: number) => {
				const shape = shapeCells(type);
				const width = Math.max(...shape.map((c) => c.x)) - Math.min(...shape.map((c) => c.x)) + 1;
				const height = Math.max(...shape.map((c) => c.y)) - Math.min(...shape.map((c) => c.y)) + 1;
				const minX = Math.min(...shape.map((c) => c.x));
				const minY = Math.min(...shape.map((c) => c.y));
				// Centre the piece in a 4x2-cell box.
				const offsetX = x + Math.floor(((4 - width) * cell) / 2);
				const offsetY = y + Math.floor(((2 - height) * cell) / 2);
				for (const c of shape) block(offsetX + (c.x - minX) * cell, offsetY + (c.y - minY) * cell, COLOURS[type]);
			};
			const next = state.queue[0];
			const statsX = beside ? panel.x : panel.x + cell * 5.5;
			const statsY = beside ? panel.y + cell * 4.5 : panel.y;
			text('NEXT', panel.x, panel.y, labelSize, MUTED);
			if (next) preview(next, panel.x, panel.y + cell * 1.2);
			text('LINES', statsX, statsY, labelSize, MUTED);
			text(String(state.lines), statsX, statsY + labelSize * 1.2, valueSize, TEXT);
			text('LEVEL', statsX, statsY + labelSize * 1.2 + valueSize * 1.4, labelSize, MUTED);
			text(String(state.level), statsX, statsY + labelSize * 2.4 + valueSize * 1.4, valueSize, TEXT);

			if (!state.started) {
				const fontSize = Math.max(11, Math.round(cell * 0.6));
				context.fillStyle = TEXT;
				context.font = `${fontSize}px ${FONT}`;
				context.textAlign = 'center';
				context.textBaseline = 'middle';
				const centreX = board.x + board.width / 2;
				const centreY = board.y + board.height * 0.4;
				context.fillText('Tap or use arrow keys', centreX, centreY);
				context.fillText('to start', centreX, centreY + fontSize * 1.4);
			}
		}

		loop = createGameLoop({ step: 1000 / 60, update, render });
		// Resizing (rotating the phone, resizing the window) just redraws at the new scale.
		const stopFitting = fitCanvas(canvas, (next) => {
			size = next;
			render();
		});
		// Bound to the whole canvas, so swipes and taps around the board count too.
		// Keys: left/right move, down soft-drops (all repeat while held), up rotates, Space hard-drops.
		// Touch: drag to move or soft-drop, tap to rotate, flick down to hard-drop.
		const unbind = bindInput(canvas, {
			onAction: (action, repeat) => {
				if (paused) return;
				if (action === 'left') commit(move(state, -1));
				else if (action === 'right') commit(move(state, 1));
				else if (action === 'down') commit(softDrop(state));
				else if (repeat) return; // rotate and hard drop happen once per press
				else if (action === 'up') commit(rotate(state));
				else commit(hardDrop(state, Math.random));
			},
			onTap: () => {
				if (!paused) commit(rotate(state));
			},
			onFlick: (direction) => {
				if (!paused && direction === 'down') commit(hardDrop(state, Math.random));
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
