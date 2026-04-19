const sharp = require('sharp');
const { GRID_WIDTH, GRID_HEIGHT } = require('./config');

/**
 * Convert raw image to a high-contrast B&W buffer ready for the Vision API.
 *
 * Pipeline: grayscale → threshold(128) → resize to 1024px wide → JPEG base64
 * The threshold step forces pencil shading to solid black, making it
 * unambiguous for the model.
 */
async function preprocessImage(imageBuffer) {
  const processed = await sharp(imageBuffer)
    .grayscale()
    .normalise()             // stretch histogram so shading spans full 0-255 range
    .linear(1.8, -40)        // boost contrast further: darken marks, brighten paper
    .resize(1024, null, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return processed.toString('base64');
}

module.exports = { preprocessImage, GRID_WIDTH, GRID_HEIGHT };
