import type { Component } from 'svelte';
import type { GameProps } from '../core/types';

export interface GameEntry {
	slug: string;
	name: string;
	component: () => Promise<{ default: Component<GameProps> }>;
}

export const games: GameEntry[] = [
	// Temporary: exercises the core framework until Snake replaces it in Phase 4.
	{ slug: 'stub', name: 'Tap Test', component: () => import('./stub/Stub.svelte') }
];
