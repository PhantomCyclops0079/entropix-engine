/**
 * SoAPool.js — Structure-of-Arrays Object Pool Factory (M0-10)
 * =============================================================
 * Creates pre-allocated TypedArray pools. Core of the DOD architecture.
 *
 * Features:
 *   - Arbitrary field definitions (name, TypedArrayConstructor, default)
 *   - Auto prevX/prevY injection for interpolated pools
 *   - spawn() → index   (O(1), from active tail)
 *   - queueKill(index)  (deferred, dedup'd)
 *   - flushKills()       (frame-end batch, swap-with-last)
 *   - forEach(cb)        (iterate active range)
 *   - savePrev()         (bulk copy x→prevX, y→prevY for interpolation)
 *
 * ★ Zero allocation after init. All TypedArrays pre-allocated.
 * ★ Hot-path safe: spawn/kill never during forEach; kills deferred.
 *
 * Usage:
 *   const pool = createSoAPool({
 *     capacity: 2000,
 *     fields: [
 *       { name: 'x',  type: Float32Array, default: 0 },
 *       { name: 'y',  type: Float32Array, default: 0 },
 *       { name: 'vx', type: Float32Array, default: 0 },
 *       { name: 'vy', type: Float32Array, default: 0 },
 *       { name: 'hp', type: Int32Array,   default: 100 },
 *     ],
 *     interpolated: true, // auto-adds prevX, prevY
 *   });
 *
 *   const i = pool.spawn();
 *   pool.x[i] = 100;  // direct TypedArray access
 *   pool.forEach(idx => { pool.x[idx] += pool.vx[idx]; });
 *   pool.queueKill(i);
 *   pool.flushKills();
 *
 * @module structures/SoAPool
 */

import { createDeferredKillQueue } from './DeferredKillQueue.js';

/**
 * @typedef {Object} FieldDef
 * @property {string} name - Field name (becomes pool[name] accessor)
 * @property {typeof Float32Array | typeof Int32Array | typeof Uint8Array | typeof Uint16Array | typeof Uint32Array | typeof Int16Array} type
 * @property {number} [default=0] - Value written on spawn
 */

/**
 * @typedef {Object} SoAPoolConfig
 * @property {number} capacity - Maximum entities
 * @property {FieldDef[]} fields - Field definitions
 * @property {boolean} [interpolated=false] - If true, auto-add prevX/prevY fields
 */

/**
 * Create a Structure-of-Arrays object pool.
 *
 * @param {SoAPoolConfig} config
 * @returns {Object} Pool instance with typed arrays as direct properties
 */
export function createSoAPool(config) {
  const { capacity, fields, interpolated = false } = config;

  // ── Build final field list ────────────────────────
  /** @type {FieldDef[]} */
  const allFields = [...fields];

  // Auto-inject prevX/prevY for interpolation (M0-02)
  if (interpolated) {
    const hasField = (name) => allFields.some(f => f.name === name);
    if (!hasField('prevX')) {
      allFields.push({ name: 'prevX', type: Float32Array, default: 0 });
    }
    if (!hasField('prevY')) {
      allFields.push({ name: 'prevY', type: Float32Array, default: 0 });
    }
  }

  // ── Allocate TypedArrays ──────────────────────────
  /** @type {Map<string, {array: TypedArray, default: number}>} */
  const fieldMap = new Map();
  /** @type {Array<{name: string, array: TypedArray, default: number}>} */
  const fieldList = [];

  for (const def of allFields) {
    const arr = new def.type(capacity);
    const entry = { name: def.name, array: arr, default: def.default ?? 0 };
    fieldMap.set(def.name, entry);
    fieldList.push(entry);
  }

  // ── Pool State ────────────────────────────────────
  let _count = 0;  // Number of active entities [0, count)

  // ── Deferred Kill Queue ───────────────────────────
  const _killQueue = createDeferredKillQueue(capacity);

  // ── Swap function (copies all fields from src to dst) ──
  // Passed to DeferredKillQueue.flush()
  function _swapFields(dst, src) {
    for (let f = 0; f < fieldList.length; f++) {
      fieldList[f].array[dst] = fieldList[f].array[src];
    }
  }

  // ── Build Pool Object ─────────────────────────────
  const pool = {
    /** Pool capacity (fixed). */
    capacity,

    /** Number of active entities. Read-only externally. */
    get count() { return _count; },

    /** List of field names (for debug/inspection). */
    fieldNames: allFields.map(f => f.name),

    /**
     * Spawn a new entity at the tail of the active range.
     * All fields are initialized to their default values.
     *
     * @returns {number} Index of the spawned entity, or -1 if pool full.
     */
    spawn() {
      if (_count >= capacity) return -1;

      const i = _count;
      // Initialize all fields to defaults
      for (let f = 0; f < fieldList.length; f++) {
        fieldList[f].array[i] = fieldList[f].default;
      }
      _count++;
      return i;
    },

    /**
     * Queue an entity for deferred kill. Safe during iteration.
     * Actual removal happens in flushKills().
     * @param {number} index
     */
    queueKill(index) {
      _killQueue.queue(index);
    },

    /**
     * Execute all queued kills via swap-with-last.
     * MUST be called at frame end, outside any forEach loop.
     * @returns {number} Number of entities killed this flush
     */
    flushKills() {
      const before = _count;
      _count = _killQueue.flush(_count, _swapFields);
      return before - _count;
    },

    /**
     * Iterate over all active entities.
     * ★ Do NOT call spawn() or flushKills() inside callback.
     * ★ queueKill() inside callback is SAFE (deferred).
     *
     * @param {(index: number) => void} callback
     */
    forEach(callback) {
      for (let i = 0; i < _count; i++) {
        callback(i);
      }
    },

    /**
     * Bulk copy x→prevX, y→prevY for all active entities.
     * Call at the START of each tick, before physics update.
     * Only works if pool was created with interpolated: true.
     */
    savePrev() {
      const x     = fieldMap.get('x');
      const y     = fieldMap.get('y');
      const prevX = fieldMap.get('prevX');
      const prevY = fieldMap.get('prevY');

      if (!x || !y || !prevX || !prevY) return;

      const xa = x.array;
      const ya = y.array;
      const pa = prevX.array;
      const pb = prevY.array;

      for (let i = 0; i < _count; i++) {
        pa[i] = xa[i];
        pb[i] = ya[i];
      }
    },

    /**
     * Kill all active entities immediately. No deferred queue.
     * Use for phase transitions / pool drain.
     */
    drain() {
      _killQueue.reset();
      _count = 0;
    },

    /**
     * Returns the number of queued (pending) kills.
     * @returns {number}
     */
    get pendingKills() {
      return _killQueue.pending;
    },

    /**
     * Get a field's TypedArray by name. For dynamic access.
     * Prefer direct pool.x / pool.y access in hot paths.
     * @param {string} name
     * @returns {TypedArray | undefined}
     */
    getField(name) {
      const entry = fieldMap.get(name);
      return entry ? entry.array : undefined;
    },
  };

  // ── Attach TypedArrays as direct properties ───────
  // This is the primary access path: pool.x[i], pool.vy[i], etc.
  for (const entry of fieldList) {
    Object.defineProperty(pool, entry.name, {
      value: entry.array,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }

  return pool;
}
