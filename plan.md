# Offline Game Hub — Project Plan

## Overview
A PWA built with SvelteKit that hosts multiple browser games, installable and fully playable offline (no Wi-Fi / low signal). Games are added one at a time via a plugin-style registry so new games never require touching existing code. Hosted on GitHub Pages as a static site.

## Tech Stack
- SvelteKit 3 with `adapter-static` (some APIs differ from SvelteKit 2 — see **SvelteKit 3 Notes**)
- TypeScript
- Vanilla Canvas 2D for game rendering (no game engine library)
- SvelteKit's built-in service worker support (`src/service-worker.ts` + `$app/manifest`) for offline caching
- `localStorage` for optional per-game persistence
- Vitest for unit tests of game logic and core modules
- GitHub Pages for hosting (repo: `game-hub`, deployed by GitHub Actions)

## SvelteKit 3 Notes
The project is on SvelteKit 3.0.1. Many docs, examples, and AI-model defaults assume SvelteKit 2. Where they disagree, follow these:
- There is no `svelte.config.js`. Kit options (adapter, `paths.base`, etc.) go in the `sveltekit({...})` call in `vite.config.ts`.
- The library alias is `#lib` (defined in `package.json` `imports`), not `$lib`.
- The `$service-worker` module is gone. In `src/service-worker.ts`, use `immutable`, `assets`, and `prerendered` from `$app/manifest`; `version` from `$app/env`; and `self` from `$app/service-worker` (typed correctly when governed by a tsconfig that extends `$app/tsconfig/service-worker`).
- `$app/paths` no longer exports `base`. Build internal links with `resolve()` and static-file URLs with `asset()` from `$app/paths`, so they work under `/game-hub`.
- When unsure about an API, check `node_modules/@sveltejs/kit/types/index.d.ts` or current docs, not memory.

## Initial Games (build in this order)
1. Snake
2. Tetris
3. 8-bit style Deer Hunter

Each game is self-contained; do not build all three at once. Scaffold the architecture first, implement Snake fully, confirm it works, then move to the next.

## Project Structure
```
.github/
  workflows/
    deploy.yml                    # check, test, build, deploy to GitHub Pages
src/
  service-worker.ts               # precaches the build for offline play
  lib/
    games/
      registry.ts              # single source of truth: list of games + metadata
      snake/
        Snake.svelte            # game component (canvas + loop wiring)
        logic.ts                 # pure game logic, no DOM/canvas references
        logic.test.ts            # Vitest unit tests for logic.ts
      tetris/
        Tetris.svelte
        logic.ts
        logic.test.ts
      deer-hunter/
        DeerHunter.svelte
        logic.ts
        logic.test.ts
    core/
      types.ts                     # GameProps: the contract between GameShell and every game
      GameShell.svelte           # shared wrapper: pause menu, score HUD, back button
      gameLoop.ts                  # requestAnimationFrame helper, fixed-timestep update loop
      input.ts                      # unified keyboard + touch/swipe input handler
      storage.ts                     # localStorage wrapper, namespaced per game slug
      canvas.ts                      # sizes a canvas to its container, scaled by devicePixelRatio
  routes/
    +layout.ts                    # export const prerender = true (required for static export)
    +page.svelte                  # game selection grid, reads from registry.ts
    play/
      [slug]/
        +page.ts                   # entries() lists every registry slug so each game page is prerendered
        +page.svelte               # dynamically loads game component by slug from registry
static/
  manifest.json                   # PWA manifest
  icons/                            # 192x192 and 512x512 icons minimum (placeholders for now)
```
Core modules get tests too, as `*.test.ts` files next to the module they cover.

## Architecture Rules for the AI Model to Follow

1. **Registry pattern is mandatory.** `src/lib/games/registry.ts` exports an array of game entries:
   ```ts
   import type { Component } from 'svelte';
   import type { GameProps } from '../core/types';

   export interface GameEntry {
     slug: string;
     name: string;
     component: () => Promise<{ default: Component<GameProps> }>;
   }

   export const games: GameEntry[] = [
     { slug: 'snake', name: 'Snake', component: () => import('./snake/Snake.svelte') },
   ];
   ```
   Adding a game means: create a new folder under `src/lib/games/`, add one line to this array. Nothing else should need to change.

2. **Separate logic from rendering.** Each game has a `logic.ts` with pure functions/state (no DOM, no canvas) and a `.svelte` file that owns the canvas element and calls into `logic.ts`. This keeps logic testable and keeps games consistent with each other.

3. **Shared game loop.** All games use the same `gameLoop.ts` helper (fixed-timestep `requestAnimationFrame` wrapper) rather than each game writing its own loop.

4. **Unified input handling.** `input.ts` provides a single interface for keyboard arrows/WASD and touch swipe gestures, so every game supports both phone touch and (if used) desktop keyboard without duplicating input code.

5. **Consistent shell.** `GameShell.svelte` wraps every game with the same pause menu, score display, and back-to-menu button, so games only render their own play area.

6. **Namespaced storage.** Any game needing persistence (high scores, etc.) goes through `storage.ts` using `getScore(slug)` / `setScore(slug, value)` style helpers — never calls `localStorage` directly from a game component.

7. **Lazy loading.** Games are dynamically imported via the registry's `component()` function so the initial bundle stays small and offline installs are fast.

## PWA / Offline Requirements
- Use `adapter-static` with `paths.base` read from a `BASE_PATH` environment variable: `/game-hub` in the deploy workflow, empty in local dev.
- Use SvelteKit's built-in service worker (`src/service-worker.ts`) and precache everything listed in `$app/manifest` (`immutable`, `assets`, `prerendered`) on install — do not hand-maintain a cache list.
- `static/manifest.json` must include name, short_name, start_url and scope set to `"./"` (relative to the manifest, so they respect the base path without hardcoding it), display: "standalone", background/theme colors, and icons at minimum 192x192 and 512x512.
- Verify the app loads and is playable with network fully disabled after first visit (test via DevTools offline mode).

## Deployment
- GitHub Pages via a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs type checks, tests, and `npm run build`, then publishes `build/` with `actions/upload-pages-artifact` and `actions/deploy-pages`.
- In the GitHub repo settings, set Pages → Source to "GitHub Actions".

## CLI Commands to Scaffold the Project

```bash
# 1. Scaffold SvelteKit project (choose: Skeleton project, TypeScript, no additional options needed yet)
npx sv create game-hub
cd game-hub

# 2. Add the static adapter for GitHub Pages
npm install -D @sveltejs/adapter-static

# 3. Install base dependencies
npm install

# 4. Init git (if not already done by scaffolder) and make first commit
git init
git add .
git commit -m "Initial SvelteKit scaffold"
```

After this, the AI model should follow the **Implementation Phases** below, in order.

## Implementation Phases
Each phase ends with a **Done when** check. Do not start the next phase until it passes. Phases 5 and 6 stay out of scope until Snake is confirmed working.

Deployment comes in Phase 1 rather than last, so base-path and GitHub Pages problems show up before there is any game code to debug them through.

### Phase 1 — Static build and deploy
- Make the first commit of the scaffold (steps 1–3 above are done; the repo has no commits yet). Create the GitHub repo `game-hub`, add it as `origin`, and set Pages → Source to "GitHub Actions".
- In `vite.config.ts`, replace `adapter-auto` with `adapter-static` and set `paths.base` from `BASE_PATH`. Uninstall `@sveltejs/adapter-auto`.
- Add `src/routes/+layout.ts` with `export const prerender = true;`.
- Replace the scaffold's welcome page with a placeholder home page.
- Add `.github/workflows/deploy.yml`: `npm ci`, `npm run check`, `npm run build` with `BASE_PATH=/game-hub`, then upload `build/` and deploy.
- **Done when:** `https://<user>.github.io/game-hub/` loads, and every asset request resolves under `/game-hub/` with no 404s.

### Phase 2 — Install and offline support
- Generate placeholder icons into `static/icons/`: 192x192, 512x512, a 512x512 maskable variant (mark kept inside the central 80% safe zone), and a 180x180 `apple-touch-icon` for iOS. A solid theme-color background with a simple pixel-art mark is enough. Real art replaces these files later with no code changes.
- Add `static/manifest.json` per **PWA / Offline Requirements**. Link it and the apple-touch icon from `+layout.svelte` using `asset()`, and add a `theme-color` meta tag.
- Add `src/service-worker.ts`: on `install`, precache `immutable`, `assets`, and `prerendered` into a cache named after `version`; on `activate`, delete older caches; on `fetch`, serve GET requests from the cache first and fall back to the network.
- **Done when:** DevTools → Application shows the app as installable with no manifest errors, and after one visit the deployed site reloads and navigates with DevTools set to Offline.

### Phase 3 — Core framework (verified with a throwaway stub game)
- Add Vitest, an `npm test` script, and a test step in the deploy workflow before the build.
- `core/storage.ts`: `getScore(slug)` / `setScore(slug, value)` plus generic load/save, with keys prefixed by slug. Wrap every `localStorage` call in try/catch (it can throw in private browsing) and fall back to defaults. Tested.
- `core/gameLoop.ts`: fixed-timestep loop over `requestAnimationFrame` with an accumulator, exposing `start`, `stop`, `pause`, `resume`. Cap the elapsed time per frame so returning to a backgrounded tab doesn't fast-forward the game. Tested with an injected clock.
- `core/input.ts`: maps arrows/WASD and swipes to named actions (`up`, `down`, `left`, `right`, `action`), and also reports taps and pointer position. Tetris needs rotate/drop and Deer Hunter needs aim/shoot, so a directions-only API would have to break later. Attaches to an element and returns a cleanup function. Swipe detection tested.
- `core/types.ts`: `GameProps`, the props every game component accepts (e.g. `paused`, `onScore`, `onGameOver`).
- `core/canvas.ts`: sizes a canvas to its container and scales it by `devicePixelRatio` so games are sharp on phones.
- `core/GameShell.svelte`: score HUD, pause menu (resume / restart / back to menu), back button. Pauses automatically on `visibilitychange`. Restart remounts the game with `{#key}`, so games need no reset logic of their own. The play area gets `touch-action: none` so swipes don't scroll the page or trigger pull-to-refresh.
- `games/registry.ts` with the typed `GameEntry` and one temporary `stub` game (e.g. a canvas that adds a point per tap).
- `routes/+page.svelte`: grid of games from the registry, linking with `resolve()`.
- `routes/play/[slug]/+page.ts`: `entries()` returns every registry slug so each game page is prerendered (and therefore precached); `load` throws a 404 for unknown slugs.
- `routes/play/[slug]/+page.svelte`: looks up the entry, awaits `component()`, and renders it inside `GameShell`.
- **Done when:** `npm test` and `npm run check` pass; the stub game opens from the home grid; pause, resume, restart, and back all work; `build/play/stub.html` exists; and the stub is playable offline after deploy.

### Phase 4 — Snake, end to end
- `games/snake/logic.ts`: grid state, movement, turning (ignore reversing into itself, and queue a second turn pressed within the same tick), growth, wall and self collision, and food placement on a free cell using an injectable random source. Pure functions only.
- `games/snake/logic.test.ts`: covers each rule above, including food never spawning on the snake.
- `games/snake/Snake.svelte`: owns the canvas, drives `logic.ts` from `gameLoop.ts` and `input.ts`, reports score through `GameProps`, and saves the high score through `storage.ts`.
- Remove the stub game and its registry line; add Snake's line.
- **Done when:** Snake plays correctly with the keyboard on desktop and with swipes on a real phone, the high score survives a reload, and the installed app launched from the home screen works in airplane mode. **This is the sign-off gate before any other game.**

### Phase 5 — Tetris (after Phase 4 sign-off)
- Same pattern: `tetris/logic.ts` with tests (rotation including wall kicks, line clears, scoring, gravity and levels), then `Tetris.svelte`, then one registry line.
- Should need no changes to `core/`. If it does, make the core change in its own commit and re-check Snake.
- **Done when:** the Phase 4 checks pass for Tetris, and Snake still passes them.

### Phase 6 — 8-bit Deer Hunter (after Phase 5 sign-off)
- Same pattern: `deer-hunter/logic.ts` with tests, then `DeerHunter.svelte`, then one registry line.
- The game most likely to need new core features (sprite-sheet loading, maybe audio). Sprites and sounds must be imported through the build or placed in `static/` so the service worker precaches them; never load them from external URLs.
- **Done when:** the Phase 4 checks pass for Deer Hunter, and Snake and Tetris still pass them.

## Explicitly Out of Scope for Now
- Tetris and Deer Hunter implementations (build after Snake is confirmed working)
- Multiplayer or online leaderboards (contradicts offline-first goal)
- Any backend/server component
