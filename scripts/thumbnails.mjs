// Captures a 4:3 picture of each game for its home page card: src/lib/games/<slug>/thumbnail.png.
//
//   npm run thumbnails                  games that don't have a picture yet
//   npm run thumbnails -- buck-fever    just the games named (replacing their pictures)
//   npm run thumbnails -- --all         every game on the home page
//
// The npm script builds the site first; this serves the build with `vite preview` and drives a
// headless Chrome (set CHROME to its path if it isn't found). Each game's Math.random is seeded, so
// the same moments come up every run. Pictures taken from live play (Buck Fever, and the default
// below) can still land a frame or two apart from one run to the next, which is why existing
// pictures are only replaced when asked for.
//
// A game without a recipe below gets the default: it's started (a click in the middle, then Space),
// left to play for a few seconds, and the middle of its canvas is cropped to 4:3. When that doesn't
// make a good picture, add a recipe that sets up a better moment.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';

const ROOT = new URL('../', import.meta.url);
const GAMES = new URL('src/lib/games/', ROOT);

async function waitFor(check, what, ms = 20_000) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		try {
			const value = await check();
			if (value) return value;
		} catch {
			// not ready yet
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${what}`);
}

const fromDataUrl = (url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** The same generator the pages are seeded with, for planning moves in Node. */
function seeded(seed) {
	let s = seed;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// --- Chrome, driven over the DevTools protocol.

function findChrome() {
	if (process.env.CHROME) return process.env.CHROME;
	const candidates = {
		darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
		linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
		win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
	}[process.platform];
	const found = (candidates ?? []).find((path) => existsSync(path));
	if (!found) throw new Error('Chrome not found. Set CHROME to the path of Chrome or Chromium.');
	return found;
}

async function launchChrome() {
	const profile = mkdtempSync(join(tmpdir(), 'game-hub-thumbnails-'));
	const chrome = spawn(
		findChrome(),
		['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'],
		{ stdio: 'ignore' }
	);
	// With port 0, Chrome picks a free port and writes it to this file.
	const portFile = join(profile, 'DevToolsActivePort');
	const port = await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n')[0], 'Chrome to start');
	return {
		endpoint: `http://127.0.0.1:${port}`,
		async close() {
			const exited = new Promise((resolve) => chrome.once('exit', resolve));
			chrome.kill();
			await exited;
			rmSync(profile, { recursive: true, force: true });
		}
	};
}

class Page {
	/** A new tab, so each game starts clean (no seeds or settings left over from another). */
	static async open(endpoint) {
		const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
		const page = new Page(endpoint, target);
		await page.opened;
		await page.send('Page.enable');
		return page;
	}

	constructor(endpoint, target) {
		this.endpoint = endpoint;
		this.target = target;
		this.nextId = 0;
		this.pending = new Map();
		this.listeners = new Set();
		this.socket = new WebSocket(target.webSocketDebuggerUrl);
		this.opened = new Promise((resolve) => this.socket.addEventListener('open', resolve, { once: true }));
		this.socket.addEventListener('message', ({ data }) => {
			const message = JSON.parse(data);
			const waiting = this.pending.get(message.id);
			if (waiting) {
				this.pending.delete(message.id);
				if (message.error) waiting.reject(new Error(message.error.message));
				else waiting.resolve(message.result);
			} else {
				for (const listener of this.listeners) listener(message);
			}
		});
	}

	send(method, params = {}) {
		const id = ++this.nextId;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	once(method) {
		return new Promise((resolve) => {
			const listener = (message) => {
				if (message.method !== method) return;
				this.listeners.delete(listener);
				resolve(message.params);
			};
			this.listeners.add(listener);
		});
	}

	/** Runs `fn` in the page with JSON arguments, and returns its (awaited, JSON) result. */
	async evaluate(fn, ...args) {
		const expression = `(${fn})(...${JSON.stringify(args)})`;
		const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		return result.value;
	}

	/** Seeds Math.random in every page loaded from now on, with the same generator as `seeded`. */
	seed(seed) {
		const source = `(() => { let s = ${seed}; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647; })();`;
		return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
	}

	viewport(width, height, scale = 1) {
		return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
	}

	async goto(url) {
		const loaded = this.once('Page.loadEventFired');
		await this.send('Page.navigate', { url });
		await loaded;
	}

	/** The game's canvas, in CSS pixels, once it's on the page. */
	canvas() {
		return waitFor(
			() =>
				this.evaluate(() => {
					const canvas = document.querySelector('canvas');
					if (!canvas || canvas.width < 2) return null;
					const { x, y, width, height } = canvas.getBoundingClientRect();
					return { x, y, width, height };
				}),
			'the game canvas'
		);
	}

	/** Key presses, sent the way the games read them (keydown on the window). */
	press(...keys) {
		return this.evaluate((keys) => {
			for (const key of keys) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
		}, keys);
	}

	async click(x, y) {
		await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
		await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
	}

	/** A PNG of part of the page, in CSS pixels (at the viewport's scale). */
	async screenshot(clip) {
		const { data } = await this.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
		return Buffer.from(data, 'base64');
	}

	async close() {
		this.socket.close();
		await fetch(`${this.endpoint}/json/close/${this.target.id}`).catch(() => {});
	}
}

// --- How to capture each game.

/** The default: start the game, let it run, and take the middle 4:3 of its canvas. */
async function playForAWhile(page, base, slug) {
	await page.seed(1);
	await page.viewport(960, 600);
	await page.goto(`${base}play/${slug}`);
	const canvas = await page.canvas();
	await page.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
	await page.press(' ');
	await delay(3000);
	const height = Math.min(canvas.height, (canvas.width * 3) / 4);
	const width = (height * 4) / 3;
	return page.screenshot({ x: canvas.x + (canvas.width - width) / 2, y: canvas.y + (canvas.height - height) / 2, width, height });
}

const recipes = {
	/**
	 * Snake is drawn rather than played: a long, winding snake is what makes it recognisable, and
	 * growing one takes a long game. This draws a 16x12-cell window of the board with Snake.svelte's
	 * colours and cell spacing; keep it in step if Snake's look changes.
	 */
	async snake(page) {
		const snake = [[13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [9, 7], [9, 8], [9, 9], [9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [13, 11], [13, 12], [13, 13], [12, 13], [11, 13], [10, 13], [9, 13], [8, 13], [7, 13], [6, 13], [5, 13], [5, 12], [5, 11]];
		const url = await page.evaluate(
			(snake, food) => {
				const width = 720, height = 540, cols = 16, originX = 2, originY = 3;
				const canvas = Object.assign(document.createElement('canvas'), { width, height });
				const context = canvas.getContext('2d');
				const cell = width / cols;
				const gap = Math.max(1, Math.floor(cell / 10));
				const fill = ([x, y], colour) => {
					context.fillStyle = colour;
					context.fillRect((x - originX) * cell + gap, (y - originY) * cell + gap, cell - gap * 2, cell - gap * 2);
				};
				context.fillStyle = '#333c57'; // board
				context.fillRect(0, 0, width, height);
				fill(food, '#ef7d57');
				for (let i = snake.length - 1; i >= 0; i--) fill(snake[i], i > 0 ? '#38b764' : '#a7f070');
				return canvas.toDataURL('image/png');
			},
			snake,
			[16, 6]
		);
		return fromDataUrl(url);
	},

	/**
	 * Falling Blocks: a neat stack, planned with the game's own rules and the page's seeded random
	 * numbers, then the next piece soft-dropped to just above where it will land. The picture is
	 * the bottom of the board, so the piece, its ghost, and the stack all show.
	 */
	async 'falling-blocks'(page, base) {
		const L = await import(new URL('falling-blocks/logic.ts', GAMES).href);
		const SEED = 12345;
		const random = seeded(SEED);
		let state = L.createGame(random);
		const apply = (current, key) =>
			key === 'ArrowUp' ? L.rotate(current) : key === 'ArrowLeft' ? L.move(current, -1) : key === 'ArrowRight' ? L.move(current, 1) : L.hardDrop(current, random);
		// Lower is better: a low, flat stack without holes, with the right-hand column left open.
		const badness = (board) => {
			let height = 0, holes = 0, bumps = 0, previous = null;
			for (let x = 0; x < L.COLS; x++) {
				let top = board.findIndex((row) => row[x] !== null);
				if (top < 0) top = L.ROWS;
				height += L.ROWS - top;
				for (let y = top; y < L.ROWS; y++) if (board[y][x] === null) holes++;
				if (previous !== null) bumps += Math.abs(L.ROWS - top - previous);
				previous = L.ROWS - top;
			}
			const well = board.some((row) => row[L.COLS - 1] !== null) ? 20 : 0;
			return 0.51 * height + 1.5 * holes + 0.18 * bumps + well;
		};
		const plan = [];
		for (let piece = 0; piece < 9; piece++) {
			let best = null;
			for (let turns = 0; turns < 4; turns++) {
				for (let shift = -5; shift <= 5; shift++) {
					let trial = state;
					const keys = [];
					for (let i = 0; i < turns; i++) (trial = L.rotate(trial)), keys.push('ArrowUp');
					let fits = true;
					for (let i = 0; i < Math.abs(shift) && fits; i++) {
						const moved = L.move(trial, Math.sign(shift));
						if (moved.piece.x === trial.piece.x) fits = false;
						else (trial = moved), keys.push(shift < 0 ? 'ArrowLeft' : 'ArrowRight');
					}
					if (!fits) continue;
					// Line clears are avoided: their fragments use random numbers too, which would put the
					// page out of step with this plan.
					const dropped = L.hardDrop(trial, () => 0);
					if (dropped.over || dropped.clearing) continue;
					const score = badness(dropped.board);
					if (!best || score < best.score) best = { score, keys };
				}
			}
			plan.push(best.keys);
			for (const key of best.keys) state = apply(state, key);
			if (piece < 8) state = apply(state, ' ');
		}
		const lower = Math.max(0, L.dropDistance(state.board, state.piece) - 3);

		await page.seed(SEED);
		await page.viewport(800, 600, 3);
		await page.goto(`${base}play/falling-blocks`);
		await page.canvas();
		await delay(300);
		await page.evaluate(
			async (plan, lower) => {
				const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));
				const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
				for (const keys of plan.slice(0, -1)) {
					keys.forEach(press);
					press(' ');
					await frame();
					await frame();
				}
				plan.at(-1).forEach(press);
				for (let i = 0; i < lower; i++) press('ArrowDown');
			},
			plan,
			lower
		);
		await delay(150);
		// The board, by its colour; it's 10x20 cells, so its height gives the cell size exactly.
		const board = await page.evaluate(() => {
			const canvas = document.querySelector('canvas');
			const rect = canvas.getBoundingClientRect();
			const ratio = canvas.width / rect.width;
			const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			let left = Infinity, top = Infinity, bottom = -1;
			for (let y = 0; y < canvas.height; y++) {
				for (let x = 0; x < canvas.width; x++) {
					const i = (y * canvas.width + x) * 4;
					if (data[i] === 33 && data[i + 1] === 38 && data[i + 2] === 58) {
						left = Math.min(left, x);
						top = Math.min(top, y);
						bottom = Math.max(bottom, y);
					}
				}
			}
			return { x: rect.x + left / ratio, y: rect.y + top / ratio, height: (bottom - top + 1) / ratio };
		});
		const width = (board.height / 20) * 10;
		const height = (width * 3) / 4;
		return page.screenshot({ x: board.x, y: board.y + board.height - height, width, height });
	},

	/**
	 * Buck Fever: the scene at exactly 3x (a 960x540 play area), cropped to 192x144 world pixels of
	 * the field around a deer in the nearest lane: preferably a buck, near the middle, with a tree in frame.
	 */
	async 'buck-fever'(page, base) {
		await page.seed(777);
		await page.viewport(960, 600);
		await page.goto(`${base}play/buck-fever`);
		await page.canvas();
		await delay(300);
		await page.press(' ');
		let fallback = null;
		const start = Date.now();
		while (Date.now() - start < 60_000) {
			await delay(100);
			const found = await page.evaluate(() => {
				const canvas = document.querySelector('canvas');
				const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
				const is = (i, r, g, b) => data[i] === r && data[i + 1] === g && data[i + 2] === b;
				// The scene's top-left corner: the first pixel of its top band of sky.
				let left = Infinity, top = Infinity;
				for (let y = 0; y < canvas.height && top === Infinity; y++) {
					for (let x = 0; x < canvas.width; x++) {
						if (is((y * canvas.width + x) * 4, 59, 93, 201)) {
							left = Math.min(left, x);
							top = y;
						}
					}
				}
				if (top === Infinity) return null;
				// Sample each world pixel of the field for deer, antler, and bark colours.
				const deer = [], antlers = [], bark = [];
				for (let wy = 96; wy < 164; wy++) {
					for (let wx = 0; wx < 320; wx++) {
						const i = ((top + wy * 3 + 1) * canvas.width + left + wx * 3 + 1) * 4;
						if (is(i, 168, 103, 63)) deer.push([wx, wy]);
						if (is(i, 236, 220, 176)) antlers.push(wx);
						if (is(i, 107, 66, 38)) bark.push(wx);
					}
				}
				// The nearest lane's deer reach below the other lanes.
				const near = deer.filter(([, y]) => y > 148);
				if (near.length < 6) return null;
				const xs = deer.filter(([x]) => Math.abs(x - near[0][0]) < 20).map(([x]) => x);
				const deerX = (Math.min(...xs) + Math.max(...xs)) / 2;
				if (deerX < 40 || deerX > 280) return null;
				const trees = [...new Set(bark)].filter((x) => Math.abs(x - deerX) < 120);
				const tree = trees.length ? trees.reduce((a, b) => (Math.abs(a - deerX) < Math.abs(b - deerX) ? a : b)) : null;
				// Centred on the deer, leaning a little towards the tree.
				const lean = tree === null ? 0 : (tree - deerX) * 0.3;
				const x0 = Math.min(320 - 192, Math.max(0, Math.round(deerX + lean - 96)));
				const out = Object.assign(document.createElement('canvas'), { width: 576, height: 432 });
				out.getContext('2d').drawImage(canvas, left + x0 * 3, top + 20 * 3, 576, 432, 0, 0, 576, 432);
				return {
					url: out.toDataURL('image/png'),
					buck: antlers.some((x) => Math.abs(x - deerX) < 20),
					tree: tree !== null && tree > x0 + 16 && tree < x0 + 176,
					centred: Math.abs(deerX - (x0 + 96)) < 20
				};
			});
			if (found?.buck && found.tree && found.centred) return fromDataUrl(found.url);
			fallback ??= found;
		}
		if (!fallback) throw new Error('no deer came close enough to picture');
		return fromDataUrl(fallback.url);
	},

	/**
	 * Brick Bash: played for real, with the page steering the paddle under the ball, until a few
	 * bricks are gone and the ball is just below them. The field is taller than 4:3, so the picture
	 * joins its top (the level, the bricks, and the ball) to the strip with the paddle, leaving out
	 * the empty middle: 240x180 world px of the 240x320 field, at 3x.
	 */
	async 'brick-bash'(page, base) {
		await page.seed(2024);
		await page.viewport(800, 1100, 2);
		await page.goto(`${base}play/brick-bash`);
		await page.canvas();
		await delay(300);
		await page.press(' ');
		const url = await page.evaluate(
			(top, bottom) =>
				new Promise((resolve, reject) => {
					const canvas = document.querySelector('canvas');
					const context = canvas.getContext('2d');
					const rect = canvas.getBoundingClientRect();
					const ratio = canvas.width / rect.width;
					const score = () => Number(document.querySelector('.scores dd')?.textContent);
					const started = Date.now();
					let field = null;
					// Which side of the paddle's middle (CSS px) meets the ball. It swaps at each bounce, so the
					// ball goes up at different angles and breaks bricks across the wall.
					let side = 20;
					let lastBall = null;
					let falling = false;

					const frame = () => {
						if (Date.now() - started > 90_000) return reject(new Error('no good moment came up'));
						const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
						const at = (x, y, r, g, b) => {
							const i = (y * canvas.width + x) * 4;
							return data[i] === r && data[i + 1] === g && data[i + 2] === b;
						};
						// The field, by its colour (once; it doesn't move).
						if (!field) {
							let left = Infinity, right = -1, high = Infinity, low = -1;
							for (let y = 0; y < canvas.height; y++) {
								for (let x = 0; x < canvas.width; x++) {
									if (at(x, y, 33, 38, 58)) {
										left = Math.min(left, x);
										right = Math.max(right, x);
										high = Math.min(high, y);
										low = Math.max(low, y);
									}
								}
							}
							field = { left, top: high, scale: (right - left + 1) / 240 };
						}
						// The ball: the white pixels, when they make a small square (a breaking brick flashes white too).
						let left = Infinity, right = -1, high = Infinity, low = -1;
						for (let y = 0; y < canvas.height; y++) {
							for (let x = 0; x < canvas.width; x++) {
								if (at(x, y, 244, 244, 244)) {
									left = Math.min(left, x);
									right = Math.max(right, x);
									high = Math.min(high, y);
									low = Math.max(low, y);
								}
							}
						}
						const size = right - left + 1;
						const ball =
							right >= 0 && size < field.scale * 7 && Math.abs(size - (low - high + 1)) <= 2
								? { x: (left + right + 1) / 2, y: (high + low + 1) / 2 }
								: null;
						if (ball) {
							const world = (ball.y - field.top) / field.scale;
							const across = (ball.x - field.left) / field.scale;
							// Rising, just below the bricks and away from the walls, with a good few bricks gone.
							const placed = world > top - 44 && world < top - 14 && across > 60 && across < 180;
							if (lastBall && ball.y < lastBall.y && placed && score() >= 150) {
								const out = Object.assign(document.createElement('canvas'), { width: 720, height: 540 });
								const pictureContext = out.getContext('2d');
								pictureContext.imageSmoothingQuality = 'high';
								const k = field.scale;
								pictureContext.drawImage(canvas, field.left, field.top, 240 * k, top * k, 0, 0, 720, top * 3);
								pictureContext.drawImage(canvas, field.left, field.top + bottom[0] * k, 240 * k, (bottom[1] - bottom[0]) * k, 0, top * 3, 720, (bottom[1] - bottom[0]) * 3);
								return resolve(out.toDataURL('image/png'));
							}
							const rising = lastBall !== null && ball.y < lastBall.y;
							if (rising && falling && world > 250) side = -side; // it just came off the paddle
							if (lastBall && ball.y !== lastBall.y) falling = !rising;
							lastBall = ball;
							canvas.dispatchEvent(
								new PointerEvent('pointermove', { clientX: rect.x + ball.x / ratio + side, clientY: rect.y + ball.y / ratio, pointerId: 1, bubbles: true })
							);
						}
						requestAnimationFrame(frame);
					};
					frame();
				}),
			// World rows kept: the top 136 (down to just below the bricks), and 262-306 (the paddle).
			136,
			[262, 306]
		);
		return fromDataUrl(url);
	}
};

// --- Run.

const server = await preview({ logLevel: 'silent', preview: { port: 4180 } });
const base = server.resolvedUrls.local[0];
const chrome = await launchChrome();
const registry = readFileSync(new URL('registry.ts', GAMES), 'utf8');
try {
	const args = process.argv.slice(2);
	let slugs = args.filter((arg) => !arg.startsWith('-')); // options like --all, and a stray -- from npm
	if (slugs.length === 0) {
		const page = await Page.open(chrome.endpoint);
		await page.goto(base);
		slugs = await page.evaluate(() =>
			[...document.querySelectorAll('main a[href*="/play/"]')].map((link) => new URL(link.href).pathname.split('/play/')[1])
		);
		await page.close();
		if (!args.includes('--all')) slugs = slugs.filter((slug) => !existsSync(new URL(`${slug}/thumbnail.png`, GAMES)));
		if (slugs.length === 0) console.log('Every game has a picture. Name a game, or use --all, to take new ones.');
	}
	for (const slug of slugs) {
		const page = await Page.open(chrome.endpoint);
		try {
			const png = await (recipes[slug] ?? playForAWhile)(page, base, slug);
			const file = new URL(`${slug}/thumbnail.png`, GAMES);
			writeFileSync(file, png);
			console.log(`${slug}: ${fileURLToPath(file)} (${Math.round(png.length / 1024)} kB)${recipes[slug] ? '' : ' (default capture)'}`);
			if (!registry.includes(`./${slug}/thumbnail.png`)) {
				console.log(`  Not in the registry yet: import it in src/lib/games/registry.ts and set \`thumbnail\` in its entry.`);
			}
		} catch (error) {
			process.exitCode = 1;
			console.error(`${slug}: ${error.message}`);
		} finally {
			await page.close();
		}
	}
} finally {
	await chrome.close();
	await server.close();
}
