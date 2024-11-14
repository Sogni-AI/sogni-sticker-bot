const Jimp = require("jimp");

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max == min){
        h = 0;
        s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch(max){
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }

    return { h, s, l };
}

function isBackgroundGreenScreen(r, g, b) {
    const { h, s, l } = rgbToHsl(r, g, b);

    return (
        (h >= 70 && h <= 160) &&  // Expanded hue range to cover more green shades
        s >= 0.3 && s <= 1 &&     // Adjusted saturation range
        l >= 0.2 && l <= 0.9 &&   // Adjusted lightness range
        (g > r * 1.2) && (g > b * 1.2)  // Ensure green component is significantly higher than red and blue
    );
}

async function removeImageBgOriginal(imagePath){
    const image = await Jimp.read(imagePath);

    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // Iterate over all pixels
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelColor = image.getPixelColor(x, y);
            const { r, g, b, a } = Jimp.intToRGBA(pixelColor);

            if (isBackgroundGreenScreen(r, g, b)) {
                image.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 0), x, y); // Set to transparent
            }
        }
    }
}

module.exports = removeImageBgOriginal;
