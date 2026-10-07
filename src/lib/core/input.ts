export type Direction = 'up' | 'down' | 'left' | 'right';
export type Action = Direction | 'action';

/** CSS pixels relative to the top-left of the element input is bound to. */
export interface Point {
	x: number;
	y: number;
}

export interface InputHandlers {
	/** A key press or swipe. `repeat` is true for keyboard auto-repeat while a key is held. */
	onAction?: (action: Action, repeat: boolean) => void;
	/** A short press without movement (touch, pen, or mouse click), at the point it started. */
	onTap?: (point: Point) => void;
	/** The pointer moved over the element (mouse hover or touch drag), for aiming. */
	onPointerMove?: (point: Point) => void;
}

export interface GestureOptions {
	/** How far (CSS px) a pointer must travel along one axis to count as a swipe. */
	swipeDistance?: number;
	/** The furthest (CSS px) a press can move and still count as a tap. */
	tapDistance?: number;
	/** The longest (ms) a press can last and still count as a tap. */
	tapDuration?: number;
}

export type Gesture = { type: 'swipe'; direction: Direction } | { type: 'tap'; point: Point };

const KEY_ACTIONS: Record<string, Action> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	w: 'up',
	s: 'down',
	a: 'left',
	d: 'right',
	' ': 'action',
	Enter: 'action'
};

export function keyToAction(key: string): Action | null {
	return KEY_ACTIONS[key.length === 1 ? key.toLowerCase() : key] ?? null;
}

/** The dominant direction of a movement, or null if it's shorter than `minDistance` on both axes. */
export function swipeDirection(dx: number, dy: number, minDistance: number): Direction | null {
	if (Math.max(Math.abs(dx), Math.abs(dy)) < minDistance) return null;
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'down' : 'up';
}

/**
 * Turns raw pointer positions into swipes and taps. A swipe fires as soon as the pointer has
 * travelled far enough, without waiting for it to lift, and measuring restarts from that point,
 * so one continuous gesture can make several turns. Only the first active pointer is tracked.
 */
export function createGestureTracker({
	swipeDistance = 30,
	tapDistance = 10,
	tapDuration = 300
}: GestureOptions = {}) {
	let active: {
		id: number;
		start: Point;
		startTime: number;
		anchor: Point;
		furthest: number;
		swiped: boolean;
	} | null = null;

	return {
		down(id: number, point: Point, time: number): void {
			if (active) return;
			active = { id, start: point, startTime: time, anchor: point, furthest: 0, swiped: false };
		},

		move(id: number, point: Point): Gesture | null {
			if (active?.id !== id) return null;
			active.furthest = Math.max(active.furthest, Math.hypot(point.x - active.start.x, point.y - active.start.y));
			const direction = swipeDirection(point.x - active.anchor.x, point.y - active.anchor.y, swipeDistance);
			if (!direction) return null;
			active.anchor = point;
			active.swiped = true;
			return { type: 'swipe', direction };
		},

		up(id: number, point: Point, time: number): Gesture | null {
			if (active?.id !== id) return null;
			const gesture = active;
			active = null;
			if (gesture.swiped) return null;

			// A quick flick can lift before any pointermove crossed the swipe distance.
			const direction = swipeDirection(point.x - gesture.start.x, point.y - gesture.start.y, swipeDistance);
			if (direction) return { type: 'swipe', direction };

			const furthest = Math.max(gesture.furthest, Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
			if (furthest <= tapDistance && time - gesture.startTime <= tapDuration) {
				return { type: 'tap', point: gesture.start };
			}
			return null;
		},

		cancel(id: number): void {
			if (active?.id === id) active = null;
		}
	};
}

/** Keys pressed while one of these has focus belong to it (e.g. Space on a menu button), not the game. */
function isInteractive(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || target.closest('button, a, input, select, textarea') !== null)
	);
}

/**
 * Sends keyboard actions (arrows/WASD, Space/Enter) and pointer swipes, taps, and movement on
 * `element` to `handlers`. Keyboard input is read from the whole window. Returns a cleanup function.
 */
export function bindInput(element: HTMLElement, handlers: InputHandlers, options?: GestureOptions): () => void {
	const gestures = createGestureTracker(options);

	function toPoint(event: PointerEvent): Point {
		const rect = element.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function emit(gesture: Gesture | null) {
		if (gesture?.type === 'swipe') handlers.onAction?.(gesture.direction, false);
		else if (gesture?.type === 'tap') handlers.onTap?.(gesture.point);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || isInteractive(event.target)) return;
		const action = keyToAction(event.key);
		if (!action) return;
		event.preventDefault(); // stop arrows and Space from scrolling the page
		handlers.onAction?.(action, event.repeat);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return; // primary button only; touch and pen also report 0
		gestures.down(event.pointerId, toPoint(event), event.timeStamp);
		// Keep receiving moves even if the finger slides off the element mid-swipe.
		element.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		const point = toPoint(event);
		handlers.onPointerMove?.(point);
		emit(gestures.move(event.pointerId, point));
	}

	function onPointerUp(event: PointerEvent) {
		emit(gestures.up(event.pointerId, toPoint(event), event.timeStamp));
	}

	function onPointerCancel(event: PointerEvent) {
		gestures.cancel(event.pointerId);
	}

	window.addEventListener('keydown', onKeyDown);
	element.addEventListener('pointerdown', onPointerDown);
	element.addEventListener('pointermove', onPointerMove);
	element.addEventListener('pointerup', onPointerUp);
	element.addEventListener('pointercancel', onPointerCancel);

	return () => {
		window.removeEventListener('keydown', onKeyDown);
		element.removeEventListener('pointerdown', onPointerDown);
		element.removeEventListener('pointermove', onPointerMove);
		element.removeEventListener('pointerup', onPointerUp);
		element.removeEventListener('pointercancel', onPointerCancel);
	};
}
