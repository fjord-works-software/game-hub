// localStorage is shared with every other site on fjordworkssoftware.com, so every key
// is namespaced as `game-hub:<slug>:<key>`.
const PREFIX = 'game-hub';
const HIGH_SCORE = 'high-score';

export function storageKey(slug: string, key: string): string {
	return `${PREFIX}:${slug}:${key}`;
}

/** Read a stored value, or `fallback` if it's missing, unreadable, or storage is unavailable (e.g. private browsing). */
export function load<T>(slug: string, key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(storageKey(slug, key));
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

/** Store a value. Failures (storage unavailable or full) are ignored: persistence is optional. */
export function save<T>(slug: string, key: string, value: T): void {
	try {
		localStorage.setItem(storageKey(slug, key), JSON.stringify(value));
	} catch {
		// Nothing useful to do; the game keeps working without persistence.
	}
}

export function getScore(slug: string): number {
	const score = load<unknown>(slug, HIGH_SCORE, 0);
	return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

export function setScore(slug: string, value: number): void {
	save(slug, HIGH_SCORE, value);
}
