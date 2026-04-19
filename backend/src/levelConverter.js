require('dotenv').config();
const fs = require('fs');
const { processLevelWithGemini, COLS, ROWS } = require('./geminiPipeline');

/**
 * Full pipeline: imageBuffer → Gemini 2.5 Flash Vision → validated 2-D binary grid
 *
 * @param {Buffer} imageBuffer  Raw image bytes (JPEG, PNG, etc.)
 * @param {string} [apiKey]     Gemini key — falls back to GEMINI_API_KEY env var
 */
async function processLevelImage(imageBuffer, apiKey) {
  console.log('[1/2] Pre-processing image and calling Gemini 2.0 Flash Vision…');
  const { grid, playerStart, goal, spikes } = await processLevelWithGemini(imageBuffer, apiKey);

  if (playerStart) grid[playerStart.row][playerStart.col] = 'P';
  if (goal)        grid[goal.row][goal.col]               = 'G';
  for (const s of spikes) grid[s.row][s.col] = 'S';

  console.log('[2/2] Validation passed.');
  return {
    width: COLS,
    height: ROWS,
    data: grid,
    playerStart,
    goal,
  };
}

/**
 * Convenience entry point: takes a file path instead of a buffer.
 */
async function convertPhotoToLevel(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return processLevelImage(imageBuffer);
}

module.exports = { convertPhotoToLevel, processLevelImage };
