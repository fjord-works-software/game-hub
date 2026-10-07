import { describe, expect, it } from 'vitest';
import {
	advance,
	createGame,
	deerBox,
	deerSpeed,
	DOWN_MS,
	hitsNeeded,
	shoot,
	start,
	targetAt,
	treeParts,
	waveSize,
	WIDTH,
	type BuckFeverState,
	type Deer,
	type Point,
	type Random,
	type Tree
} from './logic';

const first: Random = () => 0;
const last: Random = () => 0.99;

/** A small deterministic random sequence (a linear congruential generator). */
function seeded(seed: number): Random {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

/** A deer on the field, by default a doe running right across the near lane. */
const deer = (overrides: Partial<Deer> = {}): Deer => ({
	kind: 'doe',
	lane: 2,
	x: 160,
	direction: 1,
	speed: 60,
	mode: 'running',
	timer: 0,
	stops: [],
	...overrides
});

/** A round in progress with these deer on the field, and no trees unless given. */
const wave = (field: Deer[], overrides: Partial<BuckFeverState> = {}): BuckFeverState => ({
	...createGame(first),
	phase: 'wave',
	deer: field,
	trees: [],
	...overrides
});

const centre = (target: Deer): Point => {
	const box = deerBox(target);
	return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
};

describe('starting', () => {
	it('waits for the first input, then announces the round before any deer appear', () => {
		const waiting = createGame(first);
		expect(waiting).toMatchObject({ phase: 'waiting', round: 1, score: 0, deer: [] });
		expect(advance(waiting, 10_000, first)).toBe(waiting);

		let state = start(waiting);
		expect(state.phase).toBe('intro');
		state = advance(state, 1499, first);
		expect(state.deer).toEqual([]);
		state = advance(state, 1, first);
		expect(state.phase).toBe('wave');
		expect(state.deer).toHaveLength(1);
		expect(state.shells).toBe(3);
	});

	it('does nothing once the game is under way', () => {
		const state = wave([deer()]);
		expect(start(state)).toBe(state);
	});
});

describe('waves', () => {
	it('deer start just out of sight at either edge and run across', () => {
		const intro = start(createGame(first));
		const fromLeft = advance(intro, 1500, first).deer[0];
		expect(fromLeft.direction).toBe(1);
		expect(deerBox(fromLeft).right).toBeLessThan(0);
		const fromRight = advance(intro, 1500, last).deer[0];
		expect(fromRight.direction).toBe(-1);
		expect(deerBox(fromRight).left).toBeGreaterThan(WIDTH);

		const later = advance(wave([fromLeft]), 1000, first).deer[0];
		expect(later.x).toBeGreaterThan(fromLeft.x);
	});

	it('sends one deer at a time in rounds 1 and 2, then pairs in different lanes', () => {
		expect([1, 2, 3, 8].map(waveSize)).toEqual([1, 1, 2, 2]);
		const pair = advance({ ...start(createGame(first)), round: 3 }, 1500, first).deer;
		expect(pair).toHaveLength(2);
		expect(pair[0].lane).not.toBe(pair[1].lane);
	});

	it('deer get faster each round up to round 10; bucks are faster, and far-side deer cover less ground', () => {
		expect(deerSpeed(1, 2, 'doe')).toBe(60);
		expect(deerSpeed(2, 2, 'doe')).toBeGreaterThan(deerSpeed(1, 2, 'doe'));
		expect(deerSpeed(30, 2, 'doe')).toBe(deerSpeed(10, 2, 'doe'));
		expect(deerSpeed(1, 2, 'buck')).toBeGreaterThan(deerSpeed(1, 2, 'doe'));
		expect(deerSpeed(1, 0, 'doe')).toBeLessThan(deerSpeed(1, 2, 'doe'));
	});

	it('stops to graze, then runs on', () => {
		let state = wave([deer({ x: 100, stops: [{ x: 110, ms: 500 }] })]);
		state = advance(state, 1000, first);
		expect(state.deer[0]).toMatchObject({ x: 110, mode: 'grazing', timer: 500 });
		state = advance(state, 499, first);
		expect(state.deer[0]).toMatchObject({ x: 110, mode: 'grazing' });
		state = advance(state, 1, first);
		expect(state.deer[0].mode).toBe('running');
		state = advance(state, 1000, first);
		expect(state.deer[0].x).toBe(170);
	});

	it('a deer that runs off the field gets away, and the next wave follows a moment later', () => {
		let state = advance(wave([deer({ x: WIDTH + 5 })]), 1000, first);
		expect(state.results).toEqual([false]);
		expect(state.deer).toEqual([]);
		expect(state.phase).toBe('between');
		state = advance(state, 799, first);
		expect(state.deer).toEqual([]);
		state = advance(state, 1, first);
		expect(state).toMatchObject({ phase: 'wave', shells: 3 });
		expect(state.deer).toHaveLength(1);
	});

	it('tallies the round once ten deer have run', () => {
		const state = advance(wave([deer({ x: WIDTH + 5 })], { results: Array(9).fill(true) }), 1000, first);
		expect(state.results).toHaveLength(10);
		expect(state.phase).toBe('tally');
	});
});

describe('shooting', () => {
	it('a hit downs the deer and scores 100 for a doe or 300 for a buck, times the round', () => {
		const doe = deer();
		const hit = shoot(wave([doe], { round: 2 }), centre(doe), 0, first);
		expect(hit.deer[0].mode).toBe('down');
		expect(hit).toMatchObject({ score: 200, results: [true], shells: 2 });

		const buck = deer({ kind: 'buck' });
		expect(shoot(wave([buck]), centre(buck), 0, first).score).toBe(300);
	});

	it('a miss costs a shell and startles the deer into a faster run', () => {
		const grazing = deer({ x: 100, mode: 'grazing', timer: 900, stops: [{ x: 200, ms: 500 }] });
		const missed = shoot(wave([grazing]), { x: 300, y: 20 }, 0, first);
		expect(missed).toMatchObject({ shells: 2, score: 0, results: [] });
		expect(missed.deer[0]).toMatchObject({ mode: 'fleeing', stops: [] });
		expect(advance(missed, 1000, first).deer[0].x).toBeCloseTo(100 + 60 * 1.7);
	});

	it('hitting one deer sends the rest of the wave fleeing', () => {
		const near = deer({ lane: 2, x: 100 });
		const far = deer({ lane: 0, x: 220, direction: -1 });
		const state = shoot(wave([near, far]), centre(near), 0, first);
		expect(state.deer.map((d) => d.mode)).toEqual(['down', 'fleeing']);
	});

	it('one shot hits one deer: the nearer one when they overlap', () => {
		const far = deer({ lane: 1, x: 150 });
		const near = deer({ lane: 2, x: 150 });
		// Where the two boxes overlap: near's top half and far's bottom half.
		const box = deerBox(near);
		const state = shoot(wave([far, near]), { x: 150, y: box.top + 2 }, 0, first);
		expect(state.deer.map((d) => d.mode)).toEqual(['fleeing', 'down']);
		expect(state.results).toEqual([true]);
	});

	it('small targets are enlarged to the minimum hit size', () => {
		const small = deer({ lane: 0 });
		const box = deerBox(small);
		const justAbove = { x: centre(small).x, y: box.top - 8 };
		expect(box.bottom - box.top).toBeLessThan(44);
		expect(shoot(wave([small]), justAbove, 0, first).results).toEqual([]);
		expect(shoot(wave([small]), justAbove, 44, first).results).toEqual([true]);
	});

	it("a downed deer can't be hit again, and is cleared away after a second, counted once", () => {
		const target = deer();
		let state = shoot(wave([target]), centre(target), 0, first);
		state = shoot(state, centre(target), 0, first);
		expect(state).toMatchObject({ results: [true], shells: 1, score: 100 });
		state = advance(state, DOWN_MS - 1, first);
		expect(state.deer).toHaveLength(1);
		state = advance(state, 1, first);
		expect(state.deer).toEqual([]);
		expect(state.results).toEqual([true]);
	});

	it('does nothing with no shells left, or while no deer are on the field', () => {
		const empty = wave([deer()], { shells: 0 });
		expect(shoot(empty, centre(deer()), 44, first)).toBe(empty);
		for (const phase of ['waiting', 'intro', 'between', 'tally', 'over'] as const) {
			const state = { ...wave([deer()]), phase };
			expect(shoot(state, centre(deer()), 44, first)).toBe(state);
		}
	});
});

describe('trees', () => {
	it('stand at new places each round, spaced apart: two at first, three from round 3', () => {
		const spacedApart = (trees: Tree[]) =>
			trees.every((tree, i) => tree.x >= 40 && tree.x <= 280 && (i === 0 || tree.x - trees[i - 1].x >= 50));
		const game = createGame(seeded(1));
		expect(game.trees).toHaveLength(2);
		expect(spacedApart(game.trees)).toBe(true);

		const passed = (state: BuckFeverState): BuckFeverState => ({ ...state, phase: 'tally', results: Array(10).fill(true) });
		const round2 = advance(passed(game), 2500, seeded(2));
		expect(round2.round).toBe(2);
		expect(round2.trees).toHaveLength(2);
		expect(round2.trees).not.toEqual(game.trees);
		const round3 = advance(passed(round2), 2500, seeded(3));
		expect(round3.trees).toHaveLength(3);
		expect(spacedApart(round3.trees)).toBe(true);
	});

	it('stop a shot at a deer behind them, though the shot still startles it', () => {
		const tree: Tree = { x: 150, row: 0 };
		const state = wave([deer({ lane: 0, x: 150 })], { trees: [tree] });
		const leaves = { x: 150, y: treeParts(tree).canopy.y };
		expect(targetAt(state, leaves, 0)).toEqual({ kind: 'tree', index: 0 });
		const shot = shoot(state, leaves, 44, first);
		expect(shot).toMatchObject({ results: [], shells: 2, score: 0 });
		expect(shot.deer[0].mode).toBe('fleeing');
	});

	it("don't stop a shot at a deer in front of them", () => {
		const state = wave([deer({ lane: 1, x: 150 })], { trees: [{ x: 150, row: 0 }] });
		expect(shoot(state, { x: 150, y: 125 }, 0, first).results).toEqual([true]);
	});

	it('leave the rest of a deer that is partly behind one open to a shot', () => {
		const tree: Tree = { x: 140, row: 0 };
		const state = wave([deer({ lane: 0, x: 150 })], { trees: [tree] });
		const canopy = treeParts(tree).canopy;
		const pastTheLeaves = { x: canopy.x + canopy.rx + 2, y: canopy.y };
		expect(shoot(state, pastTheLeaves, 0, first).results).toEqual([true]);
	});
});

describe('startled deer', () => {
	const pair = () => [deer({ lane: 0, x: 100 }), deer({ lane: 2, x: 200, direction: -1 })];
	const sky = { x: 300, y: 20 };

	it('with more than one running, each turns back or runs on at random', () => {
		const back = shoot(wave(pair()), sky, 0, first);
		expect(back.deer.map((d) => [d.mode, d.direction])).toEqual([
			['fleeing', -1],
			['fleeing', 1]
		]);
		const ahead = shoot(wave(pair()), sky, 0, last);
		expect(ahead.deer.map((d) => d.direction)).toEqual([1, -1]);
	});

	it('when one of a pair is hit, the other can turn back too', () => {
		const [far, near] = pair();
		const state = shoot(wave([far, near]), centre(near), 0, first);
		expect(state.deer[1].mode).toBe('down');
		expect(state.deer[0]).toMatchObject({ mode: 'fleeing', direction: -1 });
	});

	it('a lone deer always runs on', () => {
		expect(shoot(wave([deer()]), sky, 0, first).deer[0].direction).toBe(1);
	});

	it('a deer that turns back gets away off the edge it came in from', () => {
		const field = [deer({ x: 20 }), deer({ lane: 0, x: 200, direction: -1 })];
		const state = advance(shoot(wave(field), sky, 0, first), 1000, first);
		expect(state.results).toEqual([false]);
		expect(state.deer).toHaveLength(1);
	});
});

describe('rounds', () => {
	it('needs 6 hits out of 10 at first, rising to 9 from round 7', () => {
		expect([1, 2, 3, 4, 5, 6, 7, 20].map(hitsNeeded)).toEqual([6, 6, 7, 7, 8, 8, 9, 9]);
	});

	it('enough hits moves on to the next round after the tally', () => {
		const results = [...Array(6).fill(true), ...Array(4).fill(false)];
		let state: BuckFeverState = { ...createGame(first), phase: 'tally', results, score: 600 };
		state = advance(state, 2499, first);
		expect(state.phase).toBe('tally');
		state = advance(state, 1, first);
		expect(state).toMatchObject({ phase: 'intro', round: 2, results: [], score: 600 });
	});

	it('too few hits ends the game', () => {
		const results = [...Array(5).fill(true), ...Array(5).fill(false)];
		const over = advance({ ...createGame(first), phase: 'tally', results }, 2500, first);
		expect(over.phase).toBe('over');
		expect(advance(over, 10_000, first)).toBe(over);
		expect(start(over)).toBe(over);
	});

	it('a perfect round earns a bonus of 1000 times the round', () => {
		const lastDeer = deer({ mode: 'down', timer: 0 });
		const state = advance(wave([lastDeer], { round: 2, score: 5000, results: Array(10).fill(true) }), DOWN_MS, first);
		expect(state).toMatchObject({ phase: 'tally', score: 7000 });
	});
});
