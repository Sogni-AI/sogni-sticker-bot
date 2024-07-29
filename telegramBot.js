require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

// Load the token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;

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

      bot.sendMessage(chatId, `Generating stickers for: ${prompt}...`);

      try {
        const savedFiles = await automatic.generateImage(prompt + ' ' + style, negativePrompt, model, loras, seed, batchSize);

        if (savedFiles.length > 0) {
          for (const filePath of savedFiles) {
            await bot.sendPhoto(chatId, fs.createReadStream(filePath));
          }
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

module.exports = startTelegramBot;
