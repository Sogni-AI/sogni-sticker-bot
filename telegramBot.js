// telegramBot.js
// Purpose: Handles all Telegram bot logic, including receiving messages, managing a request queue,
// and processing image generation and sticker creation requests.

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');
const convertImageToSticker = require('./lib/convertImageToSticker');

// Load the Telegram token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set in the environment.');
    process.exit(1);
}
console.log('Telegram bot token:', token);

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

let globalSogni = null; // Store sogni instance for reuse after polling errors

const startTelegramBot = (sogni) => {
  globalSogni = sogni;

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    // If there's a thread ID, use it to reply in the same topic
    const messageOptions = {};
    if (msg.chat.type === 'supergroup' && msg.message_thread_id) {
      messageOptions.message_thread_id = msg.message_thread_id;
    }
    bot.sendMessage(chatId, 'Good day! What would you like me to create a sticker of? Use "!generate Your prompt..."!', messageOptions);
  });

  bot.on('message', async (msg) => {
    console.log('msg', msg);

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userMessage = msg.text && msg.text.toLowerCase();

    // Determine if we're in a forum thread (thread mode)
    const isInThread = (
      msg.chat.type === 'supergroup' &&
      msg.chat.is_forum === true &&
      msg.message_thread_id
    );

    // Prepare options for replying in the same thread if available
    const messageOptions = {};
    if (isInThread) {
      messageOptions.message_thread_id = msg.message_thread_id;
    }

    if (!userMessage) {
      // If it is not a text message, ignore or let the user know.
      return;
    }

    // If user says "hi" or "hello", greet them
    if (userMessage.startsWith('hi') || userMessage.startsWith('hello')) {
      bot.sendMessage(
        chatId,
        `Hello, I am Sogni AI sticker bot! Type /start to get started, or use "!generate Your prompt..."!`,
        messageOptions
      );
      return;
    }

    // Only handle generation if it starts with "!generate"
    if (userMessage.startsWith('!generate')) {
      // If the user already has a pending request, let them know
      if (pendingUsers.has(userId)) {
        bot.sendMessage(
          chatId,
          `You already have a pending request. Please wait until it's processed. Thank you for your patience!`,
          messageOptions
        );
        return;
      }

      // Add request to queue
      requestQueue.push({ userId, chatId, message: msg });
      pendingUsers.add(userId);
      console.log(
        `Received new request from userId: ${userId}, prompt: "${msg.text}". Queue length is now ${requestQueue.length}.`
      );

      if (isProcessing) {
        // Show the queue position, both in thread and non-thread mode
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        bot.sendMessage(
          chatId,
          `Your request is queued. You are number ${positionInQueue} in the queue.`,
          messageOptions
        );
      } else {
        // If not already processing, let them know we're generating
        // But only if we're NOT in thread mode
        if (!isInThread) {
          // Remove "!generate" from the beginning for a cleaner prompt display
          const userPrompt = msg.text.replace(/^!generate\b\s*/i, '').trim();
          bot.sendMessage(
            chatId,
            `Generating stickers for: ${userPrompt}`,
            messageOptions
          );
        }
      }

      // Start processing the queue if not already
      processNextRequest(sogni);
    }

    // If it doesn't start with '!generate' and isn't 'hi'/'hello' or '/start', do nothing else.
  });

  bot.on('polling_error', handlePollingError);
};

function handlePollingError(error) {
    console.error('Polling error:', error);

    // Additional log for clarity
    console.log(`Polling error occurred. Current retryCount: ${retryCount}`);

    if (retryCount < maxRetries) {
        const backoffTime = Math.pow(2, retryCount) * 1000;
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
            // Restart the bot with the existing sogni instance
            if (globalSogni) {
                console.log('Restarting Telegram bot after polling error...');
                startTelegramBot(globalSogni);
            }
        }, backoffTime);
    } else {
        console.error('Max retries reached. Bot is stopping.');
        process.exit(1);
    }
}

async function processNextRequest(sogni) {
    if (isProcessing) return;
    if (requestQueue.length === 0) return;

    isProcessing = true;

    const { userId, chatId, message } = requestQueue.shift();
    console.log(`Processing request for userId: ${userId}, prompt: "${message.text}"`);

    // Again, figure out if we're in a thread for the actual generation step
    const isInThread = (
      message.chat.type === 'supergroup' &&
      message.chat.is_forum === true &&
      message.message_thread_id
    );

    // Use threadOptions to send messages back to the same thread
    const threadOptions = {};
    if (isInThread) {
      threadOptions.message_thread_id = message.message_thread_id;
    }

    try {
      // We remove '!generate' from the beginning to isolate the user's prompt text
      let prompt = message.text.replace(/^!generate\b\s*/i, '').trim();

      // If user is in direct DM (msg.chat.type === 'private') and the prompt ends with a number
      // in parentheses like (15), then we create that many stickers (up to 16). If above 16, just do 16.
      // Otherwise, we fall back to existing logic:
      // - If in thread mode: 1 image
      // - If not in thread mode: 3 images
      let batchSize = 3; // default
      if (isInThread) {
        // If in thread mode, only 1 image
        batchSize = 1;
      }

      if (message.chat.type === 'private') {
        const match = prompt.match(/\((\d+)\)\s*$/);
        if (match) {
          let requestedCount = parseInt(match[1]);
          // Cap at 16
          if (requestedCount > 16) requestedCount = 16;
          batchSize = requestedCount;
          // Remove the trailing (NN) from the prompt
          prompt = prompt.replace(/\(\d+\)\s*$/, '').trim();
        }
      }

      // Example style/negative prompts:
      const style = 'One big Sticker, thin white outline, cartoon, solid green screen background';
      const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
      const model = 'flux1-schnell-fp8';

      // Create the project
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

      console.log(`Project created: ${project.id} for prompt: "${prompt}"`);

      const images = await project.waitForCompletion();
      console.log(`Project ${project.id} completed. Received ${images.length} images.`);

      // We'll handle the entire batch with a "10s x numberOfImages" global limit
      const totalTimeout = batchSize * 10000; // e.g. 10 renders => 100 seconds
      await Promise.race([
        processAllImages(images, project.id, chatId, isInThread, threadOptions),
        new Promise((_, reject) =>
          setTimeout(() => {
            reject(new Error(`Request took too long: > ${totalTimeout / 1000} seconds in total.`));
          }, totalTimeout)
        )
      ]);

    } catch (error) {
      // Check if we got an "Invalid token" error from the Sogni SDK
      if (
        error &&
        error.status === 401 &&                 // HTTP 401
        error.payload &&                        // The 'payload' object is present
        error.payload.errorCode === 107 &&      // Sogni-specific error code
        /Invalid token/i.test(error.payload.message)
      ) {
        console.error('Detected invalid token, restarting process...');
        // Exit so PM2 can restart
        process.exit(1);
      }

      console.error('Error processing request:', error);
      bot.sendMessage(chatId, 'An error occurred. Please try again later.', threadOptions);
    } finally {
      pendingUsers.delete(userId);
      isProcessing = false;
      console.log(`Finished processing for userId: ${userId}. Queue length is now ${requestQueue.length}.`);
      processNextRequest(sogni);
    }
}

/**
 * Processes all images but enforces a 30-second timeout for each image individually.
 * If an image hits 30 seconds, we skip it, but continue processing the rest.
 */
async function processAllImages(images, projectId, chatId, isInThread, threadOptions) {
  for (let i = 0; i < images.length; i++) {
    try {
      await Promise.race([
        processSingleImage(images[i], projectId, i, chatId, threadOptions),
        new Promise((_, reject) =>
          setTimeout(() => {
            reject(new Error(`Timeout exceeded: 30s for image #${i + 1}`));
          }, 30000)
        )
      ]);
    } catch (error) {
      console.error(`Error or timeout during image #${i + 1}:`, error);
      bot.sendMessage(
        chatId,
        `Image #${i + 1} took too long or failed to process. Skipping it...`,
        threadOptions
      );
      continue; // Skip this image and move on
    }
  }

  // If we are NOT in a thread, send a final note
  if (!isInThread) {
    bot.sendMessage(chatId, 'Here you go! Right-click / long press to save them!', threadOptions);
  }
}

/**
 * Process a single image:
 *  1. Download it
 *  2. Remove background
 *  3. Convert to sticker
 *  4. Send to chat
 */
async function processSingleImage(imageUrl, projectId, idx, chatId, threadOptions) {
  const filePath = `renders/${projectId}_${idx + 1}.png`;

  // Save to disk
  await saveFile(filePath, imageUrl);
  console.log(`Saved image to ${filePath}`);

  // Remove background
  let stickerImage;
  try {
    stickerImage = await removeImageBg(filePath);
  } catch (error) {
    throw new Error(`removeImageBg failed: ${error.message || error}`);
  }

  const bgRemovedFilePath = filePath.replace('.png', '_nobg.png');
  await stickerImage.writeAsync(bgRemovedFilePath);
  console.log(`Saved background-removed image to ${bgRemovedFilePath}`);

  // Convert to sticker
  let stickerFilePath;
  try {
    stickerFilePath = await convertImageToSticker(bgRemovedFilePath);
    console.log('Generated sticker file path:', stickerFilePath);
  } catch (conversionError) {
    throw new Error(`convertImageToSticker failed: ${conversionError.message || conversionError}`);
  }

  if (fs.existsSync(stickerFilePath)) {
    await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath), threadOptions);
  } else {
    throw new Error(`Sticker file not found: ${stickerFilePath}`);
  }
}

module.exports = startTelegramBot;
