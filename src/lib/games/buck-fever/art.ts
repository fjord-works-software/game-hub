// Buck Fever's pixel art, drawn in code onto the 320x180 scene canvas, so there are no image files
// to load or precache. Every shape is built from whole-pixel rectangles, so it stays crisp when the
// component scales the scene up.

import {
	DEER_PER_ROUND,
	DOWN_MS,
	HEIGHT,
	hitsNeeded,
	LANES,
	SHELLS_PER_WAVE,
	TREE_ROWS,
	treeParts,
	WIDTH,
	type BuckFeverState,
	type Deer,
	type Tree
} from './logic';

/** The status strip along the bottom of the scene (shells, this round's deer). */
export const HUD_TOP = 164;

const SKY = ['#3b5dc9', '#41a6f6', '#73eff7'];
const SUN = '#ffcd75';
const SUN_CORE = '#fff1c1';
const CLOUD = '#f4f4f4';
const CLOUD_SHADE = '#c5dbe8';
const FAR_HILLS = '#94b0c2';
const NEAR_HILLS = '#566c86';
const PINE = '#257179';
const PINE_SHADE = '#1b5156';
const MEADOW = ['#6cc07a', '#4cb469', '#3aa35c'];
const GRASS_LIGHT = '#a7f070';
const GRASS_DARK = '#2b8a50';
const HUD = '#1a1c2c';
const HUD_LINE = '#333c57';
const SHELL = '#b13e53';
const BRASS = '#ffcd75';
const SPENT = '#333c57';
const HIT = '#ffcd75';
const MISSED = '#b13e53';
const PENDING = '#566c86';
const LIVE = '#f4f4f4';
const DEER = { body: '#a8673f', dark: '#5e3520', belly: '#e3b48a', white: '#f4f4f4', eye: '#1a1c2c', antler: '#ecdcb0' };
const TREE = { leaves: '#2d7a3f', light: '#46a352', shade: '#1f5b33', outline: '#163f27', bark: '#6b4226', barkShade: '#4a2c19', shadow: '#2b8a50' };
const CROSSHAIR = '#f4f4f4';
const CROSSHAIR_SHADOW = '#1a1c2c';

type Context = CanvasRenderingContext2D;

export interface Scenery {
	/** The sky, drawn first, with the clouds over it. */
	sky: HTMLCanvasElement;
	cloud: HTMLCanvasElement;
	/** Hills, trees, and meadow, transparent above the hills. */
	land: HTMLCanvasElement;
	/** Grass along each lane, drawn over that lane's deer so their hooves sink into it. */
	tufts: HTMLCanvasElement[];
}

function rect(context: Context, colour: string, x: number, y: number, width = 1, height = 1) {
	context.fillStyle = colour;
	context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

/** A filled ellipse, one whole-pixel row at a time. */
function ellipse(context: Context, colour: string, cx: number, cy: number, rx: number, ry: number) {
	context.fillStyle = colour;
	for (let y = Math.round(cy - ry); y < Math.round(cy + ry); y++) {
		const t = (y + 0.5 - cy) / ry;
		const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
		const left = Math.round(cx - half);
		const right = Math.round(cx + half);
		if (right > left) context.fillRect(left, y, right - left, 1);
	}
}

/** A line drawn with a square brush `width` pixels across. */
function line(context: Context, colour: string, x0: number, y0: number, x1: number, y1: number, width = 1) {
	context.fillStyle = colour;
	const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
	const offset = (width - 1) / 2;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		context.fillRect(Math.round(x0 + (x1 - x0) * t - offset), Math.round(y0 + (y1 - y0) * t - offset), width, width);
	}
}

function layer(width = WIDTH, height = HEIGHT): [HTMLCanvasElement, Context] {
	const canvas = Object.assign(document.createElement('canvas'), { width, height });
	return [canvas, canvas.getContext('2d')!];
}

/** A small seeded random source, so the scenery comes out the same every game. */
function seeded(seed: number) {
	return () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
}

/** A pine: tiers that widen in steps towards the base, shaded on the right. */
function pine(context: Context, x: number, base: number, height: number) {
	const top = base - height;
	for (let row = 0; row < height; row++) {
		const half = Math.floor((row % 5) / 2 + row / 5);
		rect(context, PINE, x - half, top + row, half + 1);
		if (half > 0) rect(context, PINE_SHADE, x + 1, top + row, half);
	}
}

export function paintScenery(): Scenery {
	const random = seeded(2024);

	// Sky: three bands. Where they meet, the colour above reaches down in a checkerboard, then sparser.
	const [sky, skyContext] = layer();
	const bands = [0, 30, 58, 110];
	SKY.forEach((colour, i) => rect(skyContext, colour, 0, bands[i], WIDTH, bands[i + 1] - bands[i]));
	for (let i = 1; i < SKY.length; i++) {
		for (let x = 0; x < WIDTH; x++) {
			rect(skyContext, SKY[i - 1], x, bands[i] + (x % 2));
			if (x % 4 === 0) rect(skyContext, SKY[i - 1], x, bands[i] + 2);
		}
	}
	ellipse(skyContext, SUN, 262, 34, 10, 10);
	ellipse(skyContext, SUN_CORE, 262, 34, 7, 7);

	const [cloud, cloudContext] = layer(44, 16);
	for (const [x, y, rx, ry] of [
		[9, 10, 7, 4],
		[20, 8, 9, 6],
		[32, 10, 8, 4]
	]) {
		ellipse(cloudContext, CLOUD_SHADE, x, y + 1.5, rx, ry);
	}
	for (const [x, y, rx, ry] of [
		[9, 9, 7, 4],
		[20, 7, 9, 6],
		[32, 9, 8, 4]
	]) {
		ellipse(cloudContext, CLOUD, x, y, rx, ry);
	}

	const [land, landContext] = layer();
	// Two ridges of hills, each a sum of waves with random offsets.
	const ridge = (colour: string, base: number, waves: [number, number][]) => {
		const phases = waves.map(() => random() * Math.PI * 2);
		for (let x = 0; x < WIDTH; x++) {
			const top = base + waves.reduce((sum, [height, length], i) => sum + height * Math.sin(x / length + phases[i]), 0);
			rect(landContext, colour, x, top, 1, 110 - top);
		}
	};
	ridge(FAR_HILLS, 72, [
		[9, 26],
		[5, 11],
		[2, 5]
	]);
	ridge(NEAR_HILLS, 88, [
		[6, 19],
		[3, 8]
	]);

	// The meadow, in bands that brighten towards the far side, with grass that gets bigger nearer.
	const meadowBands = [100, 118, 139, HUD_TOP];
	MEADOW.forEach((colour, i) => rect(landContext, colour, 0, meadowBands[i], WIDTH, meadowBands[i + 1] - meadowBands[i]));
	for (let i = 0; i < 420; i++) {
		const nearness = Math.sqrt(random());
		const y = 102 + nearness * (HUD_TOP - 104);
		const x = random() * WIDTH;
		const blade = 1 + Math.round(nearness * 2);
		rect(landContext, random() < 0.5 ? GRASS_LIGHT : GRASS_DARK, x, y - blade, 1, blade);
	}

	// A line of pines along the far edge of the meadow: a back row, then a taller front row.
	for (const [base, low, high] of [
		[101, 7, 14],
		[104, 10, 21]
	]) {
		for (let x = -4; x < WIDTH + 4; x += 3 + Math.floor(random() * 5)) {
			pine(landContext, x, base + Math.floor(random() * 3), low + Math.floor(random() * (high - low)));
		}
	}

	const tufts = LANES.map(({ y, scale }) => {
		const [canvas, context] = layer();
		for (let x = Math.floor(random() * 3); x < WIDTH; x += 2 + Math.floor(random() * 6)) {
			const height = Math.max(1, Math.round((2 + random() * 3) * scale));
			rect(context, GRASS_DARK, x, y + 2 - height, 1, height);
			rect(context, GRASS_LIGHT, x + 1, y + 3 - height, 1, height - 1);
		}
		return canvas;
	});

	return { sky, cloud, land, tufts };
}

/** Clouds drifting across the sky, wrapping around. */
export function drawClouds(context: Context, cloud: HTMLCanvasElement, time: number) {
	for (const [start, y, speed] of [
		[30, 14, 2],
		[170, 30, 3],
		[250, 48, 1.5]
	]) {
		const span = WIDTH + cloud.width;
		const x = ((((start + (time / 1000) * speed) % span) + span) % span) - cloud.width;
		context.drawImage(cloud, Math.round(x), y);
	}
}

/**
 * A deer at its place in its lane, built from ellipses and lines in "deer units" (x forward from
 * the middle of its body, y up from the ground, full size) and scaled down for the far lanes.
 * Running deer gallop as they move; grazing deer drop their heads; a hit deer lies down, then
 * blinks out just before it's cleared away.
 */
export function drawDeer(context: Context, deer: Deer) {
	const { y: ground, scale } = LANES[deer.lane];
	const facing = deer.direction;
	const X = (x: number) => deer.x + facing * x * scale;
	const Y = (y: number) => ground - y * scale;
	/** An ellipse in deer units, optionally grown by `pad` whole pixels (for outlines). */
	const blob = (colour: string, x: number, y: number, rx: number, ry: number, pad = 0) =>
		ellipse(context, colour, X(x), Y(y), rx * scale + pad, ry * scale + pad);
	const stroke = (colour: string, x0: number, y0: number, x1: number, y1: number, width = 1) =>
		line(context, colour, X(x0), Y(y0), X(x1), Y(y1), width);
	const dot = (colour: string, x: number, y: number) => rect(context, colour, X(x), Y(y));
	const legWidth = scale >= 0.85 ? 2 : 1;
	const neckWidth = Math.max(2, Math.round(3 * scale));
	const earWidth = Math.max(1, Math.round(2 * scale));

	if (deer.mode === 'down') {
		if (deer.timer > DOWN_MS - 400 && Math.floor(deer.timer / 80) % 2 === 1) return;
		stroke(DEER.dark, 4, 2.5, 10, 1, legWidth);
		stroke(DEER.dark, -6, 2.5, 0, 1, legWidth);
		blob(DEER.dark, 0, 5, 9.5, 4, 1);
		blob(DEER.dark, 12, 4, 3, 2.3, 1);
		blob(DEER.body, 0, 5, 9.5, 4);
		blob(DEER.belly, 1, 2.6, 7, 1.4);
		stroke(DEER.body, 7, 6, 10, 4.5, neckWidth);
		blob(DEER.body, 12, 4, 3, 2.3);
		blob(DEER.body, 14.5, 3, 2, 1.4);
		dot(DEER.eye, 16.3, 3.2);
		// Cartoon cross for an eye: knocked out.
		for (const [x, y] of [
			[11.5, 5.5],
			[13.5, 5.5],
			[12.5, 4.5],
			[11.5, 3.5],
			[13.5, 3.5]
		]) {
			dot(DEER.eye, x, y);
		}
		blob(DEER.dark, 10, 6.5, 1.6, 1);
		if (deer.kind === 'buck') {
			stroke(DEER.antler, 10.5, 6, 6, 9);
			stroke(DEER.antler, 8, 7.2, 8.5, 10);
		}
		blob(DEER.white, -10, 6, 1.4, 1.2);
		return;
	}

	const grazing = deer.mode === 'grazing';
	// The stride follows the ground covered, so the legs never slide.
	const stride = ((deer.x * facing) / (16 * scale)) * Math.PI * 2;
	const swing = grazing ? 0 : 0.6;
	const lift = grazing ? 0 : Math.max(0, Math.sin(stride)) * 2;
	const leg = (colour: string, hipX: number, angle: number) => {
		const hipY = 9 + lift;
		const footX = hipX + Math.sin(angle) * 9;
		const footY = hipY - Math.cos(angle) * 9;
		stroke(colour, hipX, hipY, footX, footY, legWidth);
		dot(DEER.dark, footX, footY);
	};
	const pose = grazing
		? { neck: [6.5, 12.5, 10.8, 6.2], head: [12.3, 4.6], snout: [14.6, 3.3], nose: [16.3, 3.1], eye: [12.6, 5.2], ear: [10.8, 6.6] }
		: { neck: [6.5, 13, 9.8, 19], head: [11, 20.5], snout: [13.8, 19.6], nose: [15.6, 19.8], eye: [11.6, 21.1], ear: [9.6, 22.6] };
	const up = (y: number) => y + lift;
	const [nx0, ny0, nx1, ny1] = pose.neck;
	// Ears stand up and back from the top of the head: the far one darker, behind the head.
	const ear = (colour: string, dx: number, width: number) =>
		stroke(colour, pose.ear[0] + dx, up(pose.ear[1] - 1), pose.ear[0] + dx - 1.2, up(pose.ear[1] + 2.8), width);

	// Far legs, behind the body and darker.
	leg(DEER.dark, 6, swing * Math.sin(stride + 0.9) - (grazing ? 0.08 : 0));
	leg(DEER.dark, -6, swing * Math.sin(stride + Math.PI + 0.9) + (grazing ? 0.08 : 0));

	// The white tail: raised as it runs, flared as it flees, down while it grazes.
	if (deer.mode === 'fleeing') blob(DEER.white, -10.5, up(15.5), 1.7, 2.8);
	else if (grazing) blob(DEER.body, -9.8, 11.5, 1.1, 1.8);
	else blob(DEER.white, -10, up(14.6), 1.3, 2.2);

	ear(DEER.dark, 1.4, earWidth);

	// Outline first, then fill.
	blob(DEER.dark, 0, up(12), 9, 4.5, 1);
	ear(DEER.dark, 0, earWidth + 2);
	stroke(DEER.dark, nx0, up(ny0), nx1, up(ny1), neckWidth + 2);
	blob(DEER.dark, pose.head[0], up(pose.head[1]), 3.1, 2.3, 1);
	blob(DEER.dark, pose.snout[0], up(pose.snout[1]), 2.1, 1.4, 1);
	blob(DEER.body, 0, up(12), 9, 4.5);
	blob(DEER.belly, 0.5, up(8.9), 6.5, 1.5);
	stroke(DEER.body, nx0, up(ny0), nx1, up(ny1), neckWidth);
	blob(DEER.body, pose.head[0], up(pose.head[1]), 3.1, 2.3);
	blob(DEER.body, pose.snout[0], up(pose.snout[1]), 2.1, 1.4);
	ear(DEER.body, 0, earWidth);
	dot(DEER.eye, pose.eye[0], up(pose.eye[1]));
	dot(DEER.eye, pose.nose[0], up(pose.nose[1]));

	if (deer.kind === 'buck') {
		// A main beam sweeping up and back from the top of the head, with two tines.
		const [hx, hy] = pose.head;
		const base = hy + 2.3;
		stroke(DEER.antler, hx - 0.6, up(base), hx - 2.4, up(base + 6.2));
		stroke(DEER.antler, hx - 1.1, up(base + 2.2), hx + 0.6, up(base + 5.4));
		stroke(DEER.antler, hx - 1.8, up(base + 4.4), hx - 0.2, up(base + 7.2));
	}

	// Near legs, in front of the body.
	leg(DEER.body, 6, swing * Math.sin(stride));
	leg(DEER.body, -6, swing * Math.sin(stride + Math.PI));
}

/**
 * A leafy tree, filling the trunk and leaf oval that stop shots (from `treeParts`): the leaves are
 * a cluster of rounded clumps, lit from the upper left.
 */
export function drawTree(context: Context, tree: Tree) {
	const { scale, y: ground } = TREE_ROWS[tree.row];
	const { trunk, canopy } = treeParts(tree);
	// Clumps of leaves, as fractions of the leaf oval: [x, y, width, height] from its centre.
	const clumps: [number, number, number, number][] = [
		[-0.46, 0.18, 0.54, 0.55],
		[0.46, 0.18, 0.54, 0.55],
		[0, -0.36, 0.67, 0.64],
		[0, 0.36, 0.75, 0.55]
	];
	const clump = (colour: string, [dx, dy, rx, ry]: [number, number, number, number], pad = 0) =>
		ellipse(context, colour, canopy.x + dx * canopy.rx, canopy.y + dy * canopy.ry, rx * canopy.rx + pad, ry * canopy.ry + pad);

	ellipse(context, TREE.shadow, tree.x, ground, 10 * scale, 1.5 * scale);
	rect(context, TREE.bark, trunk.left, trunk.top, trunk.right - trunk.left, trunk.bottom - trunk.top);
	rect(context, TREE.barkShade, tree.x, trunk.top, trunk.right - tree.x, trunk.bottom - trunk.top);
	rect(context, TREE.bark, trunk.left - scale, ground - scale, trunk.right - trunk.left + 2 * scale, scale);
	for (const each of clumps) clump(TREE.outline, each, 1);
	for (const each of clumps) clump(TREE.leaves, each);
	clump(TREE.shade, [0.25, 0.55, 0.5, 0.27]);
	clump(TREE.light, [-0.25, -0.55, 0.375, 0.27]);
	clump(TREE.light, [-0.58, 0, 0.21, 0.18]);
}

/**
 * The burst where a shot lands: a flash, then a ring that spreads and fades. A shot that hits a
 * tree throws off chips of bark instead of a ring.
 */
export function drawShot(context: Context, x: number, y: number, age: number, onTree = false) {
	if (age < 60) {
		ellipse(context, CROSSHAIR, x, y, 3, 3);
		return;
	}
	if (onTree) {
		const travel = ((age - 60) / 100) * 6;
		for (let i = 0; i < 6; i++) {
			const angle = (i / 6) * Math.PI * 2 + 0.4;
			rect(context, i % 2 ? TREE.bark : TREE.light, x + Math.cos(angle) * (3 + travel), y + Math.sin(angle) * (3 + travel) + travel * 0.5);
		}
		return;
	}
	const radius = 4 + ((age - 60) / 100) * 4;
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2;
		rect(context, CROSSHAIR, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
	}
}

export function drawCrosshair(context: Context, x: number, y: number) {
	const cx = Math.round(x);
	const cy = Math.round(y);
	for (const [colour, offset] of [
		[CROSSHAIR_SHADOW, 1],
		[CROSSHAIR, 0]
	] as const) {
		rect(context, colour, cx - 6 + offset, cy + offset, 4, 1);
		rect(context, colour, cx + 3 + offset, cy + offset, 4, 1);
		rect(context, colour, cx + offset, cy - 6 + offset, 1, 4);
		rect(context, colour, cx + offset, cy + 3 + offset, 1, 4);
		rect(context, colour, cx + offset, cy + offset);
	}
}

/**
 * The strip along the bottom: shells left on the left, and a marker for each of the round's ten
 * deer in the middle (gold for a hit, red for one that got away, blinking while it's on the field),
 * underlined as far as the hits needed to pass. The round number is drawn by the component, as text.
 */
export function drawHud(context: Context, state: BuckFeverState, time: number) {
	rect(context, HUD, 0, HUD_TOP, WIDTH, HEIGHT - HUD_TOP);
	rect(context, HUD_LINE, 0, HUD_TOP, WIDTH, 1);

	for (let i = 0; i < SHELLS_PER_WAVE; i++) {
		const x = 7 + i * 6;
		if (i < state.shells) {
			rect(context, SHELL, x, 167, 3, 6);
			rect(context, BRASS, x, 173, 3, 3);
		} else {
			rect(context, SPENT, x, 167, 3, 9);
		}
	}

	const running = state.deer.filter((deer) => deer.mode !== 'down').length;
	const blink = Math.floor(time / 250) % 2 === 0;
	const left = WIDTH / 2 - (DEER_PER_ROUND * 8 - 2) / 2;
	for (let i = 0; i < DEER_PER_ROUND; i++) {
		const result = state.results[i];
		const onField = i >= state.results.length && i < state.results.length + running;
		const colour = result === true ? HIT : result === false ? MISSED : onField && blink ? LIVE : PENDING;
		rect(context, colour, left + i * 8 + 1, 167, 4, 6);
		rect(context, colour, left + i * 8, 168, 6, 4);
	}
	rect(context, HUD_LINE, left, 175, hitsNeeded(state.round) * 8 - 2, 2);
}
