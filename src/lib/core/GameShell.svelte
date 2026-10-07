<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { resolve } from '$app/paths';
	import { getScore, setScore } from './storage';
	import type { GameProps } from './types';

	interface Props {
		slug: string;
		name: string;
		game: Component<GameProps>;
	}

	let { slug, name, game: Game }: Props = $props();

	let score = $state(0);
	let best = $state(0);
	let newBest = $state(false);
	let menu = $state<'none' | 'paused' | 'over'>('none');
	// Bumping this remounts the game via {#key}, so games need no reset logic of their own.
	let round = $state(0);

	onMount(() => {
		// Read on mount, not during prerendering, where there's no localStorage.
		best = getScore(slug);
	});

	function pause() {
		if (menu === 'none') menu = 'paused';
	}

	function resume() {
		if (menu === 'paused') menu = 'none';
	}

	function restart() {
		score = 0;
		newBest = false;
		menu = 'none';
		round++;
	}

	function onScore(value: number) {
		score = value;
	}

	function onGameOver(finalScore: number) {
		score = finalScore;
		newBest = finalScore > best;
		if (newBest) {
			best = finalScore;
			setScore(slug, finalScore);
		}
		menu = 'over';
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key !== 'Escape' && event.key.toLowerCase() !== 'p') return;
		if (menu === 'none') pause();
		else resume();
	}

	function focus(node: HTMLElement) {
		node.focus();
	}
</script>

<svelte:window onkeydown={onKeyDown} />
<svelte:document onvisibilitychange={() => document.hidden && pause()} />

<div class="shell">
	<header class="hud">
		<a class="icon-button" href={resolve('/')} aria-label="Back to menu">&larr;</a>
		<h1>{name}</h1>
		<dl class="scores">
			<div><dt>Score</dt><dd>{score}</dd></div>
			<div><dt>Best</dt><dd>{best}</dd></div>
		</dl>
		<button class="icon-button" onclick={pause} disabled={menu !== 'none'} aria-label="Pause">
			&#10074;&#10074;
		</button>
	</header>

	<div class="play-area">
		{#key round}
			<Game paused={menu !== 'none'} {onScore} {onGameOver} />
		{/key}

		{#if menu !== 'none'}
			<div class="menu" role="dialog" aria-modal="true" aria-labelledby="menu-title">
				{#if menu === 'paused'}
					<h2 id="menu-title">Paused</h2>
					<button class="primary" onclick={resume} {@attach focus}>Resume</button>
					<button onclick={restart}>Restart</button>
				{:else}
					<h2 id="menu-title">Game over</h2>
					<p>Score {score}{#if newBest}<br /><strong>New best!</strong>{/if}</p>
					<button class="primary" onclick={restart} {@attach focus}>Play again</button>
				{/if}
				<a class="button" href={resolve('/')}>Back to menu</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		/* It's a game, not a document: no text selection or long-press menus anywhere. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.hud {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 12px;
		/* The bar's background runs under the status bar and notch; its contents stay clear of them. */
		padding: calc(8px + var(--safe-top)) max(12px, var(--safe-right)) 8px max(12px, var(--safe-left));
		background: var(--surface);
	}

	h1 {
		margin: 0;
		font-size: 1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scores {
		display: flex;
		gap: 16px;
		margin: 0;
	}

	.scores div {
		text-align: right;
	}

	dt {
		font-size: 0.7rem;
		color: var(--muted);
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.icon-button {
		display: grid;
		place-items: center;
		width: var(--touch-target);
		height: var(--touch-target);
		border: 0;
		border-radius: 8px;
		background: var(--bg);
		font-size: 1.1rem;
		text-decoration: none;
		cursor: pointer;
	}

	.icon-button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.play-area {
		position: relative;
		flex: 1;
		/* Keep the game clear of the home indicator and of notches when the phone is sideways. */
		margin: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
		overflow: hidden;
		/* Swipes belong to the game: no scrolling or zooming. */
		touch-action: none;
	}

	.menu {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		justify-content: safe center; /* if it ever overflows, clip the bottom rather than the title */
		gap: 12px;
		padding: 16px;
		overflow-y: auto;
		background: color-mix(in srgb, var(--bg) 85%, transparent);
		text-align: center;
	}

	h2 {
		margin: 0 0 8px;
	}

	p {
		margin: 0 0 8px;
	}

	strong {
		color: var(--accent);
	}

	.menu button,
	.button {
		width: 220px;
		max-width: 100%;
		min-height: var(--touch-target);
		padding: 12px 20px;
		border: 0;
		border-radius: 8px;
		background: var(--surface);
		text-decoration: none;
		cursor: pointer;
	}

	.menu .primary {
		background: var(--accent);
		color: var(--bg);
	}

	/* A phone held sideways has little height to spare, so the HUD becomes a narrow sidebar. */
	@media (orientation: landscape) and (max-height: 500px) {
		.shell {
			flex-direction: row;
		}

		.hud {
			grid-template-columns: auto;
			grid-template-rows: auto 1fr auto;
			justify-items: center;
			padding: max(8px, var(--safe-top)) 8px max(8px, var(--safe-bottom)) max(8px, var(--safe-left));
		}

		/* No room for the name; keep it for screen readers. */
		h1 {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}

		.scores {
			flex-direction: column;
			align-self: center;
			gap: 12px;
		}

		.scores div {
			text-align: center;
		}

		.play-area {
			margin: var(--safe-top) var(--safe-right) var(--safe-bottom) 0;
		}
	}
</style>
