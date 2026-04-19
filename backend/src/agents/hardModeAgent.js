'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const Anthropic = require('@anthropic-ai/sdk');
const { z }     = require('zod');

const MODEL = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';

// Tiles the agent must never overwrite
const PROTECTED = new Set(['P', 'G']);

// ---------------------------------------------------------------------------
// Compact output schema — patches only, no full grid in response
// ---------------------------------------------------------------------------
const HardModeOutputSchema = z.object({
  patches: z.array(z.object({
    r: z.number().int(),
    c: z.number().int(),
    t: z.string(),
  })),
  changes: z.array(z.object({
    type:   z.string(),
    r:      z.number().int(),
    c:      z.number().int(),
    reason: z.string(),
  })),
  d: z.number().min(1).max(10),
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const DIFFICULTY_COUNTS = { light: '2-3', medium: '3-5', brutal: '5-7' };
const DIFFICULTY_D      = { light: '4',   medium: '6',   brutal: '8'   };

function buildPrompt(difficulty, rows, cols, gridStr, telemetrySummary) {
  const count = DIFFICULTY_COUNTS[difficulty] || DIFFICULTY_COUNTS.medium;
  const dEx   = DIFFICULTY_D[difficulty]      || DIFFICULTY_D.medium;
  return `You are a platformer level designer. Add hazards to make this level harder based on player deaths.

TILE LEGEND: 0=empty 1=solid S=spike Z=saw W=walker(enemy) B=crumble F=flyer C=coin P=spawn G=goal
RULES: Never change P or G. W must go on an empty cell with a solid tile directly below it. No gap >4 tiles.

GRID ${rows}x${cols}:
${gridStr}

PLAYER DATA: ${telemetrySummary}

Add ${count} hazard tiles targeting death spots.

Return ONLY a JSON object using ACTUAL row/col integers from the grid:
{"patches":[{"r":5,"c":12,"t":"W"},{"r":3,"c":7,"t":"Z"}],"changes":[{"type":"added_enemy_walker","r":5,"c":12,"reason":"Walker blocks the path where player died twice"},{"type":"added_saw","r":3,"c":7,"reason":"Saw forces player to time the jump"}],"d":${dEx}}`;
}

// ---------------------------------------------------------------------------
// Telemetry summary — compact
// ---------------------------------------------------------------------------
function summarizeTelemetry(telemetry) {
  const t = telemetry || {};
  const deathsByZone = {};
  for (const dp of (t.deathPoints || [])) {
    const key = `(${dp.col},${dp.row})`;
    deathsByZone[key] = (deathsByZone[key] || 0) + 1;
  }
  const hotspots = Object.entries(deathsByZone)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}x${v}`);

  const elapsed = t.endTime && t.startTime ? ((t.endTime - t.startTime) / 1000).toFixed(1) : '?';
  return `deaths=${t.deaths||0} hotspots=${hotspots.join(' ')||'none'} jumps=${t.jumps||0} coins=${t.coinsCollected||0}/${t.coinsTotal||0} time=${elapsed}s goal=${t.reachedGoal?'yes':'no'}`;
}

// ---------------------------------------------------------------------------
// Invoke Anthropic with retries
// ---------------------------------------------------------------------------
async function invokeWithRetry(client, prompt, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      });
      const raw = message.content[0]?.text ?? '';
      console.log(`[hardModeAgent] raw length=${raw.length} preview="${raw.slice(0, 120).replace(/\n/g, ' ')}"`);
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response');
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return HardModeOutputSchema.parse(parsed);
    } catch (err) {
      lastErr = err;
      if (err.status === 429 || err.message?.includes('rate') || err.message?.includes('quota')) {
        console.warn('[hardModeAgent] rate-limit hit — aborting retries');
        break;
      }
      if (attempt < retries) {
        console.warn(`[hardModeAgent] attempt ${attempt + 1} failed: ${err.message} — retrying`);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function invoke({ level, telemetry, difficulty = 'medium' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment.');

  const client = new Anthropic.default({ apiKey });
  const rows   = level.height || level.data.length;
  const cols   = level.width  || (level.data[0]?.length ?? 0);
  const prompt = buildPrompt(difficulty, rows, cols, JSON.stringify(level.data), summarizeTelemetry(telemetry));

  const output = await invokeWithRetry(client, prompt, 2);

  // Apply patches to a cloned grid, respecting PROTECTED tiles
  const newGrid = level.data.map(r => r.slice());
  for (const { r, c, t } of output.patches) {
    if (r < 0 || r >= newGrid.length || c < 0 || c >= (newGrid[0]?.length ?? 0)) continue;
    if (PROTECTED.has(String(newGrid[r][c]))) continue;
    newGrid[r][c] = t;
  }

  return {
    level: {
      data:        newGrid,
      width:       cols,
      height:      rows,
      playerStart: level.playerStart || null,
      goal:        level.goal        || null,
    },
    changes: output.changes.map(ch => ({
      type:     ch.type,
      location: { x: ch.c, y: ch.r },
      reason:   ch.reason,
    })),
    difficulty_estimate: output.d,
  };
}

module.exports = { invoke };
