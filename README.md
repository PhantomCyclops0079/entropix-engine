# entropix-engine

A high-performance, zero-dependency game engine for browser-based 
real-time games, built in vanilla JavaScript ES6 modules.

Developed as the core engine for a bullet-heaven roguelite running 
entirely in HTML5 Canvas 2D — no frameworks, no build tools, 
no external dependencies.

Note: ignore the m0 or m* marks for progress marks in my current game project

---

## Performance Targets

- **3,000 active entities** at stable 60 TPS logic
- **Zero heap allocation** in hot paths (verified via Chrome DevTools)
- **Hardware-adaptive rendering** from 60Hz to 360Hz displays
- Logic tick: ~1.5ms for 3,000 entities including spatial queries

---

## Core Systems

### Fixed-Timestep Game Loop (`GameLoop.js`)
Decouples logic from rendering entirely. Logic runs at a locked 
60 TPS via an accumulator model. Rendering runs at native display 
frequency (60–360Hz) with alpha interpolation for smooth motion 
at any framerate.

Three-layer death spiral defense:
- `dt` clamp at 100ms
- Accumulator hard cap at 250ms  
- Max sub-steps: 5

Includes pause-safe accumulator freeze — prevents alpha oscillation 
on high-refresh displays when `timeScale = 0`.

### Spatial Hash Grid (`GridHash.js`)
Linked-list spatial hash using pure `Int32Array` for zero allocation.
Supports infinite world coordinates via prime-based bit hashing.

Reduces collision checks from O(N²) to O(N×K):
- 3,000 entities: from ~4.5M checks to ~2,000 per tick

### Structure-of-Arrays Entity Pool (`SoAPool.js`)
TypedArray-backed entity pool factory. All entity data stored as 
flat arrays (`pool.x[i]`, `pool.hp[i]`) for cache efficiency and 
zero GC pressure.

Key features:
- `spawn()` — O(1) tail append with field initialization
- `queueKill()` — deferred kill marking during iteration
- `flushKills()` — swap-with-last batch removal
- `savePrev()` — bulk position snapshot for interpolation
- `interpolated: true` — auto-injects `prevX`/`prevY` fields

**Iron rule:** Any pool with `interpolated: true` must sync 
`prevX/prevY` on `spawn()` to prevent ghost interpolation artifacts.

---

## Architecture Principles

- **Zero GC in hot paths** — no closures, no dynamic allocation 
  in loops, no `Map`/`Set`, no string concatenation
- **Reverse traversal with deferred kills** — prevents index 
  corruption during `swap-with-last` compaction
- **Decoupled physics and damage** — collision response runs 
  unconditionally every frame; damage is throttled separately
- **Deterministic RNG** — SplitMix32 PRNG replaces `Math.random()` 
  for reproducible behavior

---

## What This Is Not

This is not a general-purpose game engine or a published library.
It is the extracted core of a specific game project, shared as a 
reference for developers building performance-sensitive real-time 
systems in the browser.

No npm package. No documentation beyond this README. 
Read the source.

---

## Built by

[@Phantom_Cyclops](https://github.com/Phantom_Cyclops)
