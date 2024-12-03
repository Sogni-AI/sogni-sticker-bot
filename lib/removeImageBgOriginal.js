// removeImageBgOriginal.js
const Jimp = require('jimp');

// Function to calculate the color distance between two colors
function colorDistance(color1, color2) {
  const r1 = (color1 >> 24) & 0xff;
  const g1 = (color1 >> 16) & 0xff;
  const b1 = (color1 >> 8) & 0xff;

  const r2 = (color2 >> 24) & 0xff;
  const g2 = (color2 >> 16) & 0xff;
  const b2 = (color2 >> 8) & 0xff;

  return Math.sqrt(
    (r1 - r2) ** 2 +
      (g1 - g2) ** 2 +
      (b1 - b2) ** 2
  );
}

async function removeImageBg(filePath, tolerance = 30) {
  // Read the image
  const image = await Jimp.read(filePath);

  // Get the color at (0, 0)
  const bgColor = image.getPixelColor(0, 0);

  // Iterate over all pixels and set alpha to zero where color matches bgColor within tolerance
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const thisColor = this.getPixelColor(x, y);
    const distance = colorDistance(thisColor, bgColor);

    if (distance <= tolerance) {
      // Set alpha to zero (make pixel transparent)
      this.bitmap.data[idx + 3] = 0; // idx + 3 is the alpha channel
    }
  });

  // Return the modified image
  return image;
}

module.exports = removeImageBg;
