/**
 * GridHash.js — Zero-Allocation Spatial Hash Grid (M6-01)
 * ========================================================
 * Linked-list spatial indexing using flat Int32Arrays.
 * No objects, no Map, no Array — pure TypedArray + head-insert chains.
 *
 * Storage:
 *   cellHead[cellIdx] → first entityId in cell (or -1)
 *   next[entityId]    → next entityId in same cell (or -1)
 *
 * Usage per tick:
 *   grid.clear();
 *   for (i..count) grid.insert(i, x[i], y[i]);
 *   grid.query(px, py, radius, (id) => { ... });
 *
 * @module structures/GridHash
 */

/**
 * Create a spatial hash grid.
 * @param {number} width   — World width in pixels
 * @param {number} height  — World height in pixels
 * @param {number} cellSize — Cell edge length in pixels
 * @param {number} maxEntities — Max entity count (determines `next` array size)
 * @returns {GridHashInstance}
 */
export function createGridHash(width, height, cellSize, maxEntities) {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellCount = cols * rows;
  const invCell = 1 / cellSize;

  const cellHead = new Int32Array(cellCount).fill(-1);
  const next     = new Int32Array(maxEntities).fill(-1);

  return {
    cols,
    rows,
    cellSize,
    cellHead,
    next,

    /**
     * Resize for new world dimensions (e.g. viewport change).
     * Reuses arrays if cell count hasn't grown.
     * @param {number} newWidth
     * @param {number} newHeight
     */
    resize(newWidth, newHeight) {
      // No-op for now — world dimensions are dynamic but cell arrays
      // are pre-allocated large enough. If cols/rows grow beyond initial,
      // we'd need to reallocate, but our world only shrinks from the
      // initial max (responsive viewport).
    },

    /**
     * Clear all cells. O(cells) — fast fill.
     */
    clear() {
      cellHead.fill(-1);
    },

    /**
     * Insert entity into the grid. Head-insert linked list.
     * @param {number} entityId
     * @param {number} x
     * @param {number} y
     */
    insert(entityId, x, y) {
      const col = (x * invCell) | 0;
      const row = (y * invCell) | 0;
      // Clamp to grid bounds
      const c = col < 0 ? 0 : col >= cols ? cols - 1 : col;
      const r = row < 0 ? 0 : row >= rows ? rows - 1 : row;
      const cellIdx = r * cols + c;

      // Head-insert: new entity points to old head, cell points to new entity
      next[entityId] = cellHead[cellIdx];
      cellHead[cellIdx] = entityId;
    },

    /**
     * Query all entities within radius of (qx, qy).
     * Iterates the 2D range of cells the AABB covers.
     * Calls callback(entityId) for each candidate.
     * Caller must do fine-grained distance check.
     *
     * @param {number} qx
     * @param {number} qy
     * @param {number} radius
     * @param {(entityId: number) => void} callback
     */
    query(qx, qy, radius, callback) {
      const minCol = Math.max(0, ((qx - radius) * invCell) | 0);
      const maxCol = Math.min(cols - 1, ((qx + radius) * invCell) | 0);
      const minRow = Math.max(0, ((qy - radius) * invCell) | 0);
      const maxRow = Math.min(rows - 1, ((qy + radius) * invCell) | 0);

      for (let r = minRow; r <= maxRow; r++) {
        const rowBase = r * cols;
        for (let c = minCol; c <= maxCol; c++) {
          let id = cellHead[rowBase + c];
          while (id !== -1) {
            if (callback(id) === true) return; // early exit
            id = next[id];
          }
        }
      }
    },

    /**
     * Query entities near a point, returning the nearest one.
     * Avoids allocations — uses closure state.
     *
     * @param {number} qx
     * @param {number} qy
     * @param {number} radius
     * @param {Float32Array} ex — Entity X positions
     * @param {Float32Array} ey — Entity Y positions
     * @param {Float32Array|null} ehp — Entity HP (null = skip hp check)
     * @returns {number} — Nearest entity index, or -1
     */
    queryNearest(qx, qy, radius, ex, ey, ehp) {
      let bestIdx = -1;
      let bestDsq = radius * radius;

      const minCol = Math.max(0, ((qx - radius) * invCell) | 0);
      const maxCol = Math.min(cols - 1, ((qx + radius) * invCell) | 0);
      const minRow = Math.max(0, ((qy - radius) * invCell) | 0);
      const maxRow = Math.min(rows - 1, ((qy + radius) * invCell) | 0);

      for (let r = minRow; r <= maxRow; r++) {
        const rowBase = r * cols;
        for (let c = minCol; c <= maxCol; c++) {
          let id = cellHead[rowBase + c];
          while (id !== -1) {
            if (!ehp || ehp[id] > 0) {
              const dx = ex[id] - qx;
              const dy = ey[id] - qy;
              const dsq = dx * dx + dy * dy;
              if (dsq < bestDsq) {
                bestDsq = dsq;
                bestIdx = id;
              }
            }
            id = next[id];
          }
        }
      }
      return bestIdx;
    },
  };
}
