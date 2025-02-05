const Jimp = require('jimp');

/**
 * Compute the average color (R,G,B) of a w×h region in a Jimp image
 * starting at top-left corner (startX, startY).
 */
function averageColorOfRegion(image, startX, startY, w, h) {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const { width, height, data } = image.bitmap;

  for (let y = startY; y < startY + h; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = startX; x < startX + w; x++) {
      if (x < 0 || x >= width) continue;

      const idx = (y * width + x) * 4;
      const r = data[idx + 0];
      const g = data[idx + 1];
      const b = data[idx + 2];
      rSum += r; gSum += g; bSum += b;
      count++;
    }
  }

  if (count === 0) {
    // Fallback: no valid area
    return { r: 0, g: 255, b: 0 };
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}

/**
 * Euclidean distance in RGB space
 */
function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt(
    (r1 - r2)**2 +
    (g1 - g2)**2 +
    (b1 - b2)**2
  );
}

/**
 * ERODE the alpha channel by 1 pixel:
 * For each opaque pixel (alpha>0), if *any* neighbor is transparent,
 * we set this pixel transparent as well. That “peels” off leftover edges.
 */
function erodeAlpha(jimpImage) {
  const { width, height, data } = jimpImage.bitmap;
  const newAlpha = new Uint8Array(width * height);

  // index helper
  const idxOf = (x, y) => (y * width + x) * 4 + 3; // alpha offset

  // Copy existing alpha => newAlpha
  for (let i = 0; i < width * height; i++) {
    newAlpha[i] = data[i * 4 + 3];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[idxOf(x,y)];
      if (alpha === 0) {
        newAlpha[y * width + x] = 0;
        continue;
      }

      // If any neighbor is transparent => set me transparent
      let makeTransparent = false;
      for (let ny = y - 1; ny <= y + 1 && !makeTransparent; ny++) {
        for (let nx = x - 1; nx <= x + 1 && !makeTransparent; nx++) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (data[idxOf(nx, ny)] === 0) {
            makeTransparent = true;
          }
        }
      }
      if (makeTransparent) {
        newAlpha[y * width + x] = 0;
      }
    }
  }

  // Write new alpha back
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = newAlpha[i];
  }
}

/**
 * removeImageBg:
 *  1) Reads the input file.
 *  2) Samples a 5x5 block at (cornerX, cornerY) to compute an average "key color".
 *  3) Removes (alpha=0) any pixel within `tolerance` distance of that color, anywhere in the image.
 *  4) (Optional) Erodes alpha by 1 pixel.
 *
 * @param {string} filePath       path to your input image
 * @param {number} cornerX        top-left x of the corner sample region
 * @param {number} cornerY        top-left y of the corner sample region
 * @param {number} sampleSize     how big the corner sample is (default 5)
 * @param {number} tolerance      how close a pixel must be to the average color to remove
 * @param {boolean} doErode       whether to run morphological erode at the end
 *
 * @returns {Promise<Jimp>} a Jimp image object with alpha removed for matching pixels
 */
async function removeImageBg(
  filePath,
  cornerX = 0,
  cornerY = 0,
  sampleSize = 5,
  tolerance = 40,
  doErode = true
) {
  const image = await Jimp.read(filePath);

  // 1) Compute average color in the 5x5 corner region
  const avg = averageColorOfRegion(image, cornerX, cornerY, sampleSize, sampleSize);

  // 2) For each pixel in the image, if color distance <= tolerance => alpha=0
  const { width, height, data } = image.bitmap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx + 0];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // no need to read alpha if we’re just overwriting it

      if (colorDistance(r, g, b, avg.r, avg.g, avg.b) <= tolerance) {
        data[idx + 3] = 0; // transparent
      }
    }
  }

  // 3) Optionally do a morphological erode pass
  if (doErode) {
    erodeAlpha(image);
  }

  return image;
}

module.exports = removeImageBg;
