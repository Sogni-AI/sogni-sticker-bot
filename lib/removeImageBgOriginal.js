const Jimp = require("jimp");

/**
 * Calculates the Euclidean distance between two colors in RGB space.
 * @param {object} color1 - The first color with r, g, b properties.
 * @param {object} color2 - The second color with r, g, b properties.
 * @returns {number} - The distance between the two colors.
 */
function colorDistance(color1, color2) {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Determines if a pixel's color is within a specified tolerance of the background color.
 * @param {object} pixelColor - The pixel's color with r, g, b properties.
 * @param {object} bgColor - The background color with r, g, b properties.
 * @param {number} tolerance - The maximum allowed distance between the colors.
 * @returns {boolean} - True if the pixel is considered background, false otherwise.
 */
function isBackgroundColor(pixelColor, bgColor, tolerance) {
    return colorDistance(pixelColor, bgColor) <= tolerance;
}

/**
 * Removes the background from an image by making pixels within a tolerance range of the
 * top-left pixel's color transparent.
 * @param {string} imagePath - The path to the image file.
 * @param {number} [tolerance=30] - The tolerance level for color matching (0-441).
 * @returns {Promise<Jimp>} - The processed Jimp image.
 */
async function removeImageBgOriginal(imagePath, tolerance = 30) {
    const image = await Jimp.read(imagePath);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // Get the top-left pixel's color to use as the background color
    const topLeftPixel = image.getPixelColor(0, 0);
    const bgColor = Jimp.intToRGBA(topLeftPixel);

    // Optional: Log the background color for debugging
    console.log(`Background Color - R: ${bgColor.r}, G: ${bgColor.g}, B: ${bgColor.b}, A: ${bgColor.a}`);

    // Iterate over all pixels
    image.scan(0, 0, width, height, function (x, y, idx) {
        const r = this.bitmap.data[idx + 0];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        const a = this.bitmap.data[idx + 3];

        const currentColor = { r, g, b };

        if (isBackgroundColor(currentColor, bgColor, tolerance)) {
            // Set pixel to transparent
            this.bitmap.data[idx + 3] = 0;
        }
    });

    return image;
}

module.exports = removeImageBgOriginal;
