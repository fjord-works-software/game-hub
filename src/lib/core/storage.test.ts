import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScore, load, save, setScore, storageKey } from './storage';

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) {
		return this.data.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.data.set(key, value);
	}
}

let storage: MemoryStorage;

beforeEach(() => {
	storage = new MemoryStorage();
	vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('storage', () => {
	it('namespaces keys under game-hub and the game slug', () => {
		expect(storageKey('snake', 'high-score')).toBe('game-hub:snake:high-score');
		save('snake', 'settings', { sound: false });
		expect([...storage.data.keys()]).toEqual(['game-hub:snake:settings']);
	});

	it('round-trips values as JSON', () => {
		save('falling-blocks', 'settings', { level: 3, ghost: true });
		expect(load('falling-blocks', 'settings', null)).toEqual({ level: 3, ghost: true });
	});

	it('returns the fallback for missing or corrupt values', () => {
		expect(load('snake', 'missing', 'default')).toBe('default');
		storage.setItem('game-hub:snake:broken', '{not json');
		expect(load('snake', 'broken', 'default')).toBe('default');
	});

	it('keeps games separate', () => {
		setScore('snake', 10);
		setScore('falling-blocks', 20);
		expect(getScore('snake')).toBe(10);
		expect(getScore('falling-blocks')).toBe(20);
	});

	it('treats a missing or non-numeric high score as 0', () => {
		expect(getScore('snake')).toBe(0);
		storage.setItem('game-hub:snake:high-score', '"lots"');
		expect(getScore('snake')).toBe(0);
	});

	it('falls back quietly when storage throws (private browsing, quota exceeded)', () => {
		const failing = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		vi.stubGlobal('localStorage', failing);
		expect(() => setScore('snake', 5)).not.toThrow();
		expect(getScore('snake')).toBe(0);
	});

	it('falls back quietly when localStorage does not exist (prerendering)', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(() => save('snake', 'x', 1)).not.toThrow();
		expect(load('snake', 'x', 'default')).toBe('default');
	});
});
