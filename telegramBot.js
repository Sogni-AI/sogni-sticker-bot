require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const sharp = require('sharp');
const fs = require('fs');
const saveFile = require('./lib/saveFile');
const removeImageBgOriginal = require('./lib/removeImageBgOriginal');
const removeImageBg = require('./lib/removeImageBg');

// Load the token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
console.log('token', token);
let bot = new TelegramBot(token, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

// Initialize the request queue and pending users
const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;
let retryCount = 0;
const maxRetries = 5;

const startTelegramBot = (sogni) => {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Good day! What would you like me to create a sticker of?');
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userMessage = msg.text && msg.text.toLowerCase();

    if (userMessage && (userMessage.startsWith('hi') || userMessage.startsWith('hello'))) {
      bot.sendMessage(chatId, `Hello, I am Sogni AI sticker bot! Type /start to get started!`);
    } else if (userMessage && !userMessage.startsWith('/')) {
      if (pendingUsers.has(userId)) {
        bot.sendMessage(chatId, `You already have a pending request. Please wait until it's processed.`);
        return;
      }

      // Add request to queue
      requestQueue.push({ userId, chatId, message: msg });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex(req => req.userId === userId) + 1;
        bot.sendMessage(chatId, `Your request is queued. You are number ${positionInQueue} in the queue.`);
      } else {
        bot.sendMessage(chatId, `Generating stickers for: ${msg.text}`);
      }

      processNextRequest(sogni);
    }
  });

  // Set up polling error handler with retry and backoff
  bot.on('polling_error', handlePollingError);
};

// Error handler with retry logic and backoff
function handlePollingError(error) {
  console.error('Polling error:', error);

  if (retryCount < maxRetries) {
    const backoffTime = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s, etc.
    console.log(`Retrying in ${backoffTime / 1000} seconds... (attempt ${retryCount + 1})`);

    setTimeout(() => {
      retryCount++;
      bot = new TelegramBot(token, {
        polling: true,
        request: {
          agentOptions: {
            keepAlive: true,
            family: 4
          }
        }
      });
      startTelegramBot(true); // Restart bot on error with backoff
    }, backoffTime);
  } else {
    console.error('Max retries reached. Bot is stopping.');
    process.exit(1); // Exit script if max retries are exceeded
  }
}

async function processNextRequest(sogni) {
  if (isProcessing) {
    return;
  }

  if (requestQueue.length === 0) {
    return;
  }

  isProcessing = true;

  const { userId, chatId, message } = requestQueue.shift();
  const continueProcessing = async () => {
    // Remove user from pendingUsers
    pendingUsers.delete(userId);
    isProcessing = false;

    // Process next request
    processNextRequest(sogni);
  }

  try {
    const prompt = message.text;
    const style = 'One big Sticker, thin white outline, cartoon, grey solid background';
    const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
    const model = 'flux1-schnell-fp8';
    const batchSize = 3;

    const project = await sogni.projects.create({
      modelId: model,
      positivePrompt: prompt,
      negativePrompt: negativePrompt,
      stylePrompt: style,
      steps: 4,
      guidance: 1,
      numberOfImages: batchSize,
      scheduler: 'Euler',
      timeStepSpacing: 'Linear'
    });

    let images;
    try {
        images = await project.waitForCompletion();
    } catch (error) {
        console.error('Error generating images', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again.');
        return continueProcessing();
    }

    for (let i = 0; i < images.length; i++) {
      try {
        const imageUrl = images[i];
        const filePath = `renders/${project.id}_${i + 1}.png`;
        // Download the image to the file path using axios and streams
        await saveFile(filePath, imageUrl);
        const stickerFilePath = await convertImageToSticker(filePath);
        // Delay to ensure file is saved properly
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (fs.existsSync(stickerFilePath)) {
          await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath));
        } else {
          bot.sendMessage(chatId, 'Failed to find the generated sticker. Please try again.');
          break;
        }
      } catch (error) {
        console.error('Error generating images or sending photos:', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again.');
        break;
      }
    }

    bot.sendMessage(chatId, 'Here you go! Right-click / long press to save them! Want to create a sticker pack of your favs? Follow directions here: https://docs.sogni.ai/learn/telegram-ai-sticker-bot');

  } finally {
    // Remove user from pendingUsers
    pendingUsers.delete(userId);
    isProcessing = false;

    // Process next request
    processNextRequest(sogni);
  }
}

// Update the convertImageToSticker function to remove green pixels
const convertImageToSticker = async (filePath) => {
  try {
    console.log(`Processing file for sticker: ${filePath}`);
    // Or use removeImageBgOriginal for previous implementation
    const image = await removeImageBg(filePath);

    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const maxDimension = 512;

    if (width > maxDimension || height > maxDimension) {
      image.scaleToFit(maxDimension, maxDimension);
    }

    const outputFilePathPng = `${filePath.replace('.png', '_sticker.png')}`;
    await image.writeAsync(outputFilePathPng);
    console.log('Sticker PNG created at:', outputFilePathPng);

    const outputFilePathWebp = outputFilePathPng.replace('.png', '.webp');
    await sharp(outputFilePathPng)
      .webp({
        quality: 100,
        lossless: true,
        alphaQuality: 100
      })
      .toFile(outputFilePathWebp);
    console.log('Sticker WEBP created at:', outputFilePathWebp);

    fs.unlinkSync(outputFilePathPng);

    let stats = fs.statSync(outputFilePathWebp);
    let quality = 100;
    while (stats.size > 512 * 1024 && quality > 10) {
      quality -= 10;
      const compressedFilePath = outputFilePathWebp.replace('.webp', '_compressed.webp');
      await sharp(outputFilePathWebp)
        .webp({
          quality,
          lossless: true,
          alphaQuality: 100
        })
        .toFile(compressedFilePath);

      fs.unlinkSync(outputFilePathWebp);
      fs.renameSync(compressedFilePath, outputFilePathWebp);

      stats = fs.statSync(outputFilePathWebp);
      console.log(`Compressed sticker WEBP created at ${outputFilePathWebp} with quality ${quality}`);
    }

    if (stats.size > 512 * 1024) {
      throw new Error('Unable to compress the sticker below 512KB.');
    }

    return outputFilePathWebp;
  } catch (error) {
    console.error('Error converting image to sticker:', error);
    throw error;
  }
};

module.exports = startTelegramBot;
