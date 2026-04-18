require('dotenv').config();
const OpenAI = require('openai');

const K2_BASE_URL = process.env.K2_API_BASE_URL || 'https://api.k2think.ai/v1';
const K2_MODEL    = process.env.K2_MODEL        || 'MBZUAI-IFM/K2-Think-v2';

// ---------------------------------------------------------------------------

/**
 * Convert grid to a compact level description for K2.
 */
function buildPrompt(grid, physicsParams) {
  const { gravity, jumpStrength, moveSpeed, tileSize } = physicsParams;

  const surfaces = [], spikes = [];
  let playerPos = null, goalPos = null;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const cell = grid[r][c];
      if      (cell === 'P') playerPos = { col: c, row: r };
      else if (cell === 'G') goalPos   = { col: c, row: r };
      else if (cell === 'S') spikes.push({ col: c, row: r });
      else if (cell === 1) {
        const above = r === 0 ? 1 : grid[r - 1][c];
        if (above !== 1) surfaces.push({ col: c, row: r });
      }
    }
  }

  if (!playerPos || !goalPos) {
    return null; // signal missing P/G
  }

  // Group surface tiles into platform spans
  const sorted = [...surfaces].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  const platforms = [];
  for (const t of sorted) {
    const last = platforms[platforms.length - 1];
    if (last && last.row === t.row && last.maxCol + 1 >= t.col) {
      last.maxCol = Math.max(last.maxCol, t.col);
    } else {
      platforms.push({ id: platforms.length, row: t.row, minCol: t.col, maxCol: t.col });
    }
  }

  const platformList = platforms
    .map(p => `  P${p.id}: row ${p.row}, cols ${p.minCol}–${p.maxCol}`)
    .join('\n');

  const spikeList = spikes.length
    ? spikes.map(s => `(col ${s.col}, row ${s.row})`).join(', ')
    : 'none';

  const diagSpeed = (moveSpeed / Math.SQRT2).toFixed(2);

  return `You are checking whether a player character can make it from the START to the FINISH in a 2-D jump-and-run game. Use simple, fun words a 10-year-old would understand.

HOW THE CHARACTER MOVES:
  - Gravity pulls the character DOWN at ${gravity} px every second squared.
  - When the character jumps, they shoot UP at ${jumpStrength} px/s.
  - When running left or right on flat ground, they move at ${moveSpeed} px/s.
  - IMPORTANT — diagonal movement rule: when the character moves sideways AND up/down at the same time (like jumping across a gap), the total speed must stay the same size. So the sideways speed becomes ${diagSpeed} px/s (= ${moveSpeed} / √2) and the up/down speed becomes ${diagSpeed} px/s (= ${jumpStrength} / √2). Think of it like a pizza slice — if you keep the whole slice the same size but tilt it, each side gets shorter.
  - Each tile is ${tileSize} pixels wide and tall.
  - Jump path formula: sideways distance x(t) = ${diagSpeed} × t, up/down position y(t) = −${diagSpeed} × t + 0.5 × ${gravity} × t²  (positive y = going down).

THE LEVEL (column 0 = left side, row 0 = top):
  START (player): col ${playerPos.col}, row ${playerPos.row}
  FINISH (goal):  col ${goalPos.col}, row ${goalPos.row}
  Danger spikes:  ${spikeList}

FLOORS THE CHARACTER CAN STAND ON:
${platformList}

YOUR JOB:
1. Figure out which floor the character starts on and which floor the finish is on.
2. Check every possible jump between floors using the movement rules above (remember to use the diagonal speed ${diagSpeed} px/s for both sideways and up/down when jumping across a gap).
3. See if there is any path of jumps that gets the character from the start floor to the finish floor.
4. If they can make it, list the floors in order.
5. If they cannot make it, say where they get stuck.

Return ONLY this JSON object — no words outside it:
{
  "solvable": <true|false>,
  "proof": "<one sentence explaining why, using simple words>",
  "kid_summary": "<one fun, encouraging sentence ≤20 words that a 10-year-old would love to read>",
  "bottlenecks": [{ "x": <col>, "y": <row>, "reason": "<fun kid-friendly reason why they get stuck here>" }],
  "solutionPath": [{ "col": <col>, "row": <row> }] or null
}`;
}

// ---------------------------------------------------------------------------

/**
 * State-machine stream parser for <think>…</think> tags.
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
        content: 'You are a JSON-only responder. Your entire response must be a single valid JSON object. Do not write any explanation or text outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    stream: true,
    temperature: 0.1,
    max_tokens: 4000,
    extra_body: {
      chat_template_kwargs: { reasoning_effort: 'high' },
    },
  });

  let rawBuffer = '';
  let inThink   = false;
  let holdover  = '';

  const OPEN_TAG  = '<think>';
  const CLOSE_TAG = '</think>';

  for await (const chunk of stream) {
    const reasoningContent = chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningContent) yield { type: 'thinking', text: reasoningContent };

    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;

    rawBuffer += text;
    holdover  += text;

    let out  = holdover;
    holdover = '';

    let i = 0;
    while (i < out.length) {
      if (!inThink) {
        const openIdx = out.indexOf(OPEN_TAG, i);
        if (openIdx === -1) {
          const tail = out.slice(i);
          const pm = longestPrefixSuffix(tail, OPEN_TAG);
          if (pm > 0) {
            holdover = tail.slice(tail.length - pm);
            const emit = tail.slice(0, tail.length - pm);
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
          const pm = longestPrefixSuffix(tail, CLOSE_TAG);
          if (pm > 0) {
            holdover = tail.slice(tail.length - pm);
            const emit = tail.slice(0, tail.length - pm);
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

  if (holdover) { yield { type: 'answer', text: holdover }; rawBuffer += holdover; }

  // Extract JSON from after the last </think>
  const closePos   = rawBuffer.lastIndexOf(CLOSE_TAG);
  const answerBuf  = closePos !== -1 ? rawBuffer.slice(closePos + CLOSE_TAG.length) : rawBuffer;

  let result;
  try {
    const stripped = answerBuf.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = stripped.indexOf('{');
    if (start === -1) throw new Error('No JSON object in response');
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
      proof: `K2 response could not be parsed: ${e.message}. Raw: ${answerBuf.slice(0, 300)}`,
      kid_summary: 'Hmm, I got confused — try again!',
      bottlenecks: [],
      solutionPath: null,
    };
  }

  yield { type: 'done', result };
}

function longestPrefixSuffix(text, pattern) {
  for (let len = Math.min(text.length, pattern.length - 1); len > 0; len--) {
    if (text.endsWith(pattern.slice(0, len))) return len;
  }
  return 0;
}

// ---------------------------------------------------------------------------

/**
 * Public API: verify whether a level grid is solvable using K2 Think V2.
 * @returns {AsyncGenerator} yields { type, text?, result? }
 */
async function* verifyLevelSolvability(grid, physicsParams) {
  const params = {
    gravity:      physicsParams.gravity      ?? 1800,
    jumpStrength: physicsParams.jumpStrength ?? 600,
    moveSpeed:    physicsParams.moveSpeed    ?? 280,
    tileSize:     physicsParams.tileSize     ?? 32,
  };

  const prompt = buildPrompt(grid, params);
  if (!prompt) {
    yield { type: 'done', result: {
      solvable: false,
      proof: 'Player spawn (P) or goal (G) is missing from the level.',
      kid_summary: 'You need both a start spot and a goal to play!',
      bottlenecks: [],
      solutionPath: null,
    }};
    return;
  }

  yield* streamK2Verification(prompt);
}

module.exports = { verifyLevelSolvability };
