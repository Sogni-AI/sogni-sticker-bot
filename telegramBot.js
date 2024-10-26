require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Jimp = require('jimp');
const sharp = require('sharp'); // Import sharp for image compression
const fs = require('fs');
const path = require('path');

// Load the token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
console.log('token', token);
const bot = new TelegramBot(token, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

const startTelegramBot = (automatic) => {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Good day! What would you like me to create a sticker of?');
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text && msg.text.toLowerCase();

    if (userMessage && (userMessage.startsWith('hi') || userMessage.startsWith('hello'))) {
      bot.sendMessage(chatId, `Hello, I am Sogni AI sticker bot! Type /start to get started!`);
    } else if (userMessage && !userMessage.startsWith('/')) {
      const prompt = msg.text;
      const style = ',One big Sticker, cartoon, white background';
      const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
      const model = 'flux1-schnell-fp8';
      const seed = automatic.getRandomSeed(); // Initial seed
      const loras = []; // Add your LoRA names here
      const batchSize = 1; // Number of images to generate in batch

      bot.sendMessage(chatId, `Generating a sticker for: ${prompt}`);

      try {
        const { images: savedFiles, masks: savedMasks } = await automatic.generateImage(prompt + ' ' + style, negativePrompt, model, loras, seed, batchSize);

        if (savedFiles.length > 0 && savedMasks.length > 0) {
          const filePath = savedFiles[0];
          const maskPath = savedMasks[0];
          const stickerFilePath = await convertImageToSticker(filePath, maskPath);

          // Add a delay to ensure the file is written to disk
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Check if the file exists before sending
          if (fs.existsSync(stickerFilePath)) {
            await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath));
            bot.sendMessage(chatId, 'Here you go! Right-click / long press to save it! Want to create a sticker pack of your favs? You need to message the sticker bot. @stickers');
          } else {
            bot.sendMessage(chatId, 'Failed to find the generated sticker. Please try again.');
          }
        } else {
          bot.sendMessage(chatId, 'Failed to generate the image. Please try again.');
        }
      } catch (error) {
        console.error('Error generating images or sending photos:', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again.');
      }
    }
  });

  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });
};

// Function to determine if a color is a shade of gray
const isShadeOfGray = (color) => {
  const { r, g, b } = Jimp.intToRGBA(color);
  return r === g && g === b;
};

// Function to convert an image to a sticker-compliant format using the mask
const convertImageToSticker = async (filePath, maskPath) => {
  try {
    const image = await Jimp.read(filePath);
    const mask = await Jimp.read(maskPath);

    // Ensure the mask is properly scaled to match the image
    mask.resize(image.bitmap.width, image.bitmap.height);

    // Iterate over each pixel in the mask and image to apply transparency
    for (let y = 0; y < image.bitmap.height; y++) {
      for (let x = 0; x < image.bitmap.width; x++) {
        const maskPixel = mask.getPixelColor(x, y);
        const imagePixel = image.getPixelColor(x, y);
        const imageRGBA = Jimp.intToRGBA(imagePixel);

        // If the mask pixel is a shade of gray, make the image pixel transparent
        if (isShadeOfGray(maskPixel)) {
          imageRGBA.a = 0; // Set alpha to 0 to make it fully transparent
        } else {
          imageRGBA.a = 255; // Keep alpha at 255 to make it fully opaque
        }

        image.setPixelColor(Jimp.rgbaToInt(imageRGBA.r, imageRGBA.g, imageRGBA.b, imageRGBA.a), x, y);
      }
    }

    const outputFilePath = `${filePath.replace('.png', '_sticker.png')}`;
    await image.writeAsync(outputFilePath);
    console.log('Sticker created at:', outputFilePath);

    // Compress the image if it exceeds 300KB
    const stats = fs.statSync(outputFilePath);
    if (stats.size > 300 * 1024) { // 300KB in bytes
      const compressedFilePath = outputFilePath.replace('.png', '_compressed.png');
      await sharp(outputFilePath)
        .png({ quality: 80 }) // Adjust quality as needed
        .toFile(compressedFilePath);

      // Replace the original with the compressed file
      fs.unlinkSync(outputFilePath);
      fs.renameSync(compressedFilePath, outputFilePath);
    }

    return outputFilePath;
  } catch (error) {
    console.error('Error converting image to sticker:', error);
    throw error;
  }
};

module.exports = startTelegramBot;
