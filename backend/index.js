const fs = require('fs');
const path = require('path');
const { convertPhotoToLevel } = require('./src/levelConverter');

// --- CLI entry point ---
// Usage: node index.js <path-to-image> [output.json]
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node index.js <image-path> [output.json]');
    process.exit(1);
  }

  const imagePath = args[0];
  const outputPath = args[1] || 'level_output.json';

  if (!fs.existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  try {
    const level = await convertPhotoToLevel(imagePath);
    const json = JSON.stringify(level, null, 2);
    fs.writeFileSync(outputPath, json, 'utf8');
    console.log(`\nLevel saved to: ${path.resolve(outputPath)}`);
    console.log(`Grid: ${level.width}×${level.height}`);
    if (level.playerStart) console.log(`Player start: row ${level.playerStart.row}, col ${level.playerStart.col}`);
    if (level.goal) console.log(`Goal:         row ${level.goal.row}, col ${level.goal.col}`);
  } catch (err) {
    console.error('\nConversion failed:', err.message);
    process.exit(1);
  }
}

main();
