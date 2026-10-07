<script lang="ts">
	import '../app.css';
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
	<!-- Installed on iOS: draw under the status bar (the safe-area padding keeps content below it). -->
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

{@render children()}
