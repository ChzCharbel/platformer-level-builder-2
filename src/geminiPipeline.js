require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const MODEL = 'gemini-3-flash-preview';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a pixel-perfect grid transcription engine. Your sole job is to convert a photo of a hand-drawn level on grid paper into a precise JSON description using exact grid cell indices.

THE GRID:
- The drawable area of the paper is divided into exactly ${COLS} columns (0–${COLS - 1}, left→right) and ${ROWS} rows (0–${ROWS - 1}, top→bottom).
- Each printed grid square on the paper = exactly one cell.
- Count cells by following the printed grid lines — do not estimate positions.

WHAT TO IGNORE (never include in output):
- Three circular punch holes along one edge → they are paper features, NOT player markers.
- The vertical margin line (red or blue) near one edge → marks the boundary, not content.
- The printed grid lines themselves → guides only, not fills.
- Shadows, wrinkles, table surface, anything outside the paper boundary.
- Any mark smaller than half a cell or clearly accidental.

WHAT TO DETECT (deliberate hand-drawn marks only):
1. PLATFORMS — solid filled/shaded rectangular regions.
   - A cell is "filled" only if at least half of it is covered by deliberate pencil/pen marks.
   - Group contiguous filled cells into rectangular bounding boxes.
   - Output: { "rowStart": r0, "rowEnd": r1, "colStart": c0, "colEnd": c1 } (all inclusive, 0-indexed).

2. PLAYER SPAWN — a hand-drawn circle (O) inside the grid. NOT a punch hole.
   - Output: { "row": r, "col": c } of the cell whose center the circle is in.

3. GOAL — a hand-drawn star (★) inside the grid.
   - Output: { "row": r, "col": c } of the cell whose center the star is in.

4. SPIKES — hand-drawn triangles (△ or ▲) inside the grid, one per cell.
   - Output: { "row": r, "col": c } for each triangle's cell.

PRECISION RULES:
- Use exact integer cell indices — no fractions, no decimals.
- If a platform spans rows 5–7 and columns 10–19, output rowStart:5 rowEnd:7 colStart:10 colEnd:19.
- When a region is ambiguous (could be 3 or 4 cells wide), count the grid lines it crosses.
- Never expand a shape beyond what is clearly drawn. Under-reporting is better than over-reporting.

OUTPUT — return ONLY this JSON, no other text:
{
  "platforms": [ { "rowStart": <int>, "rowEnd": <int>, "colStart": <int>, "colEnd": <int> } ],
  "playerStart": { "row": <int>, "col": <int> } or null,
  "goal": { "row": <int>, "col": <int> } or null,
  "spikes": [ { "row": <int>, "col": <int> } ]
}`;

const USER_PROMPT = `Carefully examine the grid paper image and transcribe all hand-drawn content into the JSON format.

STEP 0 — Orient yourself:
  - Find the paper boundary. Everything outside is background — ignore it.
  - Find the three punch holes (circles on one edge) and the margin line. These are paper features — ignore them.
  - The drawable grid starts just past the margin line. Row 0 is the topmost grid row; col 0 is the leftmost grid column after the margin.

STEP 1 — Scan for platforms (row by row):
  - Go through rows 0 to ${ROWS - 1} one at a time.
  - For each row, identify which columns contain deliberate fill marks (at least 50% of the cell shaded).
  - Group filled cells in the same row into horizontal runs.
  - Then group runs that are vertically contiguous and horizontally aligned into rectangular platforms.
  - For each platform, record the exact rowStart, rowEnd, colStart, colEnd (all inclusive, 0-indexed).
  - Double-check by counting: "this platform is X cells tall × Y cells wide."

STEP 2 — Find the player spawn circle:
  - Look for a hand-drawn circle (O shape) anywhere in the drawable area.
  - Punch holes are perfect circles on one edge of the paper — they are NOT this.
  - Record the row and column of the cell containing the circle's center.

STEP 3 — Find the goal star:
  - Look for a hand-drawn star (★ or asterisk-like shape) in the drawable area.
  - Record the row and column of the cell containing the star's center.

STEP 4 — Find spike triangles:
  - Look for hand-drawn triangles (△ or ▲) in the drawable area.
  - Record the row and column of each triangle's cell.

Return ONLY the JSON — no explanation, no markdown, no extra text:
{
  "platforms": [ { "rowStart": ..., "rowEnd": ..., "colStart": ..., "colEnd": ... } ],
  "playerStart": { "row": ..., "col": ... } or null,
  "goal": { "row": ..., "col": ... } or null,
  "spikes": [ { "row": ..., "col": ... } ]
}`;

async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer)
    .grayscale()
    .normalise()
    .linear(1.4, -20)
    .resize(1920, null, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 95 })
    .toBuffer();
}

function extractJSON(text) {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '');

  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');

  let depth = 0, end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('Unterminated JSON object in response');

  const parsed = JSON.parse(stripped.slice(start, end + 1));

  if (!Array.isArray(parsed.platforms))
    throw new Error('"platforms" must be an array');

  for (const p of parsed.platforms) {
    for (const k of ['rowStart', 'rowEnd', 'colStart', 'colEnd']) {
      if (!Number.isInteger(p[k]) || p[k] < 0)
        throw new Error(`Platform has invalid "${k}": ${p[k]}`);
    }
    if (p.rowStart > p.rowEnd) throw new Error(`Platform rowStart > rowEnd`);
    if (p.colStart > p.colEnd) throw new Error(`Platform colStart > colEnd`);
  }

  const checkCell = (obj, name) => {
    if (obj == null) return;
    if (!Number.isInteger(obj.row) || !Number.isInteger(obj.col) || obj.row < 0 || obj.col < 0)
      throw new Error(`"${name}" must have integer row and col`);
  };
  checkCell(parsed.playerStart, 'playerStart');
  checkCell(parsed.goal, 'goal');
  if (Array.isArray(parsed.spikes)) parsed.spikes.forEach(s => checkCell(s, 'spike'));

  return parsed;
}

function platformsToGrid(platforms) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (const p of platforms) {
    const r0 = Math.max(0, p.rowStart);
    const r1 = Math.min(ROWS - 1, p.rowEnd);
    const c0 = Math.max(0, p.colStart);
    const c1 = Math.min(COLS - 1, p.colEnd);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        grid[r][c] = 1;
  }
  return grid;
}

function clampCell(cell) {
  if (!cell) return null;
  return {
    row: Math.min(ROWS - 1, Math.max(0, cell.row)),
    col: Math.min(COLS - 1, Math.max(0, cell.col)),
  };
}

function extractResponseText(response) {
  let text = '';
  let thoughtSignature = null;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.thought) {
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
    } else if (typeof part.text === 'string') {
      text += part.text;
    }
  }

  if (!text) {
    try { text = response.text(); } catch { /* ignore */ }
  }

  return { text, thoughtSignature };
}

async function processLevelWithGemini(imageBuffer, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No Gemini API key. Set GEMINI_API_KEY in your environment.');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
    },
  });

  const processedBuffer = await preprocessImage(imageBuffer);
  const base64 = processedBuffer.toString('base64');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) console.warn(`[retry ${attempt}/${MAX_RETRIES}] Previous attempt failed: ${lastError.message}`);

    const result = await model.generateContent([
      { text: USER_PROMPT },
      { inlineData: { mimeType: 'image/jpeg', data: base64 } },
    ]);

    const { text, thoughtSignature } = extractResponseText(result.response);
    console.log(`[debug attempt ${attempt}] Response preview:`, text.slice(0, 300));

    try {
      const obj         = extractJSON(text);
      const grid        = platformsToGrid(obj.platforms);
      const playerStart = clampCell(obj.playerStart);
      const goal        = clampCell(obj.goal);
      const spikes      = Array.isArray(obj.spikes) ? obj.spikes.map(clampCell).filter(Boolean) : [];
      return { grid, playerStart, goal, spikes, thoughtSignature };
    } catch (e) {
      lastError = e;
      console.warn(`[debug attempt ${attempt}] Parse error: ${e.message}`);
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGemini, COLS, ROWS };
