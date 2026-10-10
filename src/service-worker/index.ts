import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

// Every cache this worker creates or deletes carries this prefix, so it never touches caches that
// aren't its own (the site used to share an origin with other sites, and could again).
const CACHE_PREFIX = 'game-hub-';
const CACHE = `${CACHE_PREFIX}${version}`;

// The worker is served from the base path (/service-worker.js, or e.g. /game-hub/service-worker.js
// under a path) and `$app/manifest` paths are relative to it, so resolve them against the worker's
// directory. The home page's path is '' and becomes '/' (or '/game-hub/', the URL Pages serves
// without a redirect).
const ROOT = new URL('./', self.location.href);
const toPathname = (path: string) => new URL(path, ROOT).pathname;

const PRECACHE = [
	...immutable.map((file) => toPathname(file.path)), // the Vite output
	...assets.map((file) => toPathname(file.path)), // everything in `static`
	...prerendered.map((page) => toPathname(page.path)) // prerendered pages
];
const PRECACHED = new Set<string>(PRECACHE);

self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(PRECACHE);
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	// Anything that wasn't precached goes to the network as normal.
	if (url.origin !== self.location.origin || !PRECACHED.has(url.pathname)) return;

	async function respond() {
		// Match on pathname so a query string (e.g. from a launcher) still hits the cache.
		const cached = await caches.match(url.pathname, { cacheName: CACHE });
		return cached ?? fetch(event.request);
	}

	event.respondWith(respond());
});
