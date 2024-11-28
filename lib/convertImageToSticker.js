const Jimp = require('jimp');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const removeImageBg = require('./removeImageBg'); // Ensure this module exists

const convertImageToSticker = async (filePath) => {
    try {
        console.log(`Processing file for sticker: ${filePath}`);

        // Read and process the image
        const image = await Jimp.read(filePath);

        // Remove background using custom or external function
        const bgRemovedImage = await removeImageBg(filePath);

        // Scale image to fit within the desired size
        const maxDimension = 512; // Discord/TG sticker dimensions
        if (bgRemovedImage.bitmap.width > maxDimension || bgRemovedImage.bitmap.height > maxDimension) {
            bgRemovedImage.scaleToFit(maxDimension, maxDimension);
        }

        // Save the processed PNG image
        const outputPngPath = filePath.replace('.png', '_sticker.png');
        await bgRemovedImage.writeAsync(outputPngPath);

        // Convert PNG to WebP format (used by Telegram/Discord stickers)
        const outputWebpPath = outputPngPath.replace('.png', '.webp');
        await sharp(outputPngPath)
            .webp({
                quality: 100,
                lossless: true
            })
            .toFile(outputWebpPath);

        console.log(`Sticker created: ${outputWebpPath}`);

        // Clean up intermediate PNG file
        if (fs.existsSync(outputPngPath)) {
            fs.unlinkSync(outputPngPath);
        }

        return outputWebpPath; // Return path to the final WebP sticker
    } catch (error) {
        console.error('Error converting image to sticker:', error);
        throw error;
    }
};

module.exports = convertImageToSticker;
