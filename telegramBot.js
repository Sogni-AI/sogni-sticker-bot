require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');
const convertImageToSticker = require('./lib/convertImageToSticker');

// Path to your channel config file
const CHANNEL_CONFIG_PATH = path.join(__dirname, 'channelConfig.json');

// Path to video rate limit tracking file
const VIDEO_RATE_LIMIT_PATH = path.join(__dirname, 'videoRateLimit.json');
const MAX_VIDEOS_PER_DAY = 10;

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

// Helper to load video rate limit data
function loadVideoRateLimits() {
  try {
    if (!fs.existsSync(VIDEO_RATE_LIMIT_PATH)) {
      fs.writeFileSync(VIDEO_RATE_LIMIT_PATH, JSON.stringify({}, null, 2));
    }
    const data = fs.readFileSync(VIDEO_RATE_LIMIT_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load video rate limits:', error);
    return {};
  }
}

// Helper to save video rate limit data
function saveVideoRateLimits(limits) {
  try {
    fs.writeFileSync(VIDEO_RATE_LIMIT_PATH, JSON.stringify(limits, null, 2));
  } catch (error) {
    console.error('Failed to save video rate limits:', error);
  }
}

// Get current UTC day as a string (YYYY-MM-DD)
function getCurrentUTCDay() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Check if user can make a video request, returns { allowed: boolean, remaining: number }
function checkVideoRateLimit(username) {
  const rateLimits = loadVideoRateLimits();
  const today = getCurrentUTCDay();

  if (!rateLimits[username]) {
    rateLimits[username] = { day: today, count: 0 };
  }

  // Reset count if it's a new day
  if (rateLimits[username].day !== today) {
    rateLimits[username] = { day: today, count: 0 };
  }

  const remaining = MAX_VIDEOS_PER_DAY - rateLimits[username].count;
  const allowed = rateLimits[username].count < MAX_VIDEOS_PER_DAY;

  return { allowed, remaining };
}

// Increment video request count for user
function incrementVideoCount(username) {
  const rateLimits = loadVideoRateLimits();
  const today = getCurrentUTCDay();

  if (!rateLimits[username] || rateLimits[username].day !== today) {
    rateLimits[username] = { day: today, count: 0 };
  }

  rateLimits[username].count++;
  saveVideoRateLimits(rateLimits);

  const remaining = MAX_VIDEOS_PER_DAY - rateLimits[username].count;

  // Log the increment with username and current count
  console.log(`[Telegram Video Counter] User: ${username} | Used: ${rateLimits[username].count}/${MAX_VIDEOS_PER_DAY} | Remaining: ${remaining} | Date: ${today}`);

  return remaining;
}

/**
 * Process image for video generation
 * Resizes to 512px max (for faster generation) while maintaining aspect ratio
 * Ensures BOTH dimensions are divisible by 2 and within 480-512 range
 * Returns { buffer, width, height, wasResized }
 */
async function processImageForVideo(imagePath) {
  const MIN_VIDEO_DIMENSION = 480;
  const TARGET_MAX_DIMENSION = 512; // Target 512px for fast generation

  // Get image metadata to determine original dimensions
  const metadata = await sharp(imagePath).metadata();
  let originalWidth = metadata.width;
  let originalHeight = metadata.height;

  let targetWidth = originalWidth;
  let targetHeight = originalHeight;

  // Step 1: Scale to fit within TARGET_MAX (512px) while maintaining aspect ratio
  if (originalWidth > TARGET_MAX_DIMENSION || originalHeight > TARGET_MAX_DIMENSION) {
    const scaleFactor = Math.min(
      TARGET_MAX_DIMENSION / originalWidth,
      TARGET_MAX_DIMENSION / originalHeight
    );

    targetWidth = Math.floor(originalWidth * scaleFactor);
    targetHeight = Math.floor(originalHeight * scaleFactor);
  }

  // Step 2: Ensure BOTH dimensions meet minimum (480px)
  // If either dimension is below 480, scale up the smaller dimension to 480
  if (targetWidth < MIN_VIDEO_DIMENSION || targetHeight < MIN_VIDEO_DIMENSION) {
    // Scale so the smaller dimension becomes exactly 480
    const scaleFactor = Math.max(
      MIN_VIDEO_DIMENSION / targetWidth,
      MIN_VIDEO_DIMENSION / targetHeight
    );

    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);
  }

  // Step 3: Ensure dimensions are even (divisible by 2) - required for video codecs
  targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
  targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;

  // Step 4: Final validation - ensure we still meet minimums after rounding
  // This can happen if we rounded down an odd number that was exactly 480
  if (targetWidth < MIN_VIDEO_DIMENSION) targetWidth = MIN_VIDEO_DIMENSION;
  if (targetHeight < MIN_VIDEO_DIMENSION) targetHeight = MIN_VIDEO_DIMENSION;

  console.log(`Processing image: ${originalWidth}x${originalHeight} → ${targetWidth}x${targetHeight} (optimized for speed)`);

  // Always resize/process the image for consistency
  const imageBuffer = await sharp(imagePath)
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: false
    })
    .toBuffer();

  return {
    buffer: imageBuffer,
    width: targetWidth,
    height: targetHeight,
    wasResized: (targetWidth !== originalWidth || targetHeight !== originalHeight)
  };
}

// Load the Telegram token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in the environment.');
  process.exit(1);
}
console.log('Telegram bot token:', token);

// Track polling errors so we don't spam restarts
let retryCount = 0;
const maxRetries = 9999;

let bot = new TelegramBot(token, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4,
    },
  },
});

// We store the bot's username (handle) for mention-checking logic
let botUsername = null;
bot.getMe().then((info) => {
  botUsername = info.username;
  console.log('Bot username:', botUsername);
});

// Keep track of each user's last prompt so we can handle "!repeat"
const userLastPrompt = {};

// Keep track of users waiting to provide video prompts for their uploaded images
// Structure: { userId: { fileId, filePath, timestamp, chatId } }
const userImageContext = {};

// Load the channel config once at startup
let channelConfig = loadChannelConfig();

// We'll store the sogni instance globally so we can refer to it in handlers
let globalSogni = null;

/**
 * Utility: Check if user is channel admin or creator
 */
async function isChannelAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === 'administrator' || member.status === 'creator';
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
        missingWhitelistWords: [],
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
        missingWhitelistWords: whitelist,
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

// Video request queue for Telegram
let videoQueue = [];
let isProcessingVideo = false;

/**
 * Start the Telegram bot
 */
const startTelegramBot = (sogni) => {
  globalSogni = sogni;

  /**
   * /help command (available to everyone)
   */
  bot.onText(/^\/help$/, (msg) => {
    const messageOptions = getThreadMessageOptions(msg);
    const helpText = `
**Available Commands**:
- **/help** - Show this help message
- **/start** - Basic start message
- **!generate <prompt>** - Generate stickers
- **!imagine <prompt>** - (same as !generate)
- **!video <prompt>** - Generate a 5 second video
- **📷 Send a photo with caption** - Create image-to-video (private chats only)
- **!repeat** - Generate more images with your last prompt

- **/addwhitelist** - Add comma-separated words to this channel's whitelist (admin-only)
- **/addblacklist** - Add comma-separated words to this channel's blacklist (admin-only)
- **/clearwhitelist** - Clear this channel's whitelist (admin-only)
- **/clearblacklist** - Clear this channel's blacklist (admin-only)

- **/listwhitelist** - Show the channel's current whitelist
- **/listblacklist** - Show the channel's current blacklist (admin-only)
    `;
    bot.sendMessage(msg.chat.id, helpText, { ...messageOptions, parse_mode: 'Markdown' });
  });

  /**
   * /start command
   */
  bot.onText(/^\/start$/, (msg) => {
    const chatId = msg.chat.id;
    const messageOptions = getThreadMessageOptions(msg);
    const isPrivateChat = msg.chat.type === 'private';

    const baseMessage = 'Good day! I can create stickers and videos for you!\n\n' +
      'Use "!generate <prompt>" or "!imagine <prompt>" to create stickers.\n' +
      'Use "!video <prompt>" to create a 5 second video.\n';

    const imageToVideoMessage = isPrivateChat
      ? '📷 Send a photo with caption to create an image-to-video!\n\n'
      : '\n';

    bot.sendMessage(
      chatId,
      baseMessage + imageToVideoMessage + 'Type /help to see all available commands.',
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
   *  ANYONE COMMAND
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
    bot.sendMessage(chatId, `Current whitelist words:\n• ${list.join('\n• ')}`, messageOptions);
  });

  // /listblacklist (admin only)
  bot.onText(/^\/listblacklist$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageOptions = getThreadMessageOptions(msg);

    const admin = await isChannelAdmin(chatId, userId);
    if (!admin) {
      return bot.sendMessage(chatId, 'You are not allowed to use that command.', messageOptions);
    }

    if (!channelConfig[chatId] || channelConfig[chatId].blacklist.length === 0) {
      return bot.sendMessage(chatId, 'No words are currently blacklisted in this channel.', messageOptions);
    }

    const list = channelConfig[chatId].blacklist;
    bot.sendMessage(chatId, `Current blacklist words:\n• ${list.join('\n• ')}`, messageOptions);
  });

  // /addwhitelist
  bot.onText(/^\/addwhitelist (.+)/, async (msg, match) => {
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

    const wordsString = match[1].trim();
    if (/\s/.test(wordsString)) {
      return bot.sendMessage(
        chatId,
        'Please separate your words with commas only (no spaces). Example: /addwhitelist cat,dog',
        messageOptions
      );
    }

    const wordsToAdd = wordsString
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (!channelConfig[chatId]) {
      channelConfig[chatId] = { whitelist: [], blacklist: [] };
    }

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
      return bot.sendMessage(chatId, 'No new words were added (maybe they already exist?).', messageOptions);
    } else {
      return bot.sendMessage(chatId, `Added to whitelist: ${addedWords.join(', ')}`, messageOptions);
    }
  });

  // /addblacklist
  bot.onText(/^\/addblacklist (.+)/, async (msg, match) => {
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

    const wordsString = match[1].trim();
    if (/\s/.test(wordsString)) {
      return bot.sendMessage(
        chatId,
        'Please separate your words with commas only (no spaces). Example: /addblacklist spam,scam',
        messageOptions
      );
    }

    const wordsToAdd = wordsString
      .split(',')
      .map((w) => w.trim().toLowerCase())
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
      return bot.sendMessage(chatId, 'No new words were added (maybe they already exist?).', messageOptions);
    } else {
      return bot.sendMessage(chatId, `Added to blacklist: ${addedWords.join(', ')}`, messageOptions);
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
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // 1) Check for photo messages (image-to-video workflow)
    if (msg.photo && msg.photo.length > 0) {
      await handlePhotoMessage(msg);
      return;
    }

    const userMessage = msg.text && msg.text.toLowerCase();
    if (!userMessage) return;

    const messageOptions = getThreadMessageOptions(msg);

    // 2) Check if user has pending image context and is sending a text prompt
    if (userImageContext[userId] && !userImageContext[userId].isProcessing) {
      // User sent text after uploading an image - use it as the video prompt
      await handleImageToVideoRequest(msg);
      return;
    }

    // 3) Simple greetings logic
    const isGreeting = userMessage.startsWith('hi') || userMessage.startsWith('hello');
    if (isGreeting) {
      if (msg.chat.type === 'private') {
        bot.sendMessage(
          chatId,
          `Hello, I am Sogni AI sticker bot! Type /start to get started, or use "!generate <prompt>" or "!imagine <prompt>"!`,
          messageOptions
        );
        return;
      }

      if (botUsername) {
        const mentionRegex = new RegExp(`@${botUsername.toLowerCase()}`, 'i');
        if (mentionRegex.test(userMessage)) {
          bot.sendMessage(
            chatId,
            `Hello, I am Sogni AI sticker bot! Type /start to get started, or use "!imagine <prompt>"!`,
            messageOptions
          );
        }
      }
      return;
    }

    // 4) If user wants to repeat last prompt: "!repeat"
    if (userMessage.startsWith('!repeat')) {
      const userId = msg.from.id;
      const lastPrompt = userLastPrompt[userId];
      if (!lastPrompt) {
        bot.sendMessage(chatId, 'No last prompt found. Please use "!imagine <prompt>" first.', messageOptions);
        return;
      }

      bot.sendMessage(chatId, `Generating stickers for: ${lastPrompt} [repeat]`, messageOptions);
      handleGenerationRequest(msg, lastPrompt);
      return;
    }

    // 5) Generate command: "!generate" or "!imagine"
    if (userMessage.startsWith('!generate') || userMessage.startsWith('!imagine')) {
      // If we are in a group / supergroup, check whitelist/blacklist
      if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
        const { isValid, hasBlacklistedWords, missingWhitelistWords } = validateMessage(chatId, userMessage);
        if (!isValid) {
          if (hasBlacklistedWords) {
            bot.sendMessage(chatId, `You can't use blacklisted words in your prompt. Please try again.`, messageOptions);
          } else if (missingWhitelistWords.length > 0) {
            bot.sendMessage(
              chatId,
              `You must include at least one of the following whitelisted words: ${missingWhitelistWords.join(', ')}.`,
              messageOptions
            );
          }
          return;
        }
      }

      // Strip out the leading "!generate" or "!imagine" and get the prompt
      let userPrompt = msg.text.replace(/^!(generate|imagine)\b\s*/i, '').trim();
      bot.sendMessage(chatId, `Generating stickers for: ${userPrompt}`, messageOptions);

      handleGenerationRequest(msg, userPrompt);
      return;
    }

    // 4) Video command: "!video"
    if (userMessage.startsWith('!video')) {
      // Check if user has a pending image that's being processed
      if (userImageContext[userId] && userImageContext[userId].isProcessing) {
        bot.sendMessage(
          chatId,
          '⏳ Your image-to-video is currently processing. Please wait for it to complete!',
          messageOptions
        );
        return;
      }

      // If we are in a group / supergroup, check whitelist/blacklist
      if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
        const { isValid, hasBlacklistedWords, missingWhitelistWords } = validateMessage(chatId, userMessage);
        if (!isValid) {
          if (hasBlacklistedWords) {
            bot.sendMessage(chatId, `You can't use blacklisted words in your prompt. Please try again.`, messageOptions);
          } else if (missingWhitelistWords.length > 0) {
            bot.sendMessage(
              chatId,
              `You must include at least one of the following whitelisted words: ${missingWhitelistWords.join(', ')}.`,
              messageOptions
            );
          }
          return;
        }
      }

      // Strip out the leading "!video" and get the prompt
      let userPrompt = msg.text.replace(/^!video\b\s*/i, '').trim();

      // Check rate limit using username
      const username = msg.from.username || `user_${msg.from.id}`;
      const { allowed, remaining } = checkVideoRateLimit(username);

      if (!allowed) {
        bot.sendMessage(
          chatId,
          `You've reached your daily limit of ${MAX_VIDEOS_PER_DAY} videos. Please try again tomorrow (resets at UTC midnight).`,
          messageOptions
        );
        return;
      }

      // Increment the count
      const remainingAfter = incrementVideoCount(username);

      // Add to video queue
      videoQueue.push({ msg, prompt: userPrompt, username });

      if (isProcessingVideo) {
        // Someone else is already processing a video
        const position = videoQueue.length;
        const total = videoQueue.length;
        bot.sendMessage(
          chatId,
          `Your video request has been queued! You are position ${position} of ${total} in the queue.\n` +
          `Your video will be generated once the previous one completes.\n\n` +
          `You have ${remainingAfter} video${remainingAfter === 1 ? '' : 's'} left today!`,
          messageOptions
        );
      } else {
        // Start processing immediately
        bot.sendMessage(
          chatId,
          `Generating 5 second video for: ${userPrompt}\n(This can take up to 5 minutes)\n\nYou have ${remainingAfter} video${remainingAfter === 1 ? '' : 's'} left today!`,
          messageOptions
        );
        processNextVideo();
      }

      return;
    }

    // 6) If in private chat with unrecognized command:
    if (msg.chat.type === 'private') {
      bot.sendMessage(
        chatId,
        `Hello! I am your AI sticker and video bot. Here are some things you can do:\n` +
          `- /start to see a welcome message\n` +
          `- /help to see more commands\n` +
          `- !generate <your prompt> or !imagine <your prompt> to create stickers\n` +
          `- !video <your prompt> to create a 5 second video\n` +
          `- Send a photo with a caption to create an image-to-video\n` +
          `- !repeat to create more using your last prompt`,
        messageOptions
      );
    }
  });

  /**
   * If polling fails, exit so PM2 (or another manager) can restart us
   */
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
    console.log(`Polling error occurred. Current retryCount: ${retryCount}`);

    if (retryCount >= maxRetries) {
      console.error('Max retries reached. Bot is stopping in 5 seconds...');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
      return;
    }

    retryCount++;
    console.log('Restarting process in 5 seconds due to polling error...');
    setTimeout(() => process.exit(1), 5000);
  });

  /**
   * Cleanup timer: Remove stale image contexts that haven't been processed
   * This prevents memory leaks and clears abandoned image uploads
   */
  const CONTEXT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, context] of Object.entries(userImageContext)) {
      // Only clean up contexts that aren't currently processing
      if (!context.isProcessing && (now - context.timestamp > CONTEXT_TIMEOUT)) {
        console.log(`Cleaning up stale image context for user ${userId} (age: ${Math.floor((now - context.timestamp) / 1000)}s)`);
        delete userImageContext[userId];
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} stale image context(s)`);
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  console.log('Telegram bot started with image-to-video support!');
};

/**
 * Perform the actual generation and sticker processing for a single request.
 */
async function handleGenerationRequest(msg, prompt) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const messageOptions = getThreadMessageOptions(msg);

  // Store this prompt as the last prompt for the user
  userLastPrompt[userId] = prompt;

  // Decide how many images to generate based on chat type
  const chatType = msg.chat.type; // "private" | "group" | "supergroup" | "channel"
  let batchSize = Number(process.env.DEFAULT_BATCH_SIZE);

  // Force 1 if group / supergroup / channel
  if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') {
    batchSize = 1;
  }

  // If private, allow user to override with (NN) syntax, e.g. "!generate cat (5)"
  if (chatType === 'private') {
    const match = prompt.match(/\(\d+?\)\s*$/);
    if (match) {
      let requestedCount = parseInt(match[0].replace(/[()]/g, ''), 10);
      if (requestedCount > 16) requestedCount = 16; // limit for safety
      batchSize = requestedCount;
      prompt = prompt.replace(/\(\d+?\)\s*$/, '').trim();
    }
  }

  try {
    // 30-second overall timeout to avoid indefinite wait
    await Promise.race([
      performGenerationAndSendStickers(prompt, batchSize, msg, messageOptions),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Request timed out after 1 minute'));
        }, 60000);
      }),
    ]);
  } catch (err) {
    console.error('Error or timeout while processing generation request:', err);
    bot.sendMessage(chatId, 'Sorry, your request took too long or encountered an error. Please try again.', messageOptions);
  }
}

/**
 * Handle photo message for image-to-video workflow
 */
async function handlePhotoMessage(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const messageOptions = getThreadMessageOptions(msg);

  // Only support in private chats
  if (msg.chat.type !== 'private') {
    return; // Silently ignore photos in group chats
  }

  // Check if user is already processing a video
  if (userImageContext[userId] && userImageContext[userId].isProcessing) {
    await bot.sendMessage(
      chatId,
      '⏳ Your previous image is still being processed. Please wait for it to complete!',
      messageOptions
    );
    return;
  }

  const photo = msg.photo[msg.photo.length - 1]; // Get largest size
  const caption = msg.caption?.trim();

  try {
    // Download the image
    const fileLink = await bot.getFileLink(photo.file_id);
    const timestamp = Date.now();
    const filePath = `renders/telegram_img2vid_${timestamp}.jpg`;

    await saveFile(filePath, fileLink);
    console.log(`Downloaded image to ${filePath} for user ${userId}`);

    // If caption exists, process immediately as the video prompt
    if (caption) {
      console.log(`Image with caption received from user ${userId}: "${caption}"`);

      // Store context and mark as processing
      userImageContext[userId] = {
        fileId: photo.file_id,
        filePath,
        timestamp,
        chatId,
        isProcessing: true
      };

      await handleImageToVideoRequest(msg, caption);
      return;
    }

    // No caption - store context and wait for prompt
    userImageContext[userId] = {
      fileId: photo.file_id,
      filePath,
      timestamp,
      chatId,
      isProcessing: false
    };

    await bot.sendMessage(
      chatId,
      '📷 Got your image! What kind of video would you like?\n\n' +
      'Example: "make me point to camera and smile"\n\n' +
      '💡 Tip: You can also send images with captions to skip this step!',
      messageOptions
    );

  } catch (error) {
    console.error('Error handling photo message:', error);
    await bot.sendMessage(
      chatId,
      '❌ Failed to process your image. Please try again.',
      messageOptions
    );
  }
}

/**
 * Handle image-to-video request after receiving prompt
 */
async function handleImageToVideoRequest(msg, promptOverride = null) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const context = userImageContext[userId];
  const messageOptions = getThreadMessageOptions(msg);

  if (!context) {
    console.log(`No image context found for user ${userId}`);
    return;
  }

  const prompt = promptOverride || msg.text?.trim();
  const username = msg.from.username || `user_${userId}`;

  if (!prompt) {
    await bot.sendMessage(
      chatId,
      '❌ Please send a text description for your video.',
      messageOptions
    );
    return;
  }

  console.log(`Processing image-to-video for user ${userId} with prompt: "${prompt}"`);

  // Check rate limit
  if (!checkVideoRateLimit(username, 'telegram')) {
    delete userImageContext[userId];
    await bot.sendMessage(
      chatId,
      '⏸️ You\'ve reached your daily limit of 3 videos. Try again tomorrow!',
      messageOptions
    );
    return;
  }

  // Increment counter
  incrementVideoCount(username, 'telegram');

  // Mark as processing
  if (userImageContext[userId]) {
    userImageContext[userId].isProcessing = true;
  }

  // Add to video queue with image path
  videoQueue.push({
    msg,
    prompt,
    username,
    imagePath: context.filePath  // Pass the image path for i2v
  });

  console.log(`Added image-to-video to queue. Queue length: ${videoQueue.length}`);

  // Process queue
  if (!isProcessingVideo) {
    processNextVideo();
  } else {
    await bot.sendMessage(
      chatId,
      `🎬 Added to queue! Position: ${videoQueue.length}`,
      messageOptions
    );
  }
}

/**
 * Process the next video in the queue
 */
async function processNextVideo() {
  if (isProcessingVideo) return;
  if (videoQueue.length === 0) return;

  isProcessingVideo = true;

  const { msg, prompt, username, imagePath } = videoQueue.shift();

  await handleVideoRequest(msg, prompt, imagePath);

  // Process next video in queue
  isProcessingVideo = false;
  if (videoQueue.length > 0) {
    processNextVideo();
  }
}

/**
 * Handle video generation request
 */
async function handleVideoRequest(msg, prompt, imagePath = null) {
  const chatId = msg.chat.id;
  const messageOptions = getThreadMessageOptions(msg);
  const userId = msg.from.id;

  try {
    // 6-minute timeout for video generation (can take up to 5 minutes)
    await Promise.race([
      performVideoGeneration(prompt, msg, messageOptions, imagePath),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Request timed out after 6 minutes'));
        }, 360000);
      }),
    ]);

    // Clean up image context after successful generation
    if (imagePath && userImageContext[userId]) {
      delete userImageContext[userId];
      console.log(`Cleaned up image context for user ${userId}`);
    }
  } catch (err) {
    console.error('Error or timeout while processing video request:', err);
    bot.sendMessage(chatId, 'Sorry, your video request took too long or encountered an error. Please try again.', messageOptions);

    // Clean up image context even on error
    if (imagePath && userImageContext[userId]) {
      delete userImageContext[userId];
      console.log(`Cleaned up image context for user ${userId} after error`);
    }
  }
}

/**
 * Actually talk to Sogni, get images, and process them into stickers.
 */
async function performGenerationAndSendStickers(prompt, batchSize, msg, messageOptions) {
  const chatId = msg.chat.id;

  try {
    const style = 'One big Sticker, thin white outline, cartoon, solid green screen background';
    const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
    const model = 'flux1-schnell-fp8';

    // Attempt up to 2 times if NSFW filter removes some images
    const allImages = [];
    const maxNsfwRetries = 2;
    for (let attempt = 1; attempt <= maxNsfwRetries; attempt++) {
      let project = await globalSogni.projects.create({
        type: 'image',
        tokenType: "spark",
        modelId: model,
        positivePrompt: prompt,
        negativePrompt: negativePrompt,
        stylePrompt: style,
        steps: 4,
        guidance: 1,
        numberOfMedia: batchSize,
        sampler: 'Euler',
        scheduler: 'linear',
        sizePreset: 'custom',
        width: 512,
        height: 512,
      });

      console.log(`Project created (attempt ${attempt}): ${project.id} for prompt: "${prompt}"`);
      const attemptImages = await project.waitForCompletion();
      console.log(`Project ${project.id} completed. Received ${attemptImages.length} images.`);

      if (attemptImages.length > 0) {
        allImages.push(...attemptImages);
      }
      if (allImages.length >= batchSize) {
        break;
      }
    }

    const images = allImages;
    if (images.length === 0) {
      msg.reply('No images were generated — possibly blocked by the NSFW filter. Please try a safer prompt!', messageOptions);
      return;
    }

    if (images.length < batchSize) {
      const removedCount = batchSize - images.length;
      bot.sendMessage(
        msg.chat.id,
        `We generated ${images.length} out of ${batchSize} image(s). ` +
          `${removedCount} was removed by the NSFW filter.`,
        messageOptions
      );
    }

    // Process images in sequence
    for (let i = 0; i < images.length; i++) {
      try {
        await Promise.race([
          processSingleImage(images[i], i, chatId, messageOptions),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Timeout exceeded: 1 minute for image #${i + 1}`));
            }, 60000);
          }),
        ]);
      } catch (error) {
        console.error(`Error or timeout during image #${i + 1}:`, error);
        bot.sendMessage(
          chatId,
          `Image #${i + 1} took too long or failed to process. Skipping it...`,
          messageOptions
        );
      }
    }

    if (!messageOptions.message_thread_id) {
      bot.sendMessage(chatId, 'Here you go! Right-click / long-press to save them!', messageOptions);
    }
  } catch (error) {
    // If invalid token
    if (
      error &&
      error.status === 401 &&
      error.payload &&
      error.payload.errorCode === 107
    ) {
      console.error('Detected invalid token, restarting process in 5 seconds...');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
      return;
    }

    // If WebSocket not connected
    if (error.message && error.message.includes('WebSocket not connected')) {
      console.error('Detected "WebSocket not connected" error, restarting in 5 seconds...');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
      return;
    }

    // If "Project not found"
    if (error.message && error.message.includes('Project not found')) {
      console.error('Detected "Project not found" error, restarting in 5 seconds...');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
      return;
    }

    if (error.message && error.message.includes('Insufficient funds')) {
      console.error(error.message);
      bot.sendMessage(chatId, 'Sorry stickerbot is out of funds. Please request to top up!', messageOptions);
      return;
    }

    console.error('Error performing generation:', error);
    bot.sendMessage(chatId, 'An error occurred during generation. Please try again later.', messageOptions);
  }
}

/**
 * Process a single image into a sticker:
 *  1. Download it
 *  2. Remove background
 *  3. Convert to sticker
 *  4. Send to chat
 */
async function processSingleImage(imageUrl, idx, chatId, threadOptions) {
  const filePath = `renders/telegram_${Date.now()}_${idx + 1}.png`;

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

/**
 * Generate a video using Sogni API
 */
async function performVideoGeneration(prompt, msg, messageOptions, imagePath = null) {
  const chatId = msg.chat.id;

  try {
    // Select the appropriate model based on whether we have an image
    const model = imagePath
      ? 'wan_v2.2-14b-fp8_i2v_lightx2v'  // Image-to-video model (speed variant)
      : 'wan_v2.2-14b-fp8_t2v_lightx2v'; // Text-to-video model (speed variant)

    const fps = 16;
    const frames = 80; // 5 seconds at 16fps = 80 frames

    const projectType = imagePath ? 'image-to-video' : 'text-to-video';
    console.log(`Creating ${projectType} project with model: ${model}, prompt: "${prompt}"`);

    const projectParams = {
      type: 'video',
      tokenType: "spark",
      modelId: model,
      positivePrompt: prompt,
      negativePrompt: 'low quality, blurry, distorted',
      stylePrompt: '',
      steps: 4,
      guidance: 7,
      numberOfMedia: 1,
      fps: fps,
      frames: frames,
      network: 'fast',
    };

    // Add reference image for image-to-video workflow
    if (imagePath) {
      console.log(`Processing reference image from ${imagePath}`);

      // Process the image to ensure valid dimensions (480-512, divisible by 2)
      const processedImage = await processImageForVideo(imagePath);

      projectParams.referenceImage = processedImage.buffer;
      projectParams.width = processedImage.width;
      projectParams.height = processedImage.height;

      console.log(`Reference image processed: ${processedImage.width}x${processedImage.height} (${processedImage.buffer.length} bytes)`);
      if (processedImage.wasResized) {
        console.log(`Image was resized for video compatibility`);
      }
    } else {
      // For text-to-video, use 512x512 for faster generation
      projectParams.width = 512;
      projectParams.height = 512;
      console.log('Using 512x512 for text-to-video (optimized for speed)');
    }

    let project = await globalSogni.projects.create(projectParams);

    console.log(`Video project created: ${project.id}`);
    const statusMessage = imagePath
      ? '🎬 Image-to-video project created, waiting for completion...'
      : 'Video project created, waiting for completion...';
    bot.sendMessage(chatId, statusMessage, messageOptions);

    const videos = await project.waitForCompletion();
    console.log(`Video project ${project.id} completed. Received ${videos.length} video(s).`);

    if (videos.length === 0) {
      bot.sendMessage(chatId, 'No video was generated. Please try a different prompt!', messageOptions);
      return;
    }

    // Download and send the video
    const videoUrl = videos[0];
    const videoFilePath = `renders/telegram_video_${Date.now()}.mp4`;

    await saveFile(videoFilePath, videoUrl);
    console.log(`Saved video to ${videoFilePath}`);

    // Send the video
    if (fs.existsSync(videoFilePath)) {
      await bot.sendVideo(chatId, fs.createReadStream(videoFilePath), messageOptions);
      bot.sendMessage(chatId, 'Here is your video!', messageOptions);
    } else {
      throw new Error(`Video file not found: ${videoFilePath}`);
    }

  } catch (error) {
    // Handle specific errors
    if (error && error.status === 401 && error.payload && error.payload.errorCode === 107) {
      console.error('Detected invalid token, restarting process in 5 seconds...');
      setTimeout(() => process.exit(1), 5000);
      return;
    }

    if (error.message && error.message.includes('WebSocket not connected')) {
      console.error('Detected "WebSocket not connected" error, restarting in 5 seconds...');
      setTimeout(() => process.exit(1), 5000);
      return;
    }

    if (error.message && error.message.includes('Insufficient funds')) {
      console.error(error.message);
      bot.sendMessage(chatId, 'Sorry, the bot is out of funds. Please request to top up!', messageOptions);
      return;
    }

    console.error('Error performing video generation:', error);
    bot.sendMessage(chatId, 'An error occurred during video generation. Please try again later.', messageOptions);
  }
}

module.exports = startTelegramBot;
