require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Jimp = require('jimp');
const axios = require('axios');
const fs = require('fs');
const replaceColor = require('replace-color');
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

    if (userMessage.startsWith('hi') || userMessage.startsWith('hello')) {
      bot.sendMessage(chatId, `Hello, I am Sogni AI sticker bot! Type /start to get started!`);
    } else if (userMessage && !userMessage.startsWith('/')) {
      const prompt = msg.text;
      const style = ',One big Sticker, cartoon, white background';
      const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
      const model = 'zavychromaxl_v70';
      const seed = automatic.getRandomSeed(); // Initial seed
      const loras = []; //['princess_xl_v2', 'realisticVisionV60B1_v51HyperVAE']; // Add your LoRA names here
      const batchSize = 1; // Number of images to generate in batch

      bot.sendMessage(chatId, `Generating a sticker for: ${prompt}`);

      try {
        const savedFiles = await automatic.generateImage(prompt + ' ' + style, negativePrompt, model, loras, seed, batchSize);

        if (savedFiles.length > 0) {
          const filePath = savedFiles[0];
          const stickerFilePath = await convertImageToSticker(filePath);

          // Add a delay to ensure the file is written to disk
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Check if the file exists before sending
          if (fs.existsSync(stickerFilePath)) {
            await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath));
            bot.sendMessage(chatId, 'Here you go! Any other ideas?');
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

// Function to convert an image to a sticker-compliant format
const convertImageToSticker = async (filePath) => {
  const image = await Jimp.read(filePath);
  const outputFilePath = `${filePath.replace('.png', '_sticker.png')}`;

  // Get the top-left pixel color
  const topLeftColor = Jimp.intToRGBA(image.getPixelColor(0, 0));
  console.log('Top-left pixel color:', topLeftColor);

  // Convert RGBA to hex string
  const targetColor = `#${((1 << 24) + (topLeftColor.r << 16) + (topLeftColor.g << 8) + topLeftColor.b).toString(16).slice(1)}`;
  const replaceWithColor = '#00000000'; // Transparent

  console.log('Target color hex:', targetColor);

  // Replace the color using replace-color
  await replaceColor({
    image: filePath,
    colors: {
      type: 'hex',
      targetColor: targetColor,
      replaceColor: replaceWithColor
    }
  })
    .then((jimpObject) => jimpObject.resize(512, 512).write(outputFilePath))
    .catch((err) => {
      console.error(err);
      throw err;
    });

  console.log('Sticker created at:', outputFilePath);
  return outputFilePath;
};

module.exports = startTelegramBot;
