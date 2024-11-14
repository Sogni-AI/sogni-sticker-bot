const Jimp = require("jimp");

/**
 * Remove background from image
 * @param imagePath {string} - Path to the image file
 * @returns {Promise<Jimp>} - Promise that resolves with the image buffer
 */
async function removeImageBg(imagePath){
    const image = await Jimp.read(imagePath);
    const tolerance = 30; // Adjust this value as needed
    const bgColor = image.getPixelColor(0, 0); // Get top-left pixel color
    const bgRGBA = Jimp.intToRGBA(bgColor);

    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // Create a 2D array to keep track of visited pixels
    const visited = new Array(height);
    for (let y = 0; y < height; y++) {
        visited[y] = new Array(width).fill(false);
    }

    // Queue for flood fill (pixels to process)
    const queue = [];

    // Add edge pixels to the queue
    for (let x = 0; x < width; x++) {
        queue.push({ x: x, y: 0 }); // Top edge
        queue.push({ x: x, y: height - 1 }); // Bottom edge
    }
    for (let y = 1; y < height - 1; y++) {
        queue.push({ x: 0, y: y }); // Left edge
        queue.push({ x: width - 1, y: y }); // Right edge
    }

    // Directions for neighboring pixels (up, down, left, right)
    const directions = [
        { dx: -1, dy: 0 }, // Left
        { dx: 1, dy: 0 },  // Right
        { dx: 0, dy: -1 }, // Up
        { dx: 0, dy: 1 },  // Down
    ];

    while (queue.length > 0) {
        const { x, y } = queue.shift();

        if (x < 0 || x >= width || y < 0 || y >= height) {
            continue; // Out of bounds
        }

        if (visited[y][x]) {
            continue; // Already processed
        }

        visited[y][x] = true;

        const pixelColor = image.getPixelColor(x, y);
        const pixelRGBA = Jimp.intToRGBA(pixelColor);

        // Calculate the color distance
        const distance = Math.sqrt(
            Math.pow(pixelRGBA.r - bgRGBA.r, 2) +
            Math.pow(pixelRGBA.g - bgRGBA.g, 2) +
            Math.pow(pixelRGBA.b - bgRGBA.b, 2)
        );

        if (distance <= tolerance) {
            // Set pixel to transparent
            image.setPixelColor(0x00000000, x, y);

            // Add neighboring pixels to the queue
            for (const dir of directions) {
                const newX = x + dir.dx;
                const newY = y + dir.dy;

                if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                    if (!visited[newY][newX]) {
                        queue.push({ x: newX, y: newY });
                    }
                }
            }
        }
    }

    return image;
}

module.exports = removeImageBg;
