import type { Component } from 'svelte';
import type { TouchLayout } from '../core/input';
import type { GameProps } from '../core/types';

export interface GameEntry {
	slug: string;
	name: string;
	component: () => Promise<{ default: Component<GameProps> }>;
	/** On-screen buttons the player can turn on instead of swiping; omit for none. */
	controls?: TouchLayout;
}

export const games: GameEntry[] = [
	{
		slug: 'snake',
		name: 'Snake',
		component: () => import('./snake/Snake.svelte'),
		controls: { dpad: ['up', 'down', 'left', 'right'] }
	},
	{
		slug: 'falling-blocks',
		name: 'Falling Blocks',
		component: () => import('./falling-blocks/FallingBlocks.svelte'),
		// Up and Space rotate and hard-drop on the keyboard; the labelled buttons send the same actions.
		controls: {
			dpad: ['left', 'down', 'right'],
			buttons: [
				{ action: 'up', label: 'Rotate' },
				{ action: 'action', label: 'Drop' }
			]
		}
	},
	{
		slug: 'buck-fever',
		name: 'Buck Fever',
		// Tap or click to shoot, so no on-screen buttons (keyboard players aim with the arrows).
		component: () => import('./buck-fever/BuckFever.svelte')
	}
];
