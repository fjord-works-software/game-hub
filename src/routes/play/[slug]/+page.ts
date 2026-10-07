import { error } from '@sveltejs/kit';
import { games } from '#lib/games/registry.ts';
import type { EntryGenerator, PageLoad } from './$types';

// Prerender a page for every registered game, so each one is in the static build and the
// service worker's precache.
export const entries: EntryGenerator = () => games.map(({ slug }) => ({ slug }));

export const load: PageLoad = async ({ params }) => {
	const entry = games.find((game) => game.slug === params.slug);
	if (!entry) error(404, 'Game not found');

	// Loading the game's code here (not in the page) means it's ready before the page renders,
	// while still only being downloaded when this game is opened.
	const { default: component } = await entry.component();
	return { slug: entry.slug, name: entry.name, component };
};
