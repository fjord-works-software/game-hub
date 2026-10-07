<script lang="ts">
	import GameShell from '#lib/core/GameShell.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · Game Hub</title>
</svelte:head>

{#key data.slug}
	<GameShell slug={data.slug} name={data.name} game={data.component} controls={data.controls} />
{/key}
