require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Jimp = require('jimp');
const axios = require('axios');
const fs = require('fs');

// Load the token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
console.log('token', token);
const bot = new TelegramBot(token, { polling: true });

const startTelegramBot = (automatic) => {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Welcome! What animal would you like to make a sticker of?');
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (userMessage && !userMessage.startsWith('/')) {
      const prompt = userMessage;
      const style = 'One big Sticker, cartoon, white background, white border, clear background';
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
          await bot.sendSticker(chatId, stickerFilePath);
          bot.sendMessage(chatId, 'Here you go! Any other ideas?');
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

  await image
    .resize(512, 512) // Resize to 512x512
    .writeAsync(outputFilePath);

  return outputFilePath;
};

module.exports = startTelegramBot;
