const { GRID_WIDTH, GRID_HEIGHT } = require('./config');

/**
 * Extract the first JSON array from a raw GPT response string.
 * GPT sometimes wraps output in markdown code fences or adds prose.
 */
function extractJson(rawText) {
  // Strip markdown code fences if present
  const stripped = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Grab the outermost [ ... ] block
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in model response');
  }
  return stripped.slice(start, end + 1);
}

/**
 * Validate that `grid` is a GRID_HEIGHT × GRID_WIDTH array of 0/1 values.
 * Throws a descriptive error if anything is wrong.
 */
function validateGrid(grid) {
  if (!Array.isArray(grid)) {
    throw new Error(`Grid must be an array, got ${typeof grid}`);
  }
  if (grid.length !== GRID_HEIGHT) {
    throw new Error(`Expected ${GRID_HEIGHT} rows, got ${grid.length}`);
  }
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) {
      throw new Error(`Row ${r} is not an array`);
    }
    if (row.length !== GRID_WIDTH) {
      throw new Error(`Row ${r}: expected ${GRID_WIDTH} columns, got ${row.length}`);
    }
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val !== 0 && val !== 1) {
        throw new Error(`Row ${r}, col ${c}: expected 0 or 1, got ${JSON.stringify(val)}`);
      }
    }
  }
}

/**
 * Denoising pass: examine each cell's neighbourhood.
 *
 * The model is asked to return confidence values (0–100) or plain 0/1.
 * When it returns plain 0/1 we apply a simple isolated-cell filter:
 * a lone '1' surrounded entirely by '0's is treated as a stray mark and cleared.
 *
 * THRESHOLD: matches the 80 % shading requirement — a cell is kept as a platform
 * only if the model's confidence is >= 80 (or if it returned a hard 1 with neighbours).
 */
function denoiseGrid(grid) {
  const CONFIDENCE_THRESHOLD = 80; // 80 % shading rule

  // If the model returned a confidence matrix (values 0–100), apply threshold first
  const binary = grid.map(row =>
    row.map(cell => {
      if (cell === 0 || cell === 1) return cell;
      // numeric confidence value
      return cell >= CONFIDENCE_THRESHOLD ? 1 : 0;
    })
  );

  // Isolated-cell filter: remove single-cell '1's with no platform neighbours
  const denoised = binary.map((row, r) =>
    row.map((cell, c) => {
      if (cell === 0) return 0;

      // Check 8-connected neighbourhood
      let platformNeighbours = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < GRID_HEIGHT && nc >= 0 && nc < GRID_WIDTH) {
            platformNeighbours += binary[nr][nc];
          }
        }
      }

      // Stray mark: a solitary shaded square with zero platform neighbours
      return platformNeighbours === 0 ? 0 : 1;
    })
  );

  return denoised;
}

/**
 * Parse and validate the raw text from the Vision API.
 * Returns a clean GRID_HEIGHT × GRID_WIDTH binary grid.
 */
function parseAndValidate(rawText) {
  const jsonString = extractJson(rawText);
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`JSON.parse failed: ${e.message}\nExtracted string: ${jsonString.slice(0, 200)}`);
  }

  validateGrid(parsed);
  return denoiseGrid(parsed);
}

module.exports = { parseAndValidate };
