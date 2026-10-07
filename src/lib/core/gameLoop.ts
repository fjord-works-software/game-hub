export interface GameLoopOptions {
	/** Fixed simulation step in milliseconds; `update` is always called with this. */
	step: number;
	/** Advance the game by one fixed step. */
	update: (step: number) => void;
	/**
	 * Draw the current state, once per animation frame. `alpha` (0–1) is how far the clock
	 * has moved towards the next update, for games that want to interpolate.
	 */
	render: (alpha: number) => void;
	/**
	 * Longest frame time processed at once, in milliseconds. After a long stall (a backgrounded
	 * tab, a debugger pause) the game resumes instead of fast-forwarding through the gap.
	 */
	maxFrameTime?: number;
	/** Injected for tests; default to requestAnimationFrame/cancelAnimationFrame. */
	requestFrame?: (callback: (time: number) => void) => number;
	cancelFrame?: (id: number) => void;
}

export interface GameLoop {
	start(): void;
	stop(): void;
	pause(): void;
	resume(): void;
	readonly running: boolean;
	readonly paused: boolean;
}

/**
 * Fixed-timestep loop over requestAnimationFrame: `update` runs at a steady rate regardless of
 * the display's refresh rate, and `render` runs once per frame.
 */
export function createGameLoop({
	step,
	update,
	render,
	maxFrameTime = 250,
	requestFrame = (callback) => requestAnimationFrame(callback),
	cancelFrame = (id) => cancelAnimationFrame(id)
}: GameLoopOptions): GameLoop {
	let running = false;
	let paused = false;
	let frameId: number | null = null;
	let lastTime: number | null = null;
	let accumulator = 0;

	function frame(time: number) {
		frameId = requestFrame(frame);

		// The first frame after start/resume only sets the baseline, so time spent stopped never counts.
		const elapsed = lastTime === null ? 0 : Math.min(time - lastTime, maxFrameTime);
		lastTime = time;
		accumulator += elapsed;

		// `update` may stop or pause the loop (e.g. on game over), so check before every step.
		while (accumulator >= step && running && !paused) {
			update(step);
			accumulator -= step;
		}
		if (running && !paused) render(accumulator / step);
	}

	function schedule() {
		lastTime = null;
		frameId = requestFrame(frame);
	}

	function cancel() {
		if (frameId !== null) cancelFrame(frameId);
		frameId = null;
	}

	return {
		start() {
			if (running) return;
			running = true;
			paused = false;
			accumulator = 0;
			schedule();
		},
		stop() {
			running = false;
			paused = false;
			cancel();
		},
		pause() {
			if (!running || paused) return;
			paused = true;
			cancel();
		},
		resume() {
			if (!running || !paused) return;
			paused = false;
			schedule();
		},
		get running() {
			return running;
		},
		get paused() {
			return paused;
		}
	};
}
