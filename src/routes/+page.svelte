<script lang="ts">
	import { resolve } from '$app/paths';
	import { games } from '#lib/games/registry.ts';
</script>

<svelte:head>
	<title>Game Hub</title>
</svelte:head>

<main>
	<h1>Game Hub</h1>
	<ul>
		{#each games as game (game.slug)}
			<li>
				<a href={resolve('/play/[slug]', { slug: game.slug })}>{game.name}</a>
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: calc(24px + var(--safe-top)) max(16px, var(--safe-right)) calc(24px + var(--safe-bottom))
			max(16px, var(--safe-left));
	}

	h1 {
		margin: 0 0 24px;
		font-size: 1.5rem;
	}

	ul {
		display: grid;
		/* Two columns on most phones, one on the narrowest. */
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: grid;
		place-items: center;
		min-height: 120px;
		padding: 16px;
		border-radius: 12px;
		background: var(--surface);
		font-size: 1.1rem;
		text-align: center;
		text-decoration: none;
	}

	a:focus-visible {
		outline: 2px solid var(--accent);
	}

	/* Only where there's a real pointer; on touch screens a hover style sticks after a tap. */
	@media (hover: hover) {
		a:hover {
			outline: 2px solid var(--accent);
		}
	}
</style>
