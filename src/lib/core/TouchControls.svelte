<!--
	On-screen D-pad plus any labelled buttons the game asks for, for players who prefer buttons to
	swipes. Presses go through sendAction, so games receive them exactly like key presses, including
	repeats while a button is held, and letting go goes through releaseAction, like a key coming up.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { releaseAction, sendAction, type Action, type Direction, type TouchLayout } from './input';

	interface Props {
		layout: TouchLayout;
	}

	let { layout }: Props = $props();

	const DIRECTION_LABELS: Record<Direction, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
	// Held buttons repeat like a held key: after a short delay, then steadily.
	const REPEAT_DELAY_MS = 170;
	const REPEAT_INTERVAL_MS = 50;

	// A full cross when the game uses up; otherwise a single compact row.
	let crossLayout = $derived(layout.dpad.includes('up'));
	// The row holds only the directions the game uses, in order (e.g. just left and right, with no gap).
	let row = $derived((['left', 'down', 'right'] as const).filter((direction) => layout.dpad.includes(direction)));

	let pressed = $state<Partial<Record<Action, boolean>>>({});
	const repeatTimers = new Map<Action, ReturnType<typeof setTimeout>>();

	function stopRepeating(action: Action) {
		clearTimeout(repeatTimers.get(action));
		repeatTimers.delete(action);
	}

	function press(event: PointerEvent, action: Action) {
		if (event.button !== 0) return;
		// Act on press rather than on click: a click only fires when the finger lifts, which feels laggy.
		event.preventDefault();
		pressed[action] = true;
		sendAction(action);
		stopRepeating(action);
		const repeat = () => {
			sendAction(action, true);
			repeatTimers.set(action, setTimeout(repeat, REPEAT_INTERVAL_MS));
		};
		repeatTimers.set(action, setTimeout(repeat, REPEAT_DELAY_MS));
	}

	function release(action: Action) {
		// pointerleave follows pointerup, so only the first of them lets go.
		if (!pressed[action]) return;
		pressed[action] = false;
		stopRepeating(action);
		releaseAction(action);
	}

	function click(event: MouseEvent, action: Action) {
		// Pointer presses were already sent on pointerdown. A click with no pointer behind it
		// (detail 0) comes from assistive technology, so send that one, and let go straight away.
		if (event.detail === 0) {
			sendAction(action);
			releaseAction(action);
		}
	}

	onDestroy(() => {
		for (const action of repeatTimers.keys()) stopRepeating(action);
		for (const action of Object.keys(pressed) as Action[]) release(action);
	});
</script>

{#snippet button(action: Action, label: string, className: string, content: 'arrow' | 'label')}
	<button
		class={className}
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
		{#if content === 'arrow'}
			<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 2 9 8H1Z" /></svg>
		{:else}
			{label}
		{/if}
	</button>
{/snippet}

<div class="controls">
	<div
		class="dpad"
		class:cross={crossLayout}
		style:grid-template-columns={crossLayout ? null : `repeat(${row.length}, var(--button))`}
		style:grid-template-areas={crossLayout ? null : `'${row.join(' ')}'`}
	>
		{#each layout.dpad as direction (direction)}
			{@render button(direction, DIRECTION_LABELS[direction], direction, 'arrow')}
		{/each}
	</div>
	{#if layout.buttons?.length}
		<div class="buttons">
			{#each layout.buttons as { action, label } (action)}
				{@render button(action, label, 'labelled', 'label')}
			{/each}
		</div>
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
		grid-template-areas: 'left down right';
		gap: 4px;
	}

	.dpad.cross {
		grid-template-rows: repeat(3, var(--button));
		grid-template-areas:
			'. up .'
			'left . right'
			'. down .';
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: 8px;
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

	.labelled {
		width: 80px;
		border-radius: calc(var(--button) / 2);
		background: var(--accent);
		color: var(--bg);
		font-size: 0.85rem;
		font-weight: bold;
	}

	.labelled:nth-child(2) {
		background: var(--accent-2);
	}

	.labelled.pressed {
		background: var(--muted);
	}

	/* Beside the game (phone sideways): stack the D-pad over the buttons to keep the column narrow. */
	@media (orientation: landscape) {
		.controls {
			flex-direction: column;
			gap: 16px;
		}

		.buttons {
			flex-direction: row;
		}
	}
</style>
