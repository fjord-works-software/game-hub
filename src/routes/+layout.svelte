<script lang="ts">
	import { asset } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href={asset('manifest.json')} />
	<link rel="apple-touch-icon" href={asset('icons/apple-touch-icon.png')} />
	<meta name="theme-color" content="#1a1c2c" />
</svelte:head>

{@render children()}
