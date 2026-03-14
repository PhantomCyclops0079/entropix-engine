/**
 * GameLoop.js — Fixed-Timestep Main Loop (M0-02 ~ M0-06, M0-08.0.5)
 * ===============================================================
 * rAF → dt clamp → accumulator → fixed ticks → render gate → render.
 *
 * Integration with AdaptiveBudget:
 *   - shouldRender() decides if this frame gets rendered
 *   - reportRenderTime() feeds Tier 2 resolution scaling
 *   - Ticks ALWAYS run regardless of render skip (Iron Law)
 *
 * @module core/GameLoop
 */

import { TICK_MS, DT_CLAMP_MS, MAX_ACCUMULATOR, MAX_SUB_STEPS } from '../config.js';
import { Time } from './Time.js';
import { tickHitstop } from './Time.js';
import { shouldRender, reportRenderTime } from '../render/AdaptiveBudget.js';

// ── Private State ─────────────────────────────────────
let _running     = false;
let _rafId       = 0;
let _prevTime    = 0;
let _accumulator = 0;

/** @type {((tickMs: number, timeScale: number) => void) | null} */
let _tickFn      = null;
/** @type {((alpha: number) => void) | null} */
let _renderFn    = null;

// ── FPS / TPS / rafHz counters ────────────────────────
let _fpsFrames   = 0;     // rendered frames this second
let _tpsFrames   = 0;     // ticks this second
let _rafFrames   = 0;     // total rAF callbacks this second (including skipped)
let _counterTime = 0;

/** @type {((fps: number, tps: number) => void) | null} */
let _diagCallback = null;

/**
 * Single rAF frame. Hot path.
 * @param {number} now
 */
function frame(now) {
  if (!_running) return;
  _rafId = requestAnimationFrame(frame);

  // ── Raw dt (unclamped — needed by AdaptiveBudget Hz estimator) ──
  const rawDt = now - _prevTime;
  _prevTime   = now;
  _rafFrames++;

  // ── M3: Hitstop countdown (real time, before tick loop) ──
  tickHitstop(rawDt);

  // ── M0-03: dt clamp ──
  const dt = Math.min(rawDt, DT_CLAMP_MS);

  // ── M8.0.5: Pause freeze ──────────────────────────────────────────
  // When timeScale=0 (full pause), accumulator must NOT grow.
  // Otherwise alpha oscillates 0→1 every ~6 rAF frames on 360Hz,
  // causing lerp(prevX, x, alpha) to jitter visibly because
  // prevX ≠ x (frozen from the last real tick's movement delta).
  // Hitstop countdown (above) still ticks on real time — unaffected.
  // ───────────────────────────────────────────────────────────────────
  let steps = 0;

  if (Time.timeScale > 0) {
    // ── M0-04: accumulator with hard cap ──
    _accumulator += dt;
    if (_accumulator > MAX_ACCUMULATOR) {
      _accumulator = MAX_ACCUMULATOR;
    }

    // ── M0-02 + M0-05: fixed-timestep tick loop ──
    // Ticks ALWAYS run even if render is skipped (Iron Law)
    while (_accumulator >= TICK_MS && steps < MAX_SUB_STEPS) {
      if (_tickFn) {
        _tickFn(TICK_MS, Time.timeScale);
      }
      Time.globalFrameId = (Time.globalFrameId + 1) >>> 0;
      Time.gameTime     += TICK_MS * Time.timeScale;
      Time.realTime     += TICK_MS;
      _accumulator -= TICK_MS;
      steps++;
      _tpsFrames++;
    }

    Time.alpha = _accumulator / TICK_MS;
  }
  // else: paused — accumulator frozen, alpha frozen at last value

  Time.subSteps    = steps;
  Time.accumulator = _accumulator;

  // ── M0-09: Render gate (AdaptiveBudget decides) ──
  const doRender = shouldRender(now, rawDt);

  if (doRender && _renderFn) {
    const renderStart = performance.now();
    _renderFn(Time.alpha);
    const renderMs = performance.now() - renderStart;
    reportRenderTime(renderMs);
    _fpsFrames++;
  }

  // ── 1-second counters ──
  _counterTime += dt;
  if (_counterTime >= 1000) {
    Time.fps   = _fpsFrames;
    Time.tps   = _tpsFrames;
    Time.rafHz = _rafFrames;

    if (_diagCallback) _diagCallback(Time.fps, Time.tps);

    _fpsFrames   = 0;
    _tpsFrames   = 0;
    _rafFrames   = 0;
    _counterTime -= 1000;
  }
}

// ── Public API ────────────────────────────────────────

/**
 * Start the game loop.
 * @param {(tickMs: number, timeScale: number) => void} tickFn
 * @param {(alpha: number) => void} renderFn
 */
export function startLoop(tickFn, renderFn) {
  if (_running) return;
  _tickFn      = tickFn;
  _renderFn    = renderFn;
  _running     = true;
  _accumulator = 0;
  _fpsFrames   = 0;
  _tpsFrames   = 0;
  _rafFrames   = 0;
  _counterTime = 0;
  _prevTime    = performance.now();
  _rafId       = requestAnimationFrame(frame);
}

/** Stop the game loop. */
export function stopLoop() {
  _running = false;
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
}

/** Register a 1-second diagnostics callback. */
export function onDiagnostics(cb) {
  _diagCallback = cb;
}

export function isRunning() {
  return _running;
}

/**
 * Execute one frame of tick+render logic WITHOUT registering a new rAF.
 * Used exclusively by PerfHarness 360Hz sim to inject synthetic frames
 * alongside the normal rAF-driven loop.
 *
 * @param {number} now - performance.now() timestamp
 */
export function syntheticFrame(now) {
  if (!_running) return;

  const rawDt = now - _prevTime;
  _prevTime   = now;
  _rafFrames++;

  // M3: Hitstop countdown (real time)
  tickHitstop(rawDt);

  const dt = Math.min(rawDt, DT_CLAMP_MS);

  // M8.0.5: Pause freeze (same logic as frame())
  let steps = 0;

  if (Time.timeScale > 0) {
    _accumulator += dt;
    if (_accumulator > MAX_ACCUMULATOR) _accumulator = MAX_ACCUMULATOR;

    while (_accumulator >= TICK_MS && steps < MAX_SUB_STEPS) {
      if (_tickFn) _tickFn(TICK_MS, Time.timeScale);
      Time.globalFrameId = (Time.globalFrameId + 1) >>> 0;
      Time.gameTime     += TICK_MS * Time.timeScale;
      Time.realTime     += TICK_MS;
      _accumulator -= TICK_MS;
      steps++;
      _tpsFrames++;
    }

    Time.alpha = _accumulator / TICK_MS;
  }

  Time.subSteps    = steps;
  Time.accumulator = _accumulator;

  const doRender = shouldRender(now, rawDt);
  if (doRender && _renderFn) {
    const renderStart = performance.now();
    _renderFn(Time.alpha);
    reportRenderTime(performance.now() - renderStart);
    _fpsFrames++;
  }

  _counterTime += dt;
  if (_counterTime >= 1000) {
    Time.fps   = _fpsFrames;
    Time.tps   = _tpsFrames;
    Time.rafHz = _rafFrames;
    if (_diagCallback) _diagCallback(Time.fps, Time.tps);
    _fpsFrames   = 0;
    _tpsFrames   = 0;
    _rafFrames   = 0;
    _counterTime -= 1000;
  }
}