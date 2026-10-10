import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Fully static output for GitHub Pages. Every page is prerendered (see src/routes/+layout.ts).
			adapter: adapter(),

			paths: {
				// Empty: the site is served from the root of games.fjordworkssoftware.com. Set BASE_PATH
				// (e.g. /game-hub) only to build for hosting under a path.
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts']
	}
});
