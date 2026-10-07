# Offline Game Hub — Project Plan

## Overview
A PWA built with SvelteKit that hosts multiple browser games, installable and fully playable offline (no Wi-Fi / low signal). Games are added one at a time via a plugin-style registry so new games never require touching existing code. Hosted on GitHub Pages as a static site.

## Tech Stack
- SvelteKit 3 with `adapter-static` (some APIs differ from SvelteKit 2 — see **SvelteKit 3 Notes**)
- TypeScript
- Vanilla Canvas 2D for game rendering (no game engine library)
- SvelteKit's built-in service worker support (`src/service-worker/index.ts` + `$app/manifest`) for offline caching
- `localStorage` for optional per-game persistence
- Vitest for unit tests of game logic and core modules
- GitHub Pages for hosting (repo: `game-hub`, deployed by GitHub Actions)

## SvelteKit 3 Notes
The project is on SvelteKit 3.0.1. Many docs, examples, and AI-model defaults assume SvelteKit 2. Where they disagree, follow these:
- There is no `svelte.config.js`. Kit options (adapter, `paths.base`, etc.) go in the `sveltekit({...})` call in `vite.config.ts`.
- The library alias is `#lib` (defined in `package.json` `imports`), not `$lib`. It's a Node subpath import, so it doesn't add extensions: import `#lib/games/registry.ts`, not `#lib/games/registry`. Inside `src/lib`, use relative imports.
- The `$service-worker` module is gone. Use `immutable`, `assets`, and `prerendered` from `$app/manifest`; `version` from `$app/env`; and `self` from `$app/service-worker`.
- The service worker is its own TypeScript project: `src/service-worker/index.ts` next to a `tsconfig.json` that extends `$app/tsconfig/service-worker`, with `src/service-worker` excluded from the root `tsconfig.json`. `npm run check` type-checks it separately with `tsc -p src/service-worker`.
- `$app/paths` no longer exports `base`. Build internal links with `resolve()` and static-file URLs with `asset()` from `$app/paths`, so they work under `/game-hub`. `asset()` takes paths without a leading slash (`asset('manifest.json')`), and `resolve()` is typed for app routes only, so it can't resolve build-file paths.
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
  service-worker/
    index.ts                      # precaches the build for offline play
    tsconfig.json                 # WebWorker types; excluded from the root tsconfig
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
      TouchControls.svelte          # optional on-screen D-pad (+ action button); sends actions through input.ts
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
   import type { Action } from '../core/input';
   import type { GameProps } from '../core/types';

   export interface GameEntry {
     slug: string;
     name: string;
     component: () => Promise<{ default: Component<GameProps> }>;
     /** On-screen buttons the player can turn on instead of swiping; omit for none. */
     controls?: Action[];
   }

   export const games: GameEntry[] = [
     { slug: 'snake', name: 'Snake', component: () => import('./snake/Snake.svelte'), controls: ['up', 'down', 'left', 'right'] },
   ];
   ```
   Adding a game means: create a new folder under `src/lib/games/`, add one line to this array. Nothing else should need to change.

2. **Separate logic from rendering.** Each game has a `logic.ts` with pure functions/state (no DOM, no canvas) and a `.svelte` file that owns the canvas element and calls into `logic.ts`. This keeps logic testable and keeps games consistent with each other.

3. **Shared game loop.** All games use the same `gameLoop.ts` helper (fixed-timestep `requestAnimationFrame` wrapper) rather than each game writing its own loop.

4. **Unified input handling.** `input.ts` provides a single interface for keyboard arrows/WASD and touch swipe gestures, so every game supports both phone touch and (if used) desktop keyboard without duplicating input code. Players who prefer buttons to swipes can turn on an on-screen D-pad from the pause menu (one setting for all games, off by default). A game opts in by listing its buttons in the registry's `controls`; `TouchControls.svelte` sends presses through `sendAction`, so they reach the game's `bindInput` handlers exactly like key presses and the game needs no code for them. Swipes keep working while the buttons are shown.

5. **Consistent shell.** `GameShell.svelte` wraps every game with the same pause menu, score display, and back-to-menu button, so games only render their own play area.

6. **Namespaced storage.** Any game needing persistence goes through `storage.ts` (`load`/`save`, `getScore(slug)` / `setScore(slug, value)`) — never calls `localStorage` directly from a game component. High scores need no game code at all: `GameShell` records them from `onGameOver`.

7. **Lazy loading.** Games are dynamically imported via the registry's `component()` function so the initial bundle stays small and offline installs are fast.

8. **Fit whatever space the play area gets.** The play area can be any size and shape: a phone held upright (~390x700), a phone held sideways where the HUD becomes a sidebar (~680x370), a tablet, or a desktop window. It changes when the phone rotates or the window resizes. The shell already keeps it clear of notches and the home indicator, so games never handle safe areas themselves. Each game:
   - sizes its canvas with `fitCanvas` (`core/canvas.ts`) and redraws in its `onResize`; a resize never resets or pauses the game.
   - keeps `logic.ts` in its own units (grid cells, world coordinates), never pixels. The component derives a scale and offset from the canvas size, centres the board, and fills the rest with the background (letterboxing).
   - uses whole-pixel cell sizes (and `imageSmoothingEnabled = false` for sprites) so pixel art stays crisp.
   - binds input to the whole canvas, so swipes and taps in the letterbox margins still count, and converts tap and pointer points to game units with the same scale and offset it draws with.
   - sizes text and anything else drawn on the canvas relative to the board, and makes any on-screen control or tap target at least 44 CSS px (`--touch-target`).

## PWA / Offline Requirements
- Use `adapter-static` with `paths.base` read from a `BASE_PATH` environment variable: `/game-hub` in the deploy workflow, empty in local dev.
- Use SvelteKit's built-in service worker (`src/service-worker/index.ts`) and precache everything listed in `$app/manifest` (`immutable`, `assets`, `prerendered`) on install — do not hand-maintain a cache list.
- `static/manifest.json` must include name, short_name, start_url and scope set to `"./"` (relative to the manifest, so they respect the base path without hardcoding it), display: "standalone", background/theme colors, and icons at minimum 192x192 and 512x512.
- Verify the app loads and is playable with network fully disabled after first visit (test via DevTools offline mode).

## Deployment
- GitHub Pages via a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs type checks, tests, and `npm run build`, then publishes `build/` with `actions/upload-pages-artifact` and `actions/deploy-pages`.
- In the GitHub repo settings, set Pages → Source to "GitHub Actions".
- The GitHub account has a custom domain, so the site is served at `https://fjordworkssoftware.com/game-hub/` (the `github.io` URL redirects there). That origin is shared with every other project site on the domain, and so are its Cache Storage and `localStorage`. The service worker's caches and the storage keys must be prefixed with `game-hub` (see Phases 2 and 3).

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
- Add `src/service-worker/index.ts` (and its `tsconfig.json`, see **SvelteKit 3 Notes**): on `install`, precache `immutable`, `assets`, and `prerendered` into a cache named `game-hub-<version>`; on `activate`, delete older caches whose names start with `game-hub-` and leave every other cache alone (they belong to other sites on the shared domain); on `fetch`, serve GET requests from the cache first and fall back to the network.
- **Done when:** DevTools → Application shows the app as installable with no manifest errors, and after one visit the deployed site reloads and navigates with DevTools set to Offline.

### Phase 3 — Core framework (verified with a throwaway stub game)
- Add Vitest, an `npm test` script, and a test step in the deploy workflow before the build.
- `core/storage.ts`: `getScore(slug)` / `setScore(slug, value)` plus generic load/save, with keys of the form `game-hub:<slug>:<key>` so they can't collide with other sites on the shared domain. Wrap every `localStorage` call in try/catch (it can throw in private browsing) and fall back to defaults. Tested.
- `core/gameLoop.ts`: fixed-timestep loop over `requestAnimationFrame` with an accumulator, exposing `start`, `stop`, `pause`, `resume`. Cap the elapsed time per frame so returning to a backgrounded tab doesn't fast-forward the game. Tested with an injected clock.
- `core/input.ts`: maps arrows/WASD and swipes to named actions (`up`, `down`, `left`, `right`, `action`), and also reports taps and pointer position. Tetris needs rotate/drop and Deer Hunter needs aim/shoot, so a directions-only API would have to break later. Attaches to an element and returns a cleanup function. Swipe detection tested.
- `core/types.ts`: `GameProps`, the props every game component accepts: `paused`, `onScore`, `onGameOver`. The shell records the high score when `onGameOver` is called, so games don't touch storage for it.
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
- `games/snake/Snake.svelte`: owns the canvas, drives `logic.ts` from `gameLoop.ts` and `input.ts`, and reports the score and game over through `GameProps` (the shell records the high score).
- Layout (rule 8): a fixed square grid (e.g. 20x20), so the game plays the same on every device. Cell size is `floor(min(width, height) / 20)` and the board is centred. Rotating the phone mid-game rescales the board without resetting it.
- Remove the stub game and its registry line; add Snake's line.
- **Done when:** Snake plays correctly with the keyboard on desktop and with swipes on a real phone, held both upright and sideways, including rotating mid-game. The board never sits under the notch or home indicator, and swipes work anywhere in the play area. The high score survives a reload, and the installed app launched from the home screen works in airplane mode. **This is the sign-off gate before any other game.**

### Phase 5 — Tetris (after Phase 4 sign-off)
- Same pattern: `tetris/logic.ts` with tests (rotation including wall kicks, line clears, scoring, gravity and levels), then `Tetris.svelte`, then one registry line.
- Layout (rule 8): the 10x20 board suits a phone held upright. Held sideways (~370px tall), cells shrink to about 18px, so check it's still readable. Draw the next-piece preview, level, and lines inside the canvas beside the board (the HUD only shows score and best); there's room beside a tall board in both orientations.
- Touch controls: tap rotates, swipe left/right moves one column (one long drag moves several, since swipes fire mid-gesture), swipe down drops. Try it on a real phone before finishing. Also list Tetris's buttons in the registry's `controls` so players can use the shared on-screen D-pad instead. Tetris needs rotate and drop as separate actions, so extend `Action` in `input.ts` and `TouchControls.svelte` (e.g. rotate on the round button plus a second button for drop), and consider hold-to-repeat for left, right, and down.
- Should need no changes to `core/`. If it does, make the core change in its own commit and re-check Snake.
- **Done when:** the Phase 4 checks pass for Tetris, and Snake still passes them.

### Phase 6 — 8-bit Deer Hunter (after Phase 5 sign-off)
- Same pattern: `deer-hunter/logic.ts` with tests, then `DeerHunter.svelte`, then one registry line.
- The game most likely to need new core features (sprite-sheet loading, maybe audio). Sprites and sounds must be imported through the build or placed in `static/` so the service worker precaches them; never load them from external URLs.
- Layout (rule 8): a wide, low-resolution 8-bit scene (e.g. 16:9, scaled up by a whole number) suits a phone held sideways. Held upright it letterboxes into a small strip. Orientation can't be locked per game (iOS doesn't support locking, and the manifest's `orientation` would apply to every game), so show a "turn your phone sideways" hint when the play area is taller than it is wide.
- Aiming: on touch, tap to shoot. On desktop, `onPointerMove` drives a crosshair and a click shoots. Convert points to world coordinates with the drawing scale and offset, and keep hit areas at least 44 CSS px on a phone, enlarging them beyond the sprite if needed.
- **Done when:** the Phase 4 checks pass for Deer Hunter, and Snake and Tetris still pass them.

## Explicitly Out of Scope for Now
- Tetris and Deer Hunter implementations (build after Snake is confirmed working)
- Multiplayer or online leaderboards (contradicts offline-first goal)
- Any backend/server component
