import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

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
				// The deploy workflow sets BASE_PATH=/game-hub to match the GitHub Pages URL; empty in local dev.
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	]
});
