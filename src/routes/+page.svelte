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
				<a href={resolve('/play/[slug]', { slug: game.slug })}>
					<!-- The name below is the link's label, so the picture needs no alt text of its own. -->
					{#if game.thumbnail}
						<img src={game.thumbnail} alt="" />
					{:else}
						<div class="no-picture"></div>
					{/if}
					<span>{game.name}</span>
				</a>
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

	/* Wider screens: bigger cards, three across. */
	@media (min-width: 600px) {
		ul {
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		}
	}

	a {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border-radius: 12px;
		background: var(--surface);
		text-decoration: none;
	}

	img,
	.no-picture {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		background: var(--bg);
	}

	/* A game without a picture yet: faint stripes, distinct from both the card and the page. */
	.no-picture {
		background: repeating-linear-gradient(
			-45deg,
			color-mix(in srgb, var(--surface) 70%, var(--bg)) 0 12px,
			color-mix(in srgb, var(--surface) 55%, var(--bg)) 12px 24px
		);
	}

	span {
		padding: 10px 12px 12px;
		/* A faint line between the picture and the name, for pictures the same colour as the card. */
		border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
		font-size: 1.05rem;
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
