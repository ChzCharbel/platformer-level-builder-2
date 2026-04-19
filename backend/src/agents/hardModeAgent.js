'use strict';

const { ChatOpenAI } = require('@langchain/openai');
const { z }          = require('zod');

// ---------------------------------------------------------------------------
// Zod schema for the structured output from Kimi K2
// ---------------------------------------------------------------------------
const ChangeSchema = z.object({
  id:          z.string(),
  type:        z.string(),
  description: z.string(),
  position:    z.object({ row: z.number().int(), col: z.number().int() }).optional(),
});

const HardModeOutputSchema = z.object({
  new_tiles: z.array(z.object({
    row:  z.number().int(),
    col:  z.number().int(),
    tile: z.union([z.number(), z.string()]),
  })),
  changes:             z.array(ChangeSchema),
  difficulty_estimate: z.number().min(1).max(10),
});

// Tiles the agent must never overwrite
const PROTECTED = new Set(['P', 'G']);

// ---------------------------------------------------------------------------
// System prompt (parameterized by difficulty)
// ---------------------------------------------------------------------------
const DIFFICULTY_INSTRUCTIONS = {
  light: `Target a MILD difficulty increase (1.3x). Add 2-3 changes total.
- Prefer walkers on wide platforms or a couple extra spikes at death hotspots.
- Do NOT add saws, nightmare hazard chains, or crumble-only paths.
- difficulty_estimate should be 4-6.`,
  medium: `Target a MODERATE difficulty increase (2x). Add 4-6 changes total.
- Mix walkers, crumble platforms, and a saw or two.
- Use telemetry to target weak spots.
- difficulty_estimate should be 6-8.`,
  brutal: `Target a BRUTAL difficulty increase (3x+). Add 7-10 changes total.
- Add saws at chokepoints, walkers on every major platform, crumble tiles on key paths, flying enemies over gaps.
- Make the player use every skill they have.
- difficulty_estimate should be 8-10.`,
};

function buildSystemPrompt(difficulty) {
  const diffInstr = DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.medium;
  return `You are a platformer level designer specializing in hard mode remixes.
Given a level grid and player telemetry, return a harder remix of the level.

DIFFICULTY LEVEL: ${difficulty.toUpperCase()}
${diffInstr}

Rules:
- Preserve spawn (P) and goal (G) locations exactly. Never place tiles on them.
- Do not make the level unwinnable — always keep a clear path from P to G.
- Walker (W) tiles must be placed on a row ABOVE a solid platform so they have ground to walk on. Do not place W on the floor row or floating in air.
- Use telemetry to target the player's weaknesses:
  - Many spike deaths in one area: add spikes or saws near those coordinates.
  - Player rushed (low idle time): add timing-based enemies (W=walker, F=flyer).
  - Player collected every coin: place coins in harder-to-reach spots.
  - High death count overall: add crumble (B) platforms on key paths.
- Available tile types to add: W (walker enemy), F (flying enemy), Z (saw), J (spring), B (crumble platform), S (spike).
- Tile types you must NOT touch: P (spawn), G (goal).
- Return ONLY valid JSON, no prose, no markdown code fences.

Output JSON shape (strict):
{
  "new_tiles": [{ "row": <int>, "col": <int>, "tile": <string or 0> }],
  "changes": [{ "id": <string>, "type": <string>, "description": <string>, "position": { "row": <int>, "col": <int> } }],
  "difficulty_estimate": <number 1-10>
}

Make each change description specific and reference the telemetry. Example: "Added walker at (col 12, row 8) because player died there 3 times." Do not use em dashes in descriptions.`;
}

// ---------------------------------------------------------------------------
// Strip prose/code-fence wrappers from model output before JSON.parse
// ---------------------------------------------------------------------------
function stripToJson(raw) {
  const stripped = raw.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return stripped.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Build a concise telemetry summary for the prompt
// ---------------------------------------------------------------------------
function summarizeTelemetry(telemetry) {
  const t = telemetry || {};
  const deathsByZone = {};
  for (const dp of (t.deathPoints || [])) {
    const key = `col ${dp.col}, row ${dp.row}`;
    deathsByZone[key] = (deathsByZone[key] || 0) + 1;
  }
  const hotspots = Object.entries(deathsByZone)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} (${v} death${v > 1 ? 's' : ''})`);

  const elapsed = t.endTime && t.startTime ? ((t.endTime - t.startTime) / 1000).toFixed(1) : 'unknown';

  return [
    `Total deaths: ${t.deaths || 0}`,
    `Death hotspots: ${hotspots.length ? hotspots.join(', ') : 'none'}`,
    `Jumps: ${t.jumps || 0}`,
    `Coins collected: ${t.coinsCollected || 0} / ${t.coinsTotal || 0}`,
    `Idle time: ${(t.idleTime || 0).toFixed(1)}s`,
    `Time played: ${elapsed}s`,
    `Reached goal: ${t.reachedGoal ? 'yes' : 'no'}`,
    `Path samples (col,row): ${(t.pathSampled || []).slice(0, 20).map(p => `(${p.col},${p.row})`).join(' ')}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Invoke with up to 2 retries, stripping fences and validating schema each time
// ---------------------------------------------------------------------------
async function invokeWithRetry(model, messages, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // withStructuredOutput may not be supported by all OpenAI-compat endpoints.
      // Use raw invoke + manual parse for maximum compatibility.
      const result = await model.invoke(messages);
      const raw    = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      const jsonStr = stripToJson(raw);
      const parsed  = JSON.parse(jsonStr);
      return HardModeOutputSchema.parse(parsed);
    } catch (err) {
      lastErr = err;
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
  const model = new ChatOpenAI({
    apiKey: process.env.LLM_API_KEY || process.env.K2_API_KEY,
    model:  process.env.LLM_MODEL   || 'kimi-k2-0905-preview',
    configuration: {
      baseURL: process.env.LLM_BASE_URL || 'https://api.moonshot.ai/v1',
    },
    temperature: 0.7,
    maxTokens:   2048,
  });

  const telemetrySummary = summarizeTelemetry(telemetry);
  const gridStr = JSON.stringify(level.data);

  const messages = [
    { role: 'system', content: buildSystemPrompt(difficulty) },
    {
      role: 'user',
      content: `Level grid (${level.height || level.data.length} rows x ${level.width || (level.data[0]?.length ?? 0)} cols):\n${gridStr}\n\nPlayer telemetry:\n${telemetrySummary}\n\nRemix this level to be harder, targeting the weaknesses above.`,
    },
  ];

  const output = await invokeWithRetry(model, messages, 2);

  // Apply new tiles to a cloned grid
  const newGrid = level.data.map(r => r.slice());
  for (const { row, col, tile } of output.new_tiles) {
    if (row < 0 || row >= newGrid.length) continue;
    if (col < 0 || col >= (newGrid[0]?.length ?? 0)) continue;
    if (PROTECTED.has(String(newGrid[row][col]))) continue;
    newGrid[row][col] = tile;
  }

  return {
    level: {
      data:        newGrid,
      width:       level.width  || (newGrid[0]?.length ?? 0),
      height:      level.height || newGrid.length,
      playerStart: level.playerStart || null,
      goal:        level.goal        || null,
    },
    changes:             output.changes,
    difficulty_estimate: output.difficulty_estimate,
  };
}

module.exports = { invoke };
