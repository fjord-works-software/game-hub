import { describe, expect, it } from 'vitest';
import { createGameLoop, type GameLoopOptions } from './gameLoop';

/** A manual stand-in for requestAnimationFrame: `tick(time)` runs the pending frame callback. */
function fakeFrames() {
	let pending: { id: number; callback: (time: number) => void } | null = null;
	let nextId = 0;
	return {
		requestFrame(callback: (time: number) => void) {
			pending = { id: ++nextId, callback };
			return nextId;
		},
		cancelFrame(id: number) {
			if (pending?.id === id) pending = null;
		},
		tick(time: number) {
			const frame = pending;
			pending = null;
			frame?.callback(time);
		},
		get scheduled() {
			return pending !== null;
		}
	};
}

function setup(options: Partial<GameLoopOptions> = {}) {
	const frames = fakeFrames();
	const updates: number[] = [];
	const renders: number[] = [];
	const loop = createGameLoop({
		step: 10,
		update: (step) => updates.push(step),
		render: (alpha) => renders.push(alpha),
		requestFrame: frames.requestFrame,
		cancelFrame: frames.cancelFrame,
		...options
	});
	return { loop, frames, updates, renders };
}

describe('createGameLoop', () => {
	it('runs one update per elapsed step and carries the remainder', () => {
		const { loop, frames, updates, renders } = setup();
		loop.start();
		frames.tick(1000); // baseline frame: no time has passed yet
		expect(updates).toHaveLength(0);

		frames.tick(1025); // 25ms: two steps, 5ms left over
		expect(updates).toEqual([10, 10]);
		expect(renders.at(-1)).toBeCloseTo(0.5);

		frames.tick(1030); // the leftover 5ms + 5ms makes a third step
		expect(updates).toHaveLength(3);
	});

	it('renders once per frame even when no update is due', () => {
		const { loop, frames, updates, renders } = setup();
		loop.start();
		frames.tick(0);
		frames.tick(4);
		expect(updates).toHaveLength(0);
		expect(renders).toHaveLength(2);
	});

	it('caps the time processed after a long stall', () => {
		const { loop, frames, updates } = setup({ maxFrameTime: 100 });
		loop.start();
		frames.tick(0);
		frames.tick(60_000); // a minute in a background tab
		expect(updates).toHaveLength(10); // 100ms cap / 10ms step
	});

	it('does not count time spent paused', () => {
		const { loop, frames, updates } = setup();
		loop.start();
		frames.tick(0);
		frames.tick(20);
		expect(updates).toHaveLength(2);

		loop.pause();
		expect(frames.scheduled).toBe(false);
		frames.tick(5000); // no frame is pending, so nothing happens

		loop.resume();
		frames.tick(10_000); // baseline after resume
		frames.tick(10_010);
		expect(updates).toHaveLength(3);
	});

	it('stops mid-frame when update stops the loop', () => {
		let loop!: ReturnType<typeof createGameLoop>;
		const frames = fakeFrames();
		let count = 0;
		loop = createGameLoop({
			step: 10,
			update: () => {
				count++;
				if (count === 2) loop.stop();
			},
			render: () => {},
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame
		});
		loop.start();
		frames.tick(0);
		frames.tick(100); // ten steps due, but the second one ends the game
		expect(count).toBe(2);
		expect(loop.running).toBe(false);
		expect(frames.scheduled).toBe(false);
	});

	it('ignores repeated start, pause, and resume calls', () => {
		const { loop, frames, updates } = setup();
		loop.start();
		loop.start();
		frames.tick(0);
		frames.tick(10);
		expect(updates).toHaveLength(1);

		loop.resume(); // not paused: no-op
		loop.pause();
		loop.pause();
		expect(loop.paused).toBe(true);
		loop.resume();
		expect(loop.paused).toBe(false);
		expect(frames.scheduled).toBe(true);
	});
});
