'use strict';

// ---------------------------------------------------------------------------
// hardModeEngine.js
// Generates a "hard mode" remix of a platformer level grid.
// Tries Anthropic Claude (claude-haiku-4-5-20251001) if ANTHROPIC_API_KEY is
// set, otherwise falls back to a fully deterministic algorithm.
// ---------------------------------------------------------------------------

// Tile-type constants (matches existing codebase conventions)
const TILE_EMPTY    = 0;
const TILE_PLATFORM = 1;   // also 'T'
const TILE_SPIKE    = 'S';
const TILE_GOAL     = 'G';
const TILE_SPAWN    = 'P';
const TILE_COIN     = 'C';

// New hard-mode tiles
const TILE_WALKER  = 'W';  // enemy_walker  – ground enemy, deadly on contact
const TILE_SAW     = 'Z';  // saw           – spinning saw blade, instant death
const TILE_SPRING  = 'J';  // spring        – launches player very high
const TILE_CRUMBLE = 'B';  // crumble       – disappears 600 ms after stepping on

// Tiles that must never be overwritten
const PROTECTED = new Set([TILE_SPIKE, TILE_GOAL, TILE_SPAWN]);

// Hard limits on how many of each hazard we can add
const MAX_WALKERS  = 3;
const MAX_SAWS     = 4;
const MAX_SPRINGS  = 2;
const MAX_CRUMBLE_PLATFORMS = 3;

// ---------------------------------------------------------------------------
// Low-level grid helpers
// ---------------------------------------------------------------------------

/** Return the tile value at (row, col), or 0 when out-of-bounds. */
function isTile(grid, row, col) {
  if (row < 0 || row >= grid.length)       return 0;
  if (col < 0 || col >= grid[row].length)  return 0;
  return grid[row][col];
}

/** Return true when the tile is a solid surface a character can stand on. */
function isSolid(tile) {
  return tile === TILE_PLATFORM || tile === 'T' || tile === TILE_SPAWN || tile === TILE_GOAL;
}

/** Return true when the tile is traversable empty space. */
function isEmpty(tile) {
  return tile === TILE_EMPTY || tile === 0 || tile === '' || tile === null || tile === undefined;
}

/** Count the number of solid tiles in the 4 cardinal neighbours of (row,col). */
function countAdjacentSolid(grid, row, col) {
  let count = 0;
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    if (isSolid(isTile(grid, row + dr, col + dc))) count++;
  }
  return count;
}

/** Deep-clone a 2-D array. */
function cloneGrid(grid) {
  return grid.map(row => row.slice());
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

/**
 * Return all horizontal runs of solid tiles that are at least `minLen` long.
 * Each entry: { row, startCol, endCol }
 */
function findFlatSequences(grid, minLen = 3) {
  const results = [];
  for (let r = 0; r < grid.length; r++) {
    let start = null;
    for (let c = 0; c <= grid[r].length; c++) {
      const solid = c < grid[r].length && isSolid(grid[r][c]);
      if (solid && start === null) {
        start = c;
      } else if (!solid && start !== null) {
        const len = c - start;
        if (len >= minLen) results.push({ row: r, startCol: start, endCol: c - 1 });
        start = null;
      }
    }
  }
  return results;
}

/**
 * Return all horizontal runs of solid tiles with length in [minLen, maxLen].
 * Each entry: { row, startCol, endCol }
 */
function findIsolatedPlatforms(grid, minLen = 2, maxLen = 3) {
  const results = [];
  for (let r = 0; r < grid.length; r++) {
    let start = null;
    for (let c = 0; c <= grid[r].length; c++) {
      const solid = c < grid[r].length && isSolid(grid[r][c]);
      if (solid && start === null) {
        start = c;
      } else if (!solid && start !== null) {
        const len = c - start;
        if (len >= minLen && len <= maxLen) results.push({ row: r, startCol: start, endCol: c - 1 });
        start = null;
      }
    }
  }
  return results;
}

/**
 * Find columns where there are 3+ consecutive empty rows above a solid tile.
 * Returns [{ platformRow, col }]
 */
function findTallDrops(grid) {
  const drops = [];
  const height = grid.length;
  for (let c = 0; c < (grid[0] || []).length; c++) {
    for (let r = height - 1; r >= 3; r--) {
      if (isSolid(isTile(grid, r, c))) {
        // Count consecutive empty rows above
        let emptyAbove = 0;
        for (let dr = 1; dr <= r; dr++) {
          if (isEmpty(isTile(grid, r - dr, c))) emptyAbove++;
          else break;
        }
        if (emptyAbove >= 3) drops.push({ platformRow: r, col: c });
      }
    }
  }
  return drops;
}

// ---------------------------------------------------------------------------
// Safety: is position within the 2-tile buffer of playerStart or goal?
// ---------------------------------------------------------------------------
function nearCritical(row, col, playerStart, goal, buffer = 2) {
  if (playerStart) {
    const pr = playerStart.row ?? playerStart.y ?? 0;
    const pc = playerStart.col ?? playerStart.x ?? 0;
    if (Math.abs(row - pr) <= buffer && Math.abs(col - pc) <= buffer) return true;
  }
  if (goal) {
    const gr = goal.row ?? goal.y ?? 0;
    const gc = goal.col ?? goal.x ?? 0;
    if (Math.abs(row - gr) <= buffer && Math.abs(col - gc) <= buffer) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deterministic hard-mode generation
// ---------------------------------------------------------------------------
function applyDeterministic({ grid, width, height, playerStart, goal, deathPositions }) {
  const newGrid = cloneGrid(grid);
  const changes = [];
  let walkersAdded = 0;
  let sawsAdded    = 0;
  let springsAdded = 0;
  let crumblesAdded = 0;

  // ── 1. Place W (walker) on long flat platforms ──────────────────────────
  const longSeqs = findFlatSequences(newGrid, 3);
  for (const seq of longSeqs) {
    if (walkersAdded >= MAX_WALKERS) break;

    const midCol = Math.floor((seq.startCol + seq.endCol) / 2);
    const aboveRow = seq.row - 1;

    // Need open space above and must not be protected/occupied
    if (aboveRow < 0) continue;
    const aboveTile = isTile(newGrid, aboveRow, midCol);
    if (!isEmpty(aboveTile)) continue;
    if (PROTECTED.has(isTile(newGrid, seq.row, midCol))) continue;
    if (nearCritical(aboveRow, midCol, playerStart, goal)) continue;

    newGrid[aboveRow][midCol] = TILE_WALKER;
    changes.push({
      id: `walker_${walkersAdded}`,
      type: 'enemy_walker',
      description: `Added Walker enemy at row ${aboveRow}, col ${midCol} to patrol the long platform (cols ${seq.startCol}–${seq.endCol})`,
      position: { row: aboveRow, col: midCol },
    });
    walkersAdded++;
  }

  // ── 2. Place Z (saw) near death hotspots ────────────────────────────────
  // Group death positions by proximity (within 3 tiles) and pick one per cluster
  const visited = new Set();
  for (const dp of deathPositions) {
    if (sawsAdded >= MAX_SAWS) break;
    const dr = dp.row ?? dp.y ?? 0;
    const dc = dp.col ?? dp.x ?? 0;
    const key = `${Math.round(dr / 3)}_${Math.round(dc / 3)}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Find nearest solid tile below the death position to place saw 1 above platform
    for (let r = dr; r < (grid.length - 1); r++) {
      if (isSolid(isTile(newGrid, r, dc))) {
        const sawRow = r - 1;
        if (sawRow < 0) break;
        if (!isEmpty(isTile(newGrid, sawRow, dc))) break;
        if (nearCritical(sawRow, dc, playerStart, goal)) break;

        newGrid[sawRow][dc] = TILE_SAW;
        changes.push({
          id: `saw_${sawsAdded}`,
          type: 'saw',
          description: `Added Saw blade at row ${sawRow}, col ${dc} — placed at a death hotspot`,
          position: { row: sawRow, col: dc },
        });
        sawsAdded++;
        break;
      }
    }
  }

  // ── 3. Replace isolated platforms (2-3 tiles) with B (crumble) ──────────
  const isolated = findIsolatedPlatforms(newGrid, 2, 3);
  for (const plat of isolated) {
    if (crumblesAdded >= MAX_CRUMBLE_PLATFORMS) break;

    // Check none of the tiles are protected and none are near critical positions
    let safe = true;
    for (let c = plat.startCol; c <= plat.endCol; c++) {
      if (PROTECTED.has(isTile(newGrid, plat.row, c))) { safe = false; break; }
      if (nearCritical(plat.row, c, playerStart, goal)) { safe = false; break; }
    }
    if (!safe) continue;

    for (let c = plat.startCol; c <= plat.endCol; c++) {
      newGrid[plat.row][c] = TILE_CRUMBLE;
    }
    changes.push({
      id: `crumble_${crumblesAdded}`,
      type: 'crumble',
      description: `Converted ${plat.endCol - plat.startCol + 1}-tile platform at row ${plat.row}, cols ${plat.startCol}–${plat.endCol} into crumbling tiles`,
      position: { row: plat.row, col: plat.startCol },
    });
    crumblesAdded++;
  }

  // ── 4. Place J (spring) at the base of tall drop sections ───────────────
  const drops = findTallDrops(newGrid);
  for (const drop of drops) {
    if (springsAdded >= MAX_SPRINGS) break;

    const { platformRow, col } = drop;
    const targetRow = platformRow - 1; // one row above the solid platform tile

    // Prefer to place spring 1-2 tiles to the side so it doesn't block the spot directly
    let placed = false;
    for (const offset of [0, 1, -1, 2, -2]) {
      const tc = col + offset;
      if (tc < 0 || tc >= (newGrid[0] || []).length) continue;
      // Spring sits ON the platform — replace the platform tile one row above
      const tileAbove = isTile(newGrid, targetRow, tc);
      const tileOn    = isTile(newGrid, platformRow, tc);
      if (!isSolid(tileOn)) continue;
      if (!isEmpty(tileAbove)) continue;
      if (PROTECTED.has(tileOn)) continue;
      if (nearCritical(targetRow, tc, playerStart, goal)) continue;

      newGrid[platformRow][tc] = TILE_SPRING;
      changes.push({
        id: `spring_${springsAdded}`,
        type: 'spring',
        description: `Added Spring at row ${platformRow}, col ${tc} at the base of a ${drop.platformRow}-row tall drop section`,
        position: { row: platformRow, col: tc },
      });
      springsAdded++;
      placed = true;
      break;
    }
    if (placed) continue; // don't double-count
  }

  return { newGrid, changes };
}

// ---------------------------------------------------------------------------
// AI-powered path (Anthropic Claude haiku)
// ---------------------------------------------------------------------------
async function applyAI({ grid, width, height, playerStart, goal, deathPositions, telemetry }) {
  // Dynamically try to import the SDK — it may not be installed
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('Anthropic SDK not installed');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt =
    'You are a platformer level designer. Given this level JSON, output a harder version with new tile types. ' +
    'Add W (walker enemy), Z (saw), J (spring), B (crumble) tiles at strategic locations. ' +
    'Return ONLY JSON with shape: { changes: [{id, type, description, position:{row,col}}], new_tiles: [{row, col, tile}], difficulty_estimate: number }';

  const userContent = JSON.stringify({ grid, width, height, playerStart, goal, deathPositions, telemetry });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = message.content?.[0]?.text ?? '';
  // Strip markdown code fences if present
  const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed.new_tiles)) throw new Error('AI response missing new_tiles array');

  const newGrid = cloneGrid(grid);
  for (const { row, col, tile } of parsed.new_tiles) {
    if (row < 0 || row >= newGrid.length) continue;
    if (col < 0 || col >= newGrid[row].length) continue;
    if (PROTECTED.has(isTile(newGrid, row, col))) continue;
    if (nearCritical(row, col, playerStart, goal)) continue;
    newGrid[row][col] = tile;
  }

  return {
    newGrid,
    changes: parsed.changes ?? [],
    difficulty_estimate: parsed.difficulty_estimate ?? 5,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function generateHardMode({ grid, width, height, playerStart, goal, deathPositions = [], telemetry = {} }) {
  let newGrid, changes, difficulty_estimate;

  // Attempt AI path first if API key present
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const aiResult = await applyAI({ grid, width, height, playerStart, goal, deathPositions, telemetry });
      newGrid              = aiResult.newGrid;
      changes              = aiResult.changes;
      difficulty_estimate  = aiResult.difficulty_estimate;
    } catch (err) {
      console.warn('[hardModeEngine] AI path failed, falling back to deterministic:', err.message);
    }
  }

  // Deterministic fallback
  if (!newGrid) {
    const det = applyDeterministic({ grid, width, height, playerStart, goal, deathPositions });
    newGrid  = det.newGrid;
    changes  = det.changes;
    difficulty_estimate = Math.min(10, 3 + changes.length * 1.5);
  }

  const level = {
    data: newGrid,
    width:  width  ?? (newGrid[0] ? newGrid[0].length : 0),
    height: height ?? newGrid.length,
    playerStart: playerStart ?? null,
    goal:        goal        ?? null,
  };

  return { level, changes, difficulty_estimate };
}

module.exports = { generateHardMode };
