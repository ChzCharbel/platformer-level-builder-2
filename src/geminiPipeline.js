require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const MODEL = 'gemini-2.5-flash-lite';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a precise image-to-grid converter for a 2-D platformer level editor.
Output ONLY a valid JSON object — no explanation, no markdown, no extra text.

The image shows hand-drawn grid paper with a ${COLS}-column × ${ROWS}-row cell grid (col 0 = left, row 0 = top).

Detect three types of markings:
1. Filled/shaded rectangular platform regions — described as bounding boxes.
2. A circle marker — the player spawn point (only one expected).
3. A star marker — the level goal (only one expected).

Required output:
{
  "shapes": [ { "row_start": <r>, "row_end": <r>, "col_start": <c>, "col_end": <c> }, ... ],
  "playerStart": { "row": <r>, "col": <c> } or null,
  "goal": { "row": <r>, "col": <c> } or null
}

Rules:
- "shapes" lists only solid shaded/pencilled platform rectangles. Grid lines are NOT fills.
- "playerStart" is the single cell containing a drawn circle (O shape). Set to null if none.
- "goal" is the single cell containing a drawn star (★ shape). Set to null if none.
- If no shapes are filled, return { "shapes": [], "playerStart": null, "goal": null }.`;

const USER_PROMPT = `Examine the image and identify all markings on the grid.

Step 1 — Platforms: find every shaded or filled rectangular region. Treat each visually disconnected filled region as its own separate shape (separated by even one empty row/column → two shapes). For each, record exact 0-indexed row_start, row_end, col_start, col_end within the ${COLS}×${ROWS} grid.

Step 2 — Player spawn: find the cell containing a circle (O) marker. Record its row and col (0-indexed). If none, set playerStart to null.

Step 3 — Goal: find the cell containing a star (★) marker. Record its row and col (0-indexed). If none, set goal to null.

Return:
{
  "shapes": [ { "row_start": ..., "row_end": ..., "col_start": ..., "col_end": ... }, ... ],
  "playerStart": { "row": ..., "col": ... } or null,
  "goal": { "row": ..., "col": ... } or null
}`;

async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer)
    .grayscale()
    .normalise()
    .linear(1.8, -40)
    .resize(1920, null, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function extractJSON(text) {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Convert shape bounding boxes into a ROWS×COLS binary grid.
 */
function shapesToGrid(shapes) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (const s of shapes) {
    const r0 = Math.max(0, s.row_start);
    const r1 = Math.min(ROWS - 1, s.row_end);
    const c0 = Math.max(0, s.col_start);
    const c1 = Math.min(COLS - 1, s.col_end);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        grid[r][c] = 1;
      }
    }
  }
  return grid;
}

/**
 * Convert an image buffer to a ROWS×COLS binary level grid using Gemini 2.5 Flash.
 * The model outputs shape bounding boxes; the grid is built programmatically.
 */
async function processLevelWithGemini(imageBuffer, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No Gemini API key. Set GEMINI_API_KEY in your environment.');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 65536,
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

    const text = result.response.text();
    console.log(`[debug attempt ${attempt}] Response preview:`, text.slice(0, 300));

    try {
      const obj = extractJSON(text);
      if (!Array.isArray(obj.shapes)) throw new Error('"shapes" is not an array');
      const grid = shapesToGrid(obj.shapes);
      const playerStart = obj.playerStart || null;
      const goal = obj.goal || null;
      return { grid, playerStart, goal };
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGemini, COLS, ROWS };
