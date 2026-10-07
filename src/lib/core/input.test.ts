import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindInput, createGestureTracker, keyToAction, sendAction, swipeDirection, type Action } from './input';

describe('keyToAction', () => {
	it('maps arrows and WASD (either case) to directions', () => {
		expect(keyToAction('ArrowUp')).toBe('up');
		expect(keyToAction('ArrowLeft')).toBe('left');
		expect(keyToAction('s')).toBe('down');
		expect(keyToAction('D')).toBe('right'); // Caps Lock or Shift
	});

	it('maps Space and Enter to action', () => {
		expect(keyToAction(' ')).toBe('action');
		expect(keyToAction('Enter')).toBe('action');
	});

	it('ignores everything else', () => {
		expect(keyToAction('Escape')).toBeNull();
		expect(keyToAction('x')).toBeNull();
		expect(keyToAction('Shift')).toBeNull();
	});
});

describe('swipeDirection', () => {
	it('returns null below the distance on both axes', () => {
		expect(swipeDirection(29, -29, 30)).toBeNull();
	});

	it('picks the dominant axis', () => {
		expect(swipeDirection(40, 10, 30)).toBe('right');
		expect(swipeDirection(-40, 35, 30)).toBe('left');
		expect(swipeDirection(5, 40, 30)).toBe('down');
		expect(swipeDirection(-20, -40, 30)).toBe('up');
	});
});

describe('createGestureTracker', () => {
	const at = (x: number, y: number) => ({ x, y });

	it('reports a short, still press as a tap at the point it started', () => {
		const tracker = createGestureTracker();
		tracker.down(1, at(100, 100), 0);
		tracker.move(1, at(103, 102));
		expect(tracker.up(1, at(104, 102), 120)).toEqual([{ type: 'tap', point: at(100, 100) }]);
	});

	it('does not treat a long press as a tap', () => {
		const tracker = createGestureTracker({ tapDuration: 300 });
		tracker.down(1, at(100, 100), 0);
		expect(tracker.up(1, at(100, 100), 800)).toEqual([]);
	});

	it('does not treat a press that wandered as a tap', () => {
		const tracker = createGestureTracker({ tapDistance: 10, swipeDistance: 30 });
		tracker.down(1, at(100, 100), 0);
		tracker.move(1, at(120, 100)); // past the tap distance, short of a swipe
		expect(tracker.up(1, at(102, 100), 100)).toEqual([]);
	});

	it('fires a swipe mid-gesture, before the pointer lifts', () => {
		const tracker = createGestureTracker({ swipeDistance: 30 });
		tracker.down(1, at(0, 0), 0);
		expect(tracker.move(1, at(20, 0))).toBeNull();
		expect(tracker.move(1, at(35, 4))).toEqual({ type: 'swipe', direction: 'right' });
	});

	it('detects several turns in one continuous gesture', () => {
		const tracker = createGestureTracker({ swipeDistance: 30 });
		tracker.down(1, at(0, 0), 0);
		expect(tracker.move(1, at(40, 0))).toEqual({ type: 'swipe', direction: 'right' });
		expect(tracker.move(1, at(45, 10))).toBeNull(); // measured from where the last swipe fired
		expect(tracker.move(1, at(45, 45))).toEqual({ type: 'swipe', direction: 'down' });
		expect(tracker.up(1, at(45, 46), 300)).toEqual([]); // no extra tap or swipe on release
	});

	it('catches a quick flick that lifts before any move crossed the distance', () => {
		const tracker = createGestureTracker({ swipeDistance: 30 });
		tracker.down(1, at(100, 100), 0);
		tracker.move(1, at(100, 85));
		expect(tracker.up(1, at(100, 60), 80)).toEqual([{ type: 'swipe', direction: 'up' }]);
	});

	it('ignores a second finger while the first is down', () => {
		const tracker = createGestureTracker({ swipeDistance: 30 });
		tracker.down(1, at(0, 0), 0);
		tracker.down(2, at(200, 200), 10);
		expect(tracker.move(2, at(300, 200))).toBeNull();
		expect(tracker.up(2, at(300, 200), 50)).toEqual([]);
		expect(tracker.up(1, at(1, 1), 60)).toEqual([{ type: 'tap', point: at(0, 0) }]);
	});

	it('forgets a cancelled pointer (e.g. the browser took over the gesture)', () => {
		const tracker = createGestureTracker();
		tracker.down(1, at(0, 0), 0);
		tracker.cancel(1);
		expect(tracker.up(1, at(0, 0), 50)).toEqual([]);
		tracker.down(2, at(5, 5), 100); // a new gesture can start
		expect(tracker.up(2, at(5, 5), 150)).toEqual([{ type: 'tap', point: at(5, 5) }]);
	});

	it('reports a fast, long swipe as a flick on release, after the swipes it made', () => {
		const tracker = createGestureTracker({ swipeDistance: 30, flickDistance: 60, flickDuration: 250 });
		tracker.down(1, at(0, 0), 0);
		expect(tracker.move(1, at(0, 35))).toEqual({ type: 'swipe', direction: 'down' });
		expect(tracker.move(1, at(0, 70))).toEqual({ type: 'swipe', direction: 'down' });
		expect(tracker.up(1, at(2, 90), 150)).toEqual([{ type: 'flick', direction: 'down' }]);
	});

	it('reports both a swipe and a flick when a flick lifts before any move crossed the swipe distance', () => {
		const tracker = createGestureTracker({ swipeDistance: 30, flickDistance: 60, flickDuration: 250 });
		tracker.down(1, at(0, 0), 0);
		expect(tracker.up(1, at(-80, 5), 90)).toEqual([
			{ type: 'swipe', direction: 'left' },
			{ type: 'flick', direction: 'left' }
		]);
	});

	it('does not treat a slow drag or a short swipe as a flick', () => {
		const tracker = createGestureTracker({ swipeDistance: 30, flickDistance: 60, flickDuration: 250 });
		tracker.down(1, at(0, 0), 0);
		tracker.move(1, at(0, 35));
		tracker.move(1, at(0, 70));
		expect(tracker.up(1, at(0, 90), 600)).toEqual([]); // too slow
		tracker.down(2, at(0, 0), 1000);
		expect(tracker.up(2, at(0, 40), 1080)).toEqual([{ type: 'swipe', direction: 'down' }]); // too short
	});
});

describe('sendAction (on-screen controls)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('delivers actions to the bound game like key presses, until unbound', () => {
		vi.stubGlobal('window', new EventTarget());
		const received: [Action, boolean][] = [];
		const unbind = bindInput(new EventTarget() as HTMLElement, {
			onAction: (action, repeat) => received.push([action, repeat])
		});

		sendAction('up');
		sendAction('action');
		sendAction('down', true); // held button repeating
		expect(received).toEqual([
			['up', false],
			['action', false],
			['down', true]
		]);

		unbind();
		sendAction('left');
		expect(received).toHaveLength(3);
	});
});
