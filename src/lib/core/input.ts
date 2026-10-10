export type Direction = 'up' | 'down' | 'left' | 'right';
export type Action = Direction | 'action';

/** CSS pixels relative to the top-left of the element input is bound to. */
export interface Point {
	x: number;
	y: number;
}

/** Which on-screen buttons a game offers (shown by TouchControls.svelte when the player turns them on). */
export interface TouchLayout {
	/** Directions shown on the D-pad. */
	dpad: Direction[];
	/** Labelled buttons beside the D-pad, in order, each sending its action. */
	buttons?: { action: Action; label: string }[];
}

export interface InputHandlers {
	/**
	 * A key press, swipe, or on-screen button. `repeat` is true for the repeats sent while a key or
	 * on-screen button is held down; games ignore them for actions that shouldn't repeat.
	 */
	onAction?: (action: Action, repeat: boolean) => void;
	/** A short press without movement (touch, pen, or mouse click), at the point it started. */
	onTap?: (point: Point) => void;
	/**
	 * A finger, pen, or the primary mouse button went down, reported at once (a tap waits for it to
	 * lift). For things that should happen on contact, like firing a shot. Every press is reported,
	 * including ones that go on to become taps or swipes.
	 */
	onPress?: (point: Point) => void;
	/**
	 * A fast, long swipe released quickly (e.g. a flick down to hard-drop). It's reported as well as
	 * the swipes it made, so games that don't handle flicks still see the swipes.
	 */
	onFlick?: (direction: Direction) => void;
	/** The pointer moved over the element (mouse hover or touch drag), for aiming. */
	onPointerMove?: (point: Point) => void;
	/**
	 * A key or on-screen button for an action went down (`held` true) or came back up (false), for
	 * things that keep going while it's held, like moving a paddle. Swipes aren't reported, since they
	 * can't be held. An action stays held while any of its keys is (an arrow and its WASD key), and
	 * everything is let go when the window loses focus, so no key is left stuck down.
	 */
	onHold?: (action: Action, held: boolean) => void;
}

export interface GestureOptions {
	/** How far (CSS px) a pointer must travel along one axis to count as a swipe. */
	swipeDistance?: number;
	/** The furthest (CSS px) a press can move and still count as a tap. */
	tapDistance?: number;
	/** The longest (ms) a press can last and still count as a tap. */
	tapDuration?: number;
	/** How far (CSS px) a pointer must travel along one axis, overall, to count as a flick. */
	flickDistance?: number;
	/** The longest (ms) a flick can take from press to release. */
	flickDuration?: number;
}

export type Gesture =
	| { type: 'swipe'; direction: Direction }
	| { type: 'flick'; direction: Direction }
	| { type: 'tap'; point: Point };

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
 * Turns raw pointer positions into swipes, flicks, and taps. A swipe fires as soon as the pointer
 * has travelled far enough, without waiting for it to lift, and measuring restarts from that point,
 * so one continuous gesture can make several turns. Only the first active pointer is tracked.
 */
export function createGestureTracker({
	swipeDistance = 30,
	tapDistance = 10,
	tapDuration = 300,
	flickDistance = 60,
	flickDuration = 250
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

		up(id: number, point: Point, time: number): Gesture[] {
			if (active?.id !== id) return [];
			const gesture = active;
			active = null;
			const dx = point.x - gesture.start.x;
			const dy = point.y - gesture.start.y;
			const duration = time - gesture.startTime;
			const gestures: Gesture[] = [];

			// A quick flick can lift before any pointermove crossed the swipe distance.
			const swipe = gesture.swiped ? null : swipeDirection(dx, dy, swipeDistance);
			if (swipe) gestures.push({ type: 'swipe', direction: swipe });

			const flick = swipeDirection(dx, dy, flickDistance);
			if (flick && duration <= flickDuration) gestures.push({ type: 'flick', direction: flick });

			const furthest = Math.max(gesture.furthest, Math.hypot(dx, dy));
			if (!gesture.swiped && furthest <= tapDistance && duration <= tapDuration) {
				gestures.push({ type: 'tap', point: gesture.start });
			}
			return gestures;
		},

		cancel(id: number): void {
			if (active?.id === id) active = null;
		}
	};
}

// On-screen controls (TouchControls.svelte) send actions here; bindInput delivers them to the game
// exactly like key presses, so games need no code of their own for on-screen buttons.
const onScreenActions = new EventTarget();

type OnScreenAction = { action: Action; repeat: boolean };

/** Send an action from an on-screen control to the game whose input is currently bound. */
export function sendAction(action: Action, repeat = false): void {
	onScreenActions.dispatchEvent(new CustomEvent<OnScreenAction>('action', { detail: { action, repeat } }));
}

/** Tell the bound game that an on-screen control sending `action` was let go. */
export function releaseAction(action: Action): void {
	onScreenActions.dispatchEvent(new CustomEvent<Action>('release', { detail: action }));
}

/** Keys pressed while one of these has focus belong to it (e.g. Space on a menu button), not the game. */
function isInteractive(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || target.closest('button, a, input, select, textarea') !== null)
	);
}

/**
 * Sends keyboard actions (arrows/WASD, Space/Enter), on-screen control presses, which actions are
 * held down, and pointer presses, swipes, flicks, taps, and movement on `element` to `handlers`. Keyboard input is read from the whole window.
 * Returns a cleanup function.
 */
export function bindInput(element: HTMLElement, handlers: InputHandlers, options?: GestureOptions): () => void {
	const gestures = createGestureTracker(options);
	/** Keys held down, and the action each sends. */
	const heldKeys = new Map<string, Action>();

	function toPoint(event: PointerEvent): Point {
		const rect = element.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function emit(gesture: Gesture | null) {
		if (gesture?.type === 'swipe') handlers.onAction?.(gesture.direction, false);
		else if (gesture?.type === 'flick') handlers.onFlick?.(gesture.direction);
		else if (gesture?.type === 'tap') handlers.onTap?.(gesture.point);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || isInteractive(event.target)) return;
		const action = keyToAction(event.key);
		if (!action) return;
		event.preventDefault(); // stop arrows and Space from scrolling the page
		if (![...heldKeys.values()].includes(action)) handlers.onHold?.(action, true);
		heldKeys.set(event.key.toLowerCase(), action);
		handlers.onAction?.(action, event.repeat);
	}

	function onKeyUp(event: KeyboardEvent) {
		const action = heldKeys.get(event.key.toLowerCase());
		if (!action) return;
		heldKeys.delete(event.key.toLowerCase());
		if (![...heldKeys.values()].includes(action)) handlers.onHold?.(action, false);
	}

	/** Keys released while the window is in the background never send keyup, so let go of them all. */
	function onBlur() {
		const actions = new Set(heldKeys.values());
		heldKeys.clear();
		for (const action of actions) handlers.onHold?.(action, false);
	}

	function onOnScreenAction(event: Event) {
		const { action, repeat } = (event as CustomEvent<OnScreenAction>).detail;
		if (!repeat) handlers.onHold?.(action, true);
		handlers.onAction?.(action, repeat);
	}

	function onOnScreenRelease(event: Event) {
		handlers.onHold?.((event as CustomEvent<Action>).detail, false);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return; // primary button only; touch and pen also report 0
		const point = toPoint(event);
		handlers.onPress?.(point);
		gestures.down(event.pointerId, point, event.timeStamp);
		// Keep receiving moves even if the finger slides off the element mid-swipe.
		element.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		const point = toPoint(event);
		handlers.onPointerMove?.(point);
		emit(gestures.move(event.pointerId, point));
	}

	function onPointerUp(event: PointerEvent) {
		for (const gesture of gestures.up(event.pointerId, toPoint(event), event.timeStamp)) emit(gesture);
	}

	function onPointerCancel(event: PointerEvent) {
		gestures.cancel(event.pointerId);
	}

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);
	onScreenActions.addEventListener('action', onOnScreenAction);
	onScreenActions.addEventListener('release', onOnScreenRelease);
	element.addEventListener('pointerdown', onPointerDown);
	element.addEventListener('pointermove', onPointerMove);
	element.addEventListener('pointerup', onPointerUp);
	element.addEventListener('pointercancel', onPointerCancel);

	return () => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', onBlur);
		onScreenActions.removeEventListener('action', onOnScreenAction);
		onScreenActions.removeEventListener('release', onOnScreenRelease);
		element.removeEventListener('pointerdown', onPointerDown);
		element.removeEventListener('pointermove', onPointerMove);
		element.removeEventListener('pointerup', onPointerUp);
		element.removeEventListener('pointercancel', onPointerCancel);
	};
}
