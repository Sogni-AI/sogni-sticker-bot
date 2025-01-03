// telegramBot.js
// Purpose: Handles all Telegram bot logic, including receiving messages, managing a request queue,
// and processing image generation and sticker creation requests.

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');
const convertImageToSticker = require('./lib/convertImageToSticker');

// Path to your channel config file
const CHANNEL_CONFIG_PATH = path.join(__dirname, 'channelConfig.json');

// Helper to load config
function loadChannelConfig() {
  try {
    if (!fs.existsSync(CHANNEL_CONFIG_PATH)) {
      // If file does not exist, create an empty JSON
      fs.writeFileSync(CHANNEL_CONFIG_PATH, JSON.stringify({}, null, 2));
    }
    const data = fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load channel config:', error);
    return {};
  }
}

// Helper to save config
function saveChannelConfig(config) {
  try {
    fs.writeFileSync(CHANNEL_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save channel config:', error);
  }
}

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

// We store the bot's username (handle) for mention-checking logic
let botUsername = null;
bot.getMe().then((info) => {
  botUsername = info.username;
  console.log('Bot username:', botUsername);
});

// Initialize the request queue and pending users
const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;
let retryCount = 0;
const maxRetries = 5;

let globalSogni = null; // Store sogni instance for reuse after polling errors

// Load the channel config once at startup
let channelConfig = loadChannelConfig();

/**
 * Utility: Check if user is channel admin or creator
 */
async function isChannelAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return (member.status === 'administrator' || member.status === 'creator');
  } catch (err) {
    console.error('Error checking admin status:', err);
    return false;
  }
}

/**
 * Validates message text against this channel’s whitelist & blacklist.
 * Returns an object with:
 *   isValid: boolean
 *   hasBlacklistedWords: boolean
 *   missingWhitelistWords: array of all required whitelist words if none were found
 */
function validateMessage(channelId, messageText) {
  const cfg = channelConfig[channelId];
  if (!cfg) {
    // No config => no restrictions
    return { isValid: true, hasBlacklistedWords: false, missingWhitelistWords: [] };
  }

  const { whitelist = [], blacklist = [] } = cfg;

  // 1. Check blacklist (any match => fail)
  for (let blackWord of blacklist) {
    const regex = new RegExp(`\\b${blackWord}\\b`, 'i'); // whole word
    if (regex.test(messageText)) {
      return {
        isValid: false,
        hasBlacklistedWords: true,
        missingWhitelistWords: []
      };
    }
  }

  // 2. Check whitelist: if there's a whitelist, at least one must appear
  if (whitelist.length > 0) {
    let foundOne = false;
    for (let whiteWord of whitelist) {
      const regex = new RegExp(`\\b${whiteWord}\\b`, 'i'); // whole word
      if (regex.test(messageText)) {
        foundOne = true;
        break;
      }
    }
    if (!foundOne) {
      // None of the whitelisted words were found
      return {
        isValid: false,
        hasBlacklistedWords: false,
        missingWhitelistWords: whitelist
      };
    }
  }

  // Passed both checks
  return { isValid: true, hasBlacklistedWords: false, missingWhitelistWords: [] };
}

/**
 * Helper: Return the appropriate message options for replying in the same thread if it’s a forum.
 */
function getThreadMessageOptions(msg) {
  if (msg.chat.type === 'supergroup' && msg.chat.is_forum && msg.message_thread_id) {
    return { message_thread_id: msg.message_thread_id };
  }
  return {};
}

const startTelegramBot = (sogni) => {
  globalSogni = sogni;

  /**
   *  /help command (available to everyone)
   */
  bot.onText(/^\/help$/, (msg) => {
    const messageOptions = getThreadMessageOptions(msg);
    const helpText = `
**Available Commands**:
- **/help** - Show this help message
- **/start** - Basic start message
- **!generate <prompt>** - Generate stickers

- **/addwhitelist** - Add comma-separated words to this channel's whitelist (admin-only)
- **/addblacklist** - Add comma-separated words to this channel's blacklist (admin-only)
- **/clearwhitelist** - Clear this channel's whitelist (admin-only)
- **/clearblacklist** - Clear this channel's blacklist (admin-only)

- **/listwhitelist** - Show the channel's current whitelist
- **/listblacklist** - Show the channel's current blacklist (admin-only)

Whitelist means the prompt must contain at least one of these words.
Blacklist means the prompt must contain none of those words.
    `;
    bot.sendMessage(msg.chat.id, helpText, { ...messageOptions, parse_mode: 'Markdown' });
  });

  /**
   * /start command
   */
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const messageOptions = getThreadMessageOptions(msg);
    bot.sendMessage(
      chatId,
      'Good day! What would you like me to create a sticker of? Use "!generate Your prompt..."!',
      messageOptions
    );
  });

  /**
   *  ADMIN COMMANDS
   *
   *  /addwhitelist cat,dog
   *  /addblacklist spam,scam
   *  /clearwhitelist
   *  /clearblacklist
   *
   *  ANYONE COMMANDS
   *  /listwhitelist
   *
   *  ADMIN-ONLY
   *  /listblacklist
   */

  // /listwhitelist (anyone)
  bot.onText(/^\/listwhitelist$/, (msg) => {
    const chatId = msg.chat.id;
    const messageOptions = getThreadMessageOptions(msg);

    if (!channelConfig[chatId] || channelConfig[chatId].whitelist.length === 0) {
      return bot.sendMessage(chatId, 'No words are currently whitelisted in this channel.', messageOptions);
    }

    const list = channelConfig[chatId].whitelist;
    bot.sendMessage(
      chatId,
      `Current whitelist words:\n• ${list.join('\n• ')}`,
      messageOptions
    );
  });

  // /listblacklist (admin only)
  bot.onText(/^\/listblacklist$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageOptions = getThreadMessageOptions(msg);

    // Check admin
    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    if (!channelConfig[chatId] || channelConfig[chatId].blacklist.length === 0) {
      return bot.sendMessage(chatId, 'No words are currently blacklisted in this channel.', messageOptions);
    }

    const list = channelConfig[chatId].blacklist;
    bot.sendMessage(
      chatId,
      `Current blacklist words:\n• ${list.join('\n• ')}`,
      messageOptions
    );
  });

  // /addwhitelist
  bot.onText(/^\/addwhitelist (.+)/, async (msg, match) => {
    if (msg.chat.type === 'private') {
      // No effect in private chat
      return;
    }
    const messageOptions = getThreadMessageOptions(msg);
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // admin check
    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    // Only accept comma-separated; if there's any space, show error
    const wordsString = match[1].trim();
    if (/\s/.test(wordsString)) {
      return bot.sendMessage(
        chatId,
        'Please separate your words with commas only (no spaces). Example: /addwhitelist cat,dog',
        messageOptions
      );
    }

    // Now split by comma
    const wordsToAdd = wordsString
      .split(',')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean);

    if (!channelConfig[chatId]) {
      channelConfig[chatId] = { whitelist: [], blacklist: [] };
    }

    // Push each word if not already present
    const currentList = channelConfig[chatId].whitelist;
    let addedWords = [];
    for (const word of wordsToAdd) {
      if (!currentList.includes(word)) {
        currentList.push(word);
        addedWords.push(word);
      }
    }

    saveChannelConfig(channelConfig);

    if (addedWords.length === 0) {
      return bot.sendMessage(
        chatId,
        'No new words were added (maybe they already exist?).',
        messageOptions
      );
    } else {
      return bot.sendMessage(
        chatId,
        `Added to whitelist: ${addedWords.join(', ')}`,
        messageOptions
      );
    }
  });

  // /addblacklist
  bot.onText(/^\/addblacklist (.+)/, async (msg, match) => {
    if (msg.chat.type === 'private') {
      return; // No effect in private chat
    }
    const messageOptions = getThreadMessageOptions(msg);
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    // Only accept comma-separated; if there's any space, show error
    const wordsString = match[1].trim();
    if (/\s/.test(wordsString)) {
      return bot.sendMessage(
        chatId,
        'Please separate your words with commas only (no spaces). Example: /addblacklist spam,scam',
        messageOptions
      );
    }

    // Split by comma
    const wordsToAdd = wordsString
      .split(',')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean);

    if (!channelConfig[chatId]) {
      channelConfig[chatId] = { whitelist: [], blacklist: [] };
    }

    const currentList = channelConfig[chatId].blacklist;
    let addedWords = [];
    for (const word of wordsToAdd) {
      if (!currentList.includes(word)) {
        currentList.push(word);
        addedWords.push(word);
      }
    }

    saveChannelConfig(channelConfig);

    if (addedWords.length === 0) {
      return bot.sendMessage(
        chatId,
        'No new words were added (maybe they already exist?).',
        messageOptions
      );
    } else {
      return bot.sendMessage(
        chatId,
        `Added to blacklist: ${addedWords.join(', ')}`,
        messageOptions
      );
    }
  });

  // /clearwhitelist
  bot.onText(/^\/clearwhitelist$/, async (msg) => {
    if (msg.chat.type === 'private') {
      return;
    }
    const messageOptions = getThreadMessageOptions(msg);
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    if (!channelConfig[chatId]) {
      channelConfig[chatId] = { whitelist: [], blacklist: [] };
    }
    channelConfig[chatId].whitelist = [];
    saveChannelConfig(channelConfig);

    bot.sendMessage(chatId, 'Whitelist cleared.', messageOptions);
  });

  // /clearblacklist
  bot.onText(/^\/clearblacklist$/, async (msg) => {
    if (msg.chat.type === 'private') {
      return;
    }
    const messageOptions = getThreadMessageOptions(msg);
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    if (!channelConfig[chatId]) {
      channelConfig[chatId] = { whitelist: [], blacklist: [] };
    }
    channelConfig[chatId].blacklist = [];
    saveChannelConfig(channelConfig);

    bot.sendMessage(chatId, 'Blacklist cleared.', messageOptions);
  });

  /**
   * Handle all incoming messages
   */
  bot.on('message', async (msg) => {
    //console.log('msg', msg);
    const chatId = msg.chat.id;
    const userMessage = msg.text && msg.text.toLowerCase();
    if (!userMessage) return;

    // We'll always respond in the thread if it's a forum
    const messageOptions = getThreadMessageOptions(msg);

    // 1) Greetings logic (only respond if in private chat or mentioned @botUsername in group)
    const isGreeting = userMessage.startsWith('hi') || userMessage.startsWith('hello');
    if (isGreeting) {
      if (msg.chat.type === 'private') {
        bot.sendMessage(
          chatId,
          `Hello, I am Sogni AI sticker bot! Type /start to get started, or use "!generate Your prompt..."!`,
          messageOptions
        );
        return;
      }

      // If group/supergroup => only respond if message includes @botUsername
      if (botUsername) {
        const mentionRegex = new RegExp(`@${botUsername.toLowerCase()}`, 'i');
        if (mentionRegex.test(userMessage)) {
          bot.sendMessage(
            chatId,
            `Hello, I am Sogni AI sticker bot! Type /start to get started, or use "!generate Your prompt..."!`,
            messageOptions
          );
        }
      }
      return;
    }

    // 2) Only handle generation if it starts with "!generate"
    if (userMessage.startsWith('!generate')) {
      // If we are in a group / supergroup, check whitelist/blacklist
      if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
        const { isValid, hasBlacklistedWords, missingWhitelistWords } = validateMessage(chatId, userMessage);

        if (!isValid) {
          // 1) Blacklisted words used
          if (hasBlacklistedWords) {
            bot.sendMessage(
              chatId,
              `You can't use blacklisted words in your prompt. Please try again.`,
              messageOptions
            );
          }
          // 2) Missing whitelist words
          else if (missingWhitelistWords.length > 0) {
            bot.sendMessage(
              chatId,
              `You must include at least one of the following whitelisted words: ${missingWhitelistWords.join(', ')}.`,
              messageOptions
            );
          }
          return;
        }
      }

      // Check if user already has a pending request
      const userId = msg.from.id;
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

      // Let them know queue position or generating
      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        bot.sendMessage(
          chatId,
          `Your request is queued. You are number ${positionInQueue} in the queue.`,
          messageOptions
        );
      } else {
        const userPrompt = msg.text.replace(/^!generate\b\s*/i, '').trim();
        bot.sendMessage(
          chatId,
          `Generating stickers for: ${userPrompt}`,
          messageOptions
        );
      }

      // Start processing if not already
      processNextRequest(sogni);
    }

    // If it doesn't start with '!generate' or greet the bot, do nothing else.
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

/**
 * Processes the next request in the queue (FIFO).
 */
async function processNextRequest(sogni) {
  if (isProcessing) return;
  if (requestQueue.length === 0) return;

  isProcessing = true;

  const { userId, chatId, message } = requestQueue.shift();
  console.log(`Processing request for userId: ${userId}, prompt: "${message.text}"`);

  try {
    // Use thread-specific reply
    const threadOptions = getThreadMessageOptions(message);

    // Remove '!generate' from the beginning
    let prompt = message.text.replace(/^!generate\b\s*/i, '').trim();

    // If user is in private chat and the prompt ends with (NN), create that many
    let batchSize = 3;
    const isInThread = threadOptions.message_thread_id !== undefined;
    if (isInThread) {
      batchSize = 1; // in thread mode we do 1 image
    }

    if (message.chat.type === 'private') {
      const match = prompt.match(/\((\d+)\)\s*$/);
      if (match) {
        let requestedCount = parseInt(match[1]);
        if (requestedCount > 16) requestedCount = 16;
        batchSize = requestedCount;
        // remove the trailing (NN)
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
      //disableSafety: true, // If you want to bypass the NSFW filter, uncomment this
    });

    console.log(`Project created: ${project.id} for prompt: "${prompt}"`);

    const images = await project.waitForCompletion();
    console.log(`Project ${project.id} completed. Received ${images.length} images.`);

    // NEW: If 0 images returned, it likely triggered the NSFW filter (all images blocked)
    if (images.length === 0) {
      bot.sendMessage(
        chatId,
        'No images were generated — possibly blocked by the NSFW filter. Please try a safer prompt!',
        threadOptions
      );
      return; 
    }

    // MOD: If fewer images are returned than requested, at least one was NSFW-filtered out
    if (images.length < batchSize) {
      const removedCount = batchSize - images.length;
      bot.sendMessage(
        chatId,
        `We generated ${images.length} out of ${batchSize} images. ` +
        `${removedCount} image${removedCount > 1 ? 's' : ''} ` +
        'was removed because it triggered the NSFW filter. Please try again.',
        threadOptions
      );
    }

    await processAllImages(images, project.id, chatId, threadOptions);

  } catch (error) {
    // Check for Sogni "Invalid token" error
    if (
      error &&
      error.status === 401 &&
      error.payload &&
      error.payload.errorCode === 107
    ) {
      console.error('Detected invalid token, restarting process...');
      process.exit(1);
    }

    console.error('Error processing request:', error);
    bot.sendMessage(chatId, 'An error occurred. Please try again later.');
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
async function processAllImages(images, projectId, chatId, threadOptions) {
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
      continue;
    }
  }

  // If we are NOT in a thread, send a final note
  if (!threadOptions.message_thread_id) {
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
