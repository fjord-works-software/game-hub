import type { Component } from 'svelte';
import type { Action } from '../core/input';
import type { GameProps } from '../core/types';

export interface GameEntry {
	slug: string;
	name: string;
	component: () => Promise<{ default: Component<GameProps> }>;
	/** On-screen buttons the player can turn on instead of swiping; omit for none. */
	controls?: Action[];
}

export const games: GameEntry[] = [
	{
		slug: 'snake',
		name: 'Snake',
		component: () => import('./snake/Snake.svelte'),
		controls: ['up', 'down', 'left', 'right']
	}
];
