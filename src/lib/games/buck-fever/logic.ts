// Buck Fever rules as pure functions over an immutable state: no DOM, no canvas, no timers.
// BuckFever.svelte feeds in elapsed time and shots, and draws whatever state comes back.
// Everything is in world units: pixels of a 320x180 scene, which the component scales up.

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export type Kind = 'doe' | 'buck';
/** Where a deer runs: 0 is the far side of the meadow, 2 the near side. */
export type Lane = 0 | 1 | 2;

/** A place a deer will stop to graze, and for how long. */
export interface Stop {
	x: number;
	ms: number;
}

export interface Deer {
	kind: Kind;
	lane: Lane;
	/** The centre of its body. */
	x: number;
	/** 1 runs right, -1 runs left. */
	direction: 1 | -1;
	/** World px per second at a normal run; fleeing is faster. */
	speed: number;
	/** Running and grazing until the first shot startles it into fleeing; down once it's hit. */
	mode: 'running' | 'grazing' | 'fleeing' | 'down';
	/** Ms of grazing left, or ms since it went down. */
	timer: number;
	/** Where it will stop to graze, in the order it reaches them. */
	stops: Stop[];
}

/** A tree standing between two lanes: deer behind it are hidden, and it stops shots. */
export interface Tree {
	x: number;
	/** 0 stands between the far and middle lanes, 1 between the middle and near lanes. */
	row: 0 | 1;
}

/** What a shot lands on: a deer or a tree (by index in the state's lists). */
export type Target = { kind: 'deer'; index: number } | { kind: 'tree'; index: number };

/**
 * waiting: for the first input. intro: "Round N" before the first wave. wave: deer on the field.
 * between: a pause between waves. tally: the round's result. over: the game has ended.
 */
export type Phase = 'waiting' | 'intro' | 'wave' | 'between' | 'tally' | 'over';

export interface BuckFeverState {
	phase: Phase;
	/** Ms spent in the current phase. */
	phaseElapsed: number;
	round: number;
	score: number;
	/** This round's deer so far, in the order they were settled: true if hit, false if it got away. */
	results: boolean[];
	/** Shells left in this wave. */
	shells: number;
	deer: Deer[];
	/** This round's trees, replanted each round. */
	trees: Tree[];
}

/** Returns a number in [0, 1), like Math.random; injectable so tests are deterministic. */
export type Random = () => number;

export const WIDTH = 320;
export const HEIGHT = 180;
/** The meadow's running lanes, far to near: the row their hooves touch, and how big deer look there. */
export const LANES = [
	{ y: 118, scale: 0.7 },
	{ y: 139, scale: 0.85 },
	{ y: 160, scale: 1 }
] as const;
/** Where trees stand, far to near: the row their trunks meet the ground, and how big they look there. */
export const TREE_ROWS = [
	{ y: 129, scale: 0.78 },
	{ y: 150, scale: 0.92 }
] as const;
export const DEER_PER_ROUND = 10;
export const SHELLS_PER_WAVE = 3;
/** How long a hit deer stays on the field before it's cleared away. */
export const DOWN_MS = 1000;

/** A deer's reach from its centre at full size, facing right: back to its tail, forward to its nose, and up to its ears. */
const DEER_BACK = 11;
const DEER_FRONT = 16;
const DEER_HEIGHT = 25;
const INTRO_MS = 1500;
const WAVE_GAP_MS = 800;
const TALLY_MS = 2500;
/** A near-lane doe's run in round 1, in world px per second. */
const BASE_SPEED = 60;
const SPEED_PER_ROUND = 0.12;
/** Deer stop getting faster after this round. */
const MAX_SPEED_ROUND = 10;
const BUCK_SPEED = 1.25;
const FLEE_SPEED = 1.7;
const BUCK_CHANCE = 0.3;
/** Points for a hit, multiplied by the round. */
const POINTS: Record<Kind, number> = { doe: 100, buck: 300 };
/** Points for hitting all ten deer in a round, multiplied by the round. */
export const PERFECT_BONUS = 1000;
/** Deer stop to graze somewhere in the middle of the field, for a while that shrinks in later rounds. */
const STOP_FROM = 70;
const STOP_TO = 250;
const GRAZE_MIN_MS = 500;
const GRAZE_MAX_MS = 1300;
/** Trees are planted somewhere in this stretch of the field, at least this far apart. */
const TREES_FROM = 40;
const TREES_TO = 280;
const TREE_GAP = 50;

/** Hits out of ten needed to reach the next round: 6 in rounds 1-2, rising to 9 from round 7. */
export function hitsNeeded(round: number): number {
	return Math.min(9, 6 + Math.floor((round - 1) / 2));
}

/** Deer that run at once: one at a time in the first two rounds, then pairs. */
export function waveSize(round: number): number {
	return round <= 2 ? 1 : 2;
}

/** Trees on the field: two at first, three from round 3. */
export function treeCount(round: number): number {
	return round <= 2 ? 2 : 3;
}

/** Running speed: faster each round, faster for bucks, and slower-looking on the far side of the meadow. */
export function deerSpeed(round: number, lane: Lane, kind: Kind): number {
	const rounds = Math.min(round, MAX_SPEED_ROUND) - 1;
	return BASE_SPEED * (1 + rounds * SPEED_PER_ROUND) * LANES[lane].scale * (kind === 'buck' ? BUCK_SPEED : 1);
}

/** The area a deer covers, which is also where a shot hits it. */
export function deerBox(deer: Deer): Box {
	const { y, scale } = LANES[deer.lane];
	const back = DEER_BACK * scale;
	const front = DEER_FRONT * scale;
	return {
		left: deer.direction === 1 ? deer.x - back : deer.x - front,
		right: deer.direction === 1 ? deer.x + front : deer.x + back,
		top: y - DEER_HEIGHT * scale,
		bottom: y
	};
}

/** The box, enlarged about its centre to at least `size` in each direction. */
function atLeast(box: Box, size: number): Box {
	const growX = Math.max(0, size - (box.right - box.left)) / 2;
	const growY = Math.max(0, size - (box.bottom - box.top)) / 2;
	return { left: box.left - growX, right: box.right + growX, top: box.top - growY, bottom: box.bottom + growY };
}

const contains = (box: Box, { x, y }: Point) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** A tree's trunk and the oval of its leaves, which is also where it stops shots. */
export function treeParts(tree: Tree): { trunk: Box; canopy: { x: number; y: number; rx: number; ry: number } } {
	const { y, scale } = TREE_ROWS[tree.row];
	return {
		trunk: { left: tree.x - 2.5 * scale, right: tree.x + 2.5 * scale, top: y - 20 * scale, bottom: y },
		canopy: { x: tree.x, y: y - 33 * scale, rx: 16 * scale, ry: 14 * scale }
	};
}

function treeContains(tree: Tree, point: Point): boolean {
	const { trunk, canopy } = treeParts(tree);
	return contains(trunk, point) || ((point.x - canopy.x) / canopy.rx) ** 2 + ((point.y - canopy.y) / canopy.ry) ** 2 <= 1;
}

/** Trees for a round, at random places across the field, spaced apart, and sorted left to right. */
function plantTrees(round: number, random: Random): Tree[] {
	const trees: Tree[] = [];
	for (let attempt = 0; trees.length < treeCount(round) && attempt < 100; attempt++) {
		const x = Math.round(TREES_FROM + random() * (TREES_TO - TREES_FROM));
		const row = random() < 0.5 ? 0 : 1;
		if (trees.every((tree) => Math.abs(tree.x - x) >= TREE_GAP)) trees.push({ x, row });
	}
	return trees.sort((a, b) => a.x - b.x);
}

export function createGame(random: Random): BuckFeverState {
	return {
		phase: 'waiting',
		phaseElapsed: 0,
		round: 1,
		score: 0,
		results: [],
		shells: SHELLS_PER_WAVE,
		deer: [],
		trees: plantTrees(1, random)
	};
}

export function start(state: BuckFeverState): BuckFeverState {
	return state.phase === 'waiting' ? { ...state, phase: 'intro', phaseElapsed: 0 } : state;
}

/** A deer just off one edge of the field, about to run across it. */
function newDeer(round: number, lane: Lane, random: Random): Deer {
	const direction = random() < 0.5 ? 1 : -1;
	const kind: Kind = random() < BUCK_CHANCE ? 'buck' : 'doe';
	const grazeScale = Math.max(0.4, 1 - (round - 1) * 0.08);
	const stopCount = Math.floor(random() * 3);
	const stops = Array.from({ length: stopCount }, () => ({
		x: STOP_FROM + random() * (STOP_TO - STOP_FROM),
		ms: (GRAZE_MIN_MS + random() * (GRAZE_MAX_MS - GRAZE_MIN_MS)) * grazeScale
	})).sort((a, b) => direction * (a.x - b.x));
	// Start with its nose just past the edge, out of sight.
	const offEdge = DEER_FRONT * LANES[lane].scale + 1;
	return {
		kind,
		lane,
		x: direction === 1 ? -offEdge : WIDTH + offEdge,
		direction,
		speed: deerSpeed(round, lane, kind),
		mode: 'running',
		timer: 0,
		stops
	};
}

function beginWave(state: BuckFeverState, random: Random): BuckFeverState {
	// Deer that run together each get their own lane.
	const lanes: Lane[] = [0, 1, 2];
	for (let i = lanes.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[lanes[i], lanes[j]] = [lanes[j], lanes[i]];
	}
	const count = Math.min(waveSize(state.round), DEER_PER_ROUND - state.results.length);
	const deer = lanes.slice(0, count).map((lane) => newDeer(state.round, lane, random));
	return { ...state, phase: 'wave', phaseElapsed: 0, shells: SHELLS_PER_WAVE, deer };
}

function endRound(state: BuckFeverState): BuckFeverState {
	const perfect = state.results.every(Boolean);
	return {
		...state,
		phase: 'tally',
		phaseElapsed: 0,
		score: perfect ? state.score + PERFECT_BONUS * state.round : state.score
	};
}

function moveDeer(deer: Deer, ms: number): Deer {
	if (deer.mode === 'down') return { ...deer, timer: deer.timer + ms };
	if (deer.mode === 'grazing') {
		const timer = deer.timer - ms;
		return timer > 0 ? { ...deer, timer } : { ...deer, mode: 'running', timer: 0 };
	}
	const speed = deer.mode === 'fleeing' ? deer.speed * FLEE_SPEED : deer.speed;
	const x = deer.x + (deer.direction * speed * ms) / 1000;
	const [stop, ...stops] = deer.stops;
	if (deer.mode === 'running' && stop && deer.direction * (x - stop.x) >= 0) {
		return { ...deer, x: stop.x, mode: 'grazing', timer: stop.ms, stops };
	}
	return { ...deer, x };
}

function escaped(deer: Deer): boolean {
	const box = deerBox(deer);
	return deer.direction === 1 ? box.left > WIDTH : box.right < 0;
}

/** Move the deer: a hit deer is cleared away after a moment, and one that runs off the field has got away. */
function runWave(state: BuckFeverState, ms: number): BuckFeverState {
	const results = [...state.results];
	const deer: Deer[] = [];
	for (const current of state.deer) {
		const next = moveDeer(current, ms);
		if (next.mode === 'down' && next.timer >= DOWN_MS) continue; // counted when it was hit
		if (next.mode !== 'down' && escaped(next)) {
			results.push(false);
			continue;
		}
		deer.push(next);
	}
	const next = { ...state, deer, results, phaseElapsed: state.phaseElapsed + ms };
	if (deer.length > 0) return next;
	return results.length >= DEER_PER_ROUND ? endRound(next) : { ...next, phase: 'between', phaseElapsed: 0 };
}

/** Advance the clock by `ms`. Nothing happens before the game starts or after it ends. */
export function advance(state: BuckFeverState, ms: number, random: Random): BuckFeverState {
	const elapsed = state.phaseElapsed + ms;
	switch (state.phase) {
		case 'waiting':
		case 'over':
			return state;
		case 'intro':
		case 'between':
			return elapsed >= (state.phase === 'intro' ? INTRO_MS : WAVE_GAP_MS)
				? beginWave(state, random)
				: { ...state, phaseElapsed: elapsed };
		case 'wave':
			return runWave(state, ms);
		case 'tally':
			if (elapsed < TALLY_MS) return { ...state, phaseElapsed: elapsed };
			if (state.results.filter(Boolean).length < hitsNeeded(state.round)) return { ...state, phase: 'over' };
			return {
				...state,
				phase: 'intro',
				phaseElapsed: 0,
				round: state.round + 1,
				results: [],
				trees: plantTrees(state.round + 1, random)
			};
	}
}

/**
 * What a shot at `point` lands on: whatever is nearest the front there. A deer counts if the point
 * is in its box, enlarged to at least `minHitSize` so small targets stay easy to tap (of two deer
 * in one lane, the one whose middle is closer); a tree counts if the point is on its trunk or leaves.
 */
export function targetAt(state: BuckFeverState, point: Point, minHitSize: number): Target | null {
	let best: { target: Target; depth: number; distance: number } | null = null;
	for (const [index, deer] of state.deer.entries()) {
		if (deer.mode === 'down' || !contains(atLeast(deerBox(deer), minHitSize), point)) continue;
		const box = deerBox(deer);
		const distance = Math.hypot(point.x - (box.left + box.right) / 2, point.y - (box.top + box.bottom) / 2);
		if (!best || deer.lane > best.depth || (deer.lane === best.depth && distance < best.distance)) {
			best = { target: { kind: 'deer', index }, depth: deer.lane, distance };
		}
	}
	for (const [index, tree] of state.trees.entries()) {
		// A tree stands just in front of the lane with its number.
		const depth = tree.row + 0.5;
		if (treeContains(tree, point) && (!best || depth > best.depth)) best = { target: { kind: 'tree', index }, depth, distance: 0 };
	}
	return best?.target ?? null;
}

/**
 * Fire a shell at `point`, hitting whatever `targetAt` finds there; a tree in front stops the shot.
 * Every shot startles the deer still standing: they stop grazing and bolt. When more than one is
 * running, each startled deer picks a way at random: back the way it came, or on ahead.
 * Only works while deer are on the field.
 */
export function shoot(state: BuckFeverState, point: Point, minHitSize: number, random: Random): BuckFeverState {
	if (state.phase !== 'wave' || state.shells === 0) return state;

	const target = targetAt(state, point, minHitSize);
	const hit = target?.kind === 'deer' ? state.deer[target.index] : null;
	const running = state.deer.filter((deer) => deer.mode !== 'down').length;
	const deer = state.deer.map((current): Deer => {
		if (current === hit) return { ...current, mode: 'down', timer: 0, stops: [] };
		if (current.mode === 'down') return current;
		const turnBack = running > 1 && random() < 0.5;
		const direction = turnBack ? (current.direction === 1 ? -1 : 1) : current.direction;
		return { ...current, direction, mode: 'fleeing', timer: 0, stops: [] };
	});
	return {
		...state,
		shells: state.shells - 1,
		deer,
		score: hit ? state.score + POINTS[hit.kind] * state.round : state.score,
		results: hit ? [...state.results, true] : state.results
	};
}
