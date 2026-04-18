require('dotenv').config();
const OpenAI = require('openai');

// K2 Think V2 by MBZUAI — OpenAI-compatible endpoint
const K2_BASE_URL = process.env.K2_API_BASE_URL || 'https://api.k2think.ai/v1';
const K2_MODEL    = process.env.K2_MODEL        || 'MBZUAI-IFM/K2-Think-v2';

/**
 * Build a compact, physics-rich prompt for K2 to reason over.
 */
function buildPrompt(grid, physicsParams) {
  const { gravity, jumpStrength, moveSpeed, tileSize } = physicsParams;

  // Derived kinematic envelope — concrete numbers K2 can reason with
  const tPeak          = jumpStrength / gravity;
  const maxRisePx      = 0.5 * gravity * tPeak * tPeak;
  const tLand          = 2 * tPeak;
  const maxRangePx     = moveSpeed * tLand;
  const maxRiseTiles   = maxRisePx  / tileSize;
  const maxRangeTiles  = maxRangePx / tileSize;

  // Collect key tiles
  const surfaces = [], spikes = [], platforms = [];
  let playerPos = null, goalPos = null;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const cell = grid[r][c];
      if (cell === 'P') playerPos = { x: c, y: r };
      else if (cell === 'G') goalPos = { x: c, y: r };
      else if (cell === 'S') spikes.push({ x: c, y: r });
      else if (cell === 1) {
        const above = r === 0 ? 1 : grid[r - 1][c];
        if (above !== 1) surfaces.push({ x: c, y: r });
        platforms.push({ x: c, y: r });
      }
    }
  }

  return `You are a physics engine. Analyse a 2-D platformer level for solvability.

## Coordinate system
- Origin (0,0) is top-left. x = column (right), y = row (down).

## Physics constants
  gravity       = ${gravity} px/s²
  jump_strength = ${jumpStrength} px/s  (vy₀ = −${jumpStrength}, upward)
  move_speed    = ${moveSpeed} px/s
  tile_size     = ${tileSize} px

## Derived jump envelope
  t_peak       = ${tPeak.toFixed(4)} s
  max_rise     = ${maxRisePx.toFixed(1)} px = ${maxRiseTiles.toFixed(2)} tiles
  t_land       = ${tLand.toFixed(4)} s
  max_range_x  = ${maxRangePx.toFixed(1)} px = ${maxRangeTiles.toFixed(2)} tiles

## Level elements
  Player spawn (P): ${playerPos ? JSON.stringify(playerPos) : 'MISSING'}
  Goal (G):         ${goalPos   ? JSON.stringify(goalPos)   : 'MISSING'}
  Spikes (S):       ${JSON.stringify(spikes)}
  Platform surfaces (standable top edges): ${JSON.stringify(surfaces)}
  All solid tiles:  ${JSON.stringify(platforms)}

## Task
1. If P or G is missing → unsolvable.
2. For each pair of surface tiles, check if a jump from A to B is physically possible:
     a. Δx = |xB − xA|, Δy = yA − yB (positive = B is higher).
     b. Rising (Δy > 0): require max_rise ≥ Δy × tile_size.
     c. Falling (Δy ≤ 0): solve flight time t from kinematics, verify v_h·t ≥ Δx × tile_size.
     d. No solid tile blocks the arc.
3. BFS/DFS reachability from P to G using the jump graph.
4. List bottlenecks — gaps impossible to cross.

## Required output
Respond ONLY with valid JSON (no markdown, no extra text):
{
  "solvable": <boolean>,
  "proof": "<concise path or reason for failure>",
  "bottlenecks": [
    { "x": <col>, "y": <row>, "reason": "<why this jump fails>" }
  ]
}`;
}

/**
 * K2 Think V2 streams reasoning inside <think>…</think> tags embedded in the
 * content delta. This state machine splits the stream into thinking vs answer
 * chunks and yields them separately.
 *
 * Yields: { type: 'thinking'|'answer'|'done', text?, result? }
 */
async function* streamK2Verification(prompt) {
  const apiKey = process.env.K2_API_KEY;
  if (!apiKey) throw new Error('K2_API_KEY is not set in environment.');

  const client = new OpenAI({ apiKey, baseURL: K2_BASE_URL });

  const stream = await client.chat.completions.create({
    model: K2_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a JSON-only responder. Your entire response must be a single valid JSON object. Do not write any explanation, reasoning, or text outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    stream: true,
    temperature: 0.1,
    max_tokens: 16384,
    extra_body: {
      chat_template_kwargs: { reasoning_effort: 'high' },
    },
  });

  let rawBuffer  = '';
  let answerBuffer = '';

  // State machine: track whether the stream cursor is inside <think>…</think>
  let inThink  = false;
  let holdover = '';   // partial tag accumulation

  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;

    rawBuffer += text;
    holdover  += text;

    // Process holdover character-by-character to detect tag boundaries
    let out = holdover;
    holdover = '';

    const OPEN_TAG  = '<think>';
    const CLOSE_TAG = '</think>';

    let i = 0;
    while (i < out.length) {
      if (!inThink) {
        const openIdx = out.indexOf(OPEN_TAG, i);
        if (openIdx === -1) {
          const tail = out.slice(i);
          const partialMatch = longestPrefixSuffix(tail, OPEN_TAG);
          if (partialMatch > 0) {
            holdover = tail.slice(tail.length - partialMatch);
            const emit = tail.slice(0, tail.length - partialMatch);
            if (emit) yield { type: 'answer', text: emit };
          } else {
            yield { type: 'answer', text: tail };
          }
          i = out.length;
        } else {
          const before = out.slice(i, openIdx);
          if (before) yield { type: 'answer', text: before };
          inThink = true;
          i = openIdx + OPEN_TAG.length;
        }
      } else {
        const closeIdx = out.indexOf(CLOSE_TAG, i);
        if (closeIdx === -1) {
          const tail = out.slice(i);
          const partialMatch = longestPrefixSuffix(tail, CLOSE_TAG);
          if (partialMatch > 0) {
            holdover = tail.slice(tail.length - partialMatch);
            const emit = tail.slice(0, tail.length - partialMatch);
            if (emit) yield { type: 'thinking', text: emit };
          } else {
            yield { type: 'thinking', text: tail };
          }
          i = out.length;
        } else {
          const thinkText = out.slice(i, closeIdx);
          if (thinkText) yield { type: 'thinking', text: thinkText };
          inThink = false;
          i = closeIdx + CLOSE_TAG.length;
        }
      }
    }
  }

  // Flush any remaining holdover
  if (holdover) { yield { type: 'answer', text: holdover }; rawBuffer += holdover; }

  // Extract JSON from everything after the last </think>
  const CLOSE_TAG = '</think>';
  const closePos  = rawBuffer.lastIndexOf(CLOSE_TAG);
  answerBuffer    = closePos !== -1 ? rawBuffer.slice(closePos + CLOSE_TAG.length) : rawBuffer;

  // Parse the JSON result from the answer
  let result;
  try {
    const stripped = answerBuffer
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = stripped.indexOf('{');
    if (start === -1) throw new Error('No JSON object in response');
    // Walk forward to find the closing brace of the outermost object
    let depth = 0, end = -1;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Unterminated JSON object');
    result = JSON.parse(stripped.slice(start, end + 1));
    if (typeof result.solvable !== 'boolean') throw new Error('"solvable" field missing');
  } catch (e) {
    result = {
      solvable: false,
      proof: `K2 response could not be parsed: ${e.message}. Raw: ${answerBuffer.slice(0, 300)}`,
      bottlenecks: [],
    };
  }

  yield { type: 'done', result };
}

/**
 * Returns the length of the longest prefix of `pattern` that is a suffix of `text`.
 * Used to detect partial tag matches at chunk boundaries.
 */
function longestPrefixSuffix(text, pattern) {
  for (let len = Math.min(text.length, pattern.length - 1); len > 0; len--) {
    if (text.endsWith(pattern.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Public API: verify whether a level grid is solvable using K2 Think V2 (MBZUAI).
 *
 * @param {Array<Array<number|string>>} grid
 * @param {{ gravity, jumpStrength, moveSpeed, tileSize }} physicsParams
 * @returns {AsyncGenerator}  yields { type, text?, result? }
 */
async function* verifyLevelSolvability(grid, physicsParams) {
  const params = {
    gravity:      physicsParams.gravity      ?? 1800,
    jumpStrength: physicsParams.jumpStrength ?? 600,
    moveSpeed:    physicsParams.moveSpeed    ?? 280,
    tileSize:     physicsParams.tileSize     ?? 32,
  };
  yield* streamK2Verification(buildPrompt(grid, params));
}

module.exports = { verifyLevelSolvability };
