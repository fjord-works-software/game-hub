<!--
	On-screen D-pad (plus an action button if the game uses one), for players who prefer buttons to
	swipes. Presses go through sendAction, so games receive them exactly like key presses.
-->
<script lang="ts">
	import { sendAction, type Action, type Direction } from './input';

	interface Props {
		/** The actions this game uses; only those buttons are shown. */
		actions: Action[];
	}

	let { actions }: Props = $props();

	const DIRECTIONS: { action: Direction; label: string }[] = [
		{ action: 'up', label: 'Up' },
		{ action: 'left', label: 'Left' },
		{ action: 'right', label: 'Right' },
		{ action: 'down', label: 'Down' }
	];

	let pressed = $state<Partial<Record<Action, boolean>>>({});

	function press(event: PointerEvent, action: Action) {
		if (event.button !== 0) return;
		// Act on press rather than on click: a click only fires when the finger lifts, which feels laggy.
		event.preventDefault();
		pressed[action] = true;
		sendAction(action);
	}

	function release(action: Action) {
		pressed[action] = false;
	}

	function click(event: MouseEvent, action: Action) {
		// Pointer presses were already sent on pointerdown. A click with no pointer behind it
		// (detail 0) comes from assistive technology, so send that one.
		if (event.detail === 0) sendAction(action);
	}
</script>

{#snippet button(action: Action, label: string)}
	<button
		class={action}
		class:pressed={pressed[action]}
		aria-label={label}
		tabindex="-1"
		onpointerdown={(event) => press(event, action)}
		onpointerup={() => release(action)}
		onpointercancel={() => release(action)}
		onpointerleave={() => release(action)}
		onmousedown={(event) => event.preventDefault()}
		onclick={(event) => click(event, action)}
	>
		{#if action === 'action'}
			A
		{:else}
			<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 2 9 8H1Z" /></svg>
		{/if}
	</button>
{/snippet}

<div class="controls">
	<div class="dpad">
		{#each DIRECTIONS.filter(({ action }) => actions.includes(action)) as { action, label } (action)}
			{@render button(action, label)}
		{/each}
	</div>
	{#if actions.includes('action')}
		{@render button('action', 'Action')}
	{/if}
</div>

<style>
	.controls {
		--button: 56px;

		display: flex;
		flex: none;
		align-items: center;
		justify-content: center;
		gap: 24px;
		padding: 12px;
	}

	.dpad {
		display: grid;
		grid-template-columns: repeat(3, var(--button));
		grid-template-rows: repeat(3, var(--button));
		grid-template-areas:
			'. up .'
			'left . right'
			'. down .';
		gap: 4px;
	}

	button {
		display: grid;
		place-items: center;
		width: var(--button);
		height: var(--button);
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: var(--surface);
		font-size: 1.25rem;
		font-weight: bold;
		cursor: pointer;
	}

	button.pressed {
		background: var(--muted);
		color: var(--bg);
	}

	svg {
		width: 45%;
		height: 45%;
		fill: currentColor;
	}

	.up {
		grid-area: up;
	}

	.down {
		grid-area: down;
	}

	.down svg {
		rotate: 180deg;
	}

	.left {
		grid-area: left;
	}

	.left svg {
		rotate: -90deg;
	}

	.right {
		grid-area: right;
	}

	.right svg {
		rotate: 90deg;
	}

	.action {
		border-radius: 50%;
		background: var(--accent);
		color: var(--bg);
	}
</style>
