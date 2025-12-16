// discordBot.js
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');

// Load the Discord token from the environment variables
const token = process.env.DISCORD_BOT_TOKEN;

// Video rate limiting
const VIDEO_RATE_LIMIT_PATH = path.join(__dirname, 'videoRateLimitDiscord.json');
const MAX_VIDEOS_PER_DAY = 3;

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
  console.log(`[Discord Video Counter] User: ${username} | Used: ${rateLimits[username].count}/${MAX_VIDEOS_PER_DAY} | Remaining: ${remaining} | Date: ${today}`);

  return remaining;
}

// Exponential backoff for Discord
let discordRetryCount = 0;
const discordMaxRetries = 1000;
const baseDelayMs = 1000; // 1 second initial delay

function exponentialReconnect(client) {
  if (discordRetryCount >= discordMaxRetries) {
    console.error('Max Discord reconnect attempts reached. Exiting in 5s...');
    setTimeout(() => process.exit(1), 5000);
    return;
  }

  const backoffTime = Math.pow(2, discordRetryCount) * baseDelayMs;
  discordRetryCount++;
  console.warn(`Attempting to reconnect to Discord in ${backoffTime / 1000}s (attempt #${discordRetryCount})...`);

  setTimeout(() => {
    // If you want to fully rebuild the client:
    client.destroy();

    // Create a new client instance
    const newClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    attachEventListeners(newClient);

    newClient.login(token).catch((err) => {
      console.error('Error logging in to Discord on reconnect attempt:', err);
      exponentialReconnect(newClient);
    });
  }, backoffTime);
}

function attachEventListeners(client) {
  client.on('warn', console.warn);

  // Handle unknown connection issues or timeouts:
  client.on('error', (error) => {
    console.error('Discord client error:', error);
    // Attempt exponential backoff reconnect
    exponentialReconnect(client);
  });

  client.on('ready', () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    // Reset retry count after a successful login
    discordRetryCount = 0;
  });

  client.on('guildCreate', (guild) => {
    console.log(`Joined a new guild: ${guild.name}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '!';
    const userMessage = message.content.trim();

    if (!userMessage.startsWith(prefix)) {
      // Ignore messages that don't start with the prefix
      return;
    }

    const args = userMessage.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const userId = message.author.id;

    // ---- Handle commands ----
    if (command === 'start') {
      message.channel.send(
        'Good day! I can create stickers and videos for you!\n\n' +
          'Use `!generate [your prompt]` or `!imagine [your prompt]` to create stickers.\n' +
          'Use `!video [your prompt]` to create a 5 second video.\n\n' +
          'Type `!help` to see all available commands.'
      );
    }
    else if (command === 'help') {
      message.channel.send(
        'Available commands:\n' +
          '`!start` - Start interaction with the bot.\n' +
          '`!generate [prompt]` - Generate stickers.\n' +
          '`!imagine [prompt]` - Same as !generate.\n' +
          '`!video [prompt]` - Generate a 5 second video.\n' +
          '`!repeat` - Generate more images with your last prompt.\n' +
          '`!help` - Show this help message.'
      );
    }
    // ----- Updated line below: now we check if command is 'generate' OR 'imagine' -----
    else if (command === 'generate' || command === 'imagine') {
      const prompt = args.join(' ');
      if (!prompt) {
        message.channel.send(
          'Please provide a prompt. Usage: `!generate [your prompt]` or `!imagine [your prompt]`.'
        );
        return;
      }

      if (pendingUsers.has(userId)) {
        message.channel.send('You already have a pending request. Please wait until it’s processed.');
        return;
      }

      // Save last prompt for this user
      lastPromptByUser[userId] = prompt;

      // Queue request
      requestQueue.push({ userId, channel: message.channel, prompt });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        message.channel.send(`Your request is queued. You are number ${positionInQueue} in the queue.`);
      } else {
        message.channel.send(`Generating images for: ${prompt}`);
      }

      processNextRequest(sogniRef);
    }
    else if (command === 'video') {
      const prompt = args.join(' ');
      if (!prompt) {
        message.channel.send('Please provide a prompt. Usage: `!video [your prompt]`.');
        return;
      }

      if (pendingUsers.has(userId)) {
        message.channel.send('You already have a pending request. Please wait until it\'s processed.');
        return;
      }

      // Check rate limit using username
      const username = message.author.username || `user_${message.author.id}`;
      const { allowed, remaining } = checkVideoRateLimit(username);

      if (!allowed) {
        message.channel.send(`You've reached your daily limit of ${MAX_VIDEOS_PER_DAY} videos. Please try again tomorrow (resets at UTC midnight).`);
        return;
      }

      // Increment the count
      const remainingAfter = incrementVideoCount(username);

      // Queue video request
      requestQueue.push({ userId, channel: message.channel, prompt, isVideo: true, username });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        const totalInQueue = requestQueue.length;
        message.channel.send(
          `Your video request has been queued! You are position ${positionInQueue} of ${totalInQueue} in the queue.\n` +
          `Your video will be generated once the previous one completes.\n\n` +
          `You have ${remainingAfter} video${remainingAfter === 1 ? '' : 's'} left today!`
        );
      } else {
        message.channel.send(`Generating 5 second video for: ${prompt}\n(This can take up to 5 minutes)\n\nYou have ${remainingAfter} video${remainingAfter === 1 ? '' : 's'} left today!`);
      }

      processNextRequest(sogniRef);
    }
    else if (command === 'repeat') {
      // Use the last prompt
      const lastPrompt = lastPromptByUser[userId];
      if (!lastPrompt) {
        message.channel.send('No last prompt found. Please use `!generate [your prompt]` first.');
        return;
      }

      if (pendingUsers.has(userId)) {
        message.channel.send('You already have a pending request. Please wait until it\'s processed.');
        return;
      }

      requestQueue.push({ userId, channel: message.channel, prompt: lastPrompt });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        message.channel.send(`Your repeat request is queued. You are number ${positionInQueue} in the queue.`);
      } else {
        message.channel.send(`Generating images for: ${lastPrompt} [repeat]`);
      }

      processNextRequest(sogniRef);
    }
    else {
      message.channel.send('Unknown command. Use `!help` to see available commands.');
    }
  });
}

// Queue logic
const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;
const lastPromptByUser = {};
let sogniRef = null; // store sogni globally in this module

//Start the Discord Bot
function startDiscordBot(sogni) {
  sogniRef = sogni; // store reference for processNextRequest

  // Create the initial client
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  attachEventListeners(client);

  console.log('Logging in to Discord...');
  client.login(token).catch((err) => {
    console.error('Initial Discord login error:', err);
    exponentialReconnect(client);
  });
}

/**
 * Process the next request in the queue
 */
async function processNextRequest(sogni) {
  if (isProcessing) return;
  if (requestQueue.length === 0) return;

  isProcessing = true;

  const { userId, channel, prompt, isVideo } = requestQueue.shift();

  // If this is a video request, handle it separately
  if (isVideo) {
    await handleVideoRequest(sogni, channel, prompt, userId);
    return;
  }

  // Wrap main request logic
  const handleRequest = async () => {
    // We’ll use the same prompt each attempt if the NSFW filter zeroes out
    const style = 'One big Sticker, thin white outline, cartoon, solid green screen background';
    const negativePrompt =
      'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
    const model = 'flux1-schnell-fp8';
    const batchSize = 1; // Discord set to 1 by default here

    let images = [];
    const maxNsfwRetries = 2;

    for (let attempt = 1; attempt <= maxNsfwRetries; attempt++) {
      // Create the project
      let project = await sogni.projects.create({
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
      });

      if (attempt > 1) {
        channel.send(`**Attempt ${attempt}**: Generating...`);
      } else {
        //channel.send(`Generating...`);
      }

      images = await project.waitForCompletion();

      if (images.length === 0 && attempt < maxNsfwRetries) {
        channel.send('No images generated — possibly NSFW filter false positive. Retrying...');
        continue;
      } else {
        break; // we either have images or we’re at final attempt
      }
    }

    // If 0 images returned after all attempts, truly blocked by NSFW
    if (images.length === 0) {
      channel.send('No images were generated (NSFW filter). Please try a safer prompt!');
      return;
    }

    // If fewer images returned, some were removed by NSFW filter
    if (images.length < batchSize) {
      const removedCount = batchSize - images.length;
      channel.send(
        `Generated ${images.length} out of ${batchSize} image(s). ` +
          `${removedCount} was removed by the NSFW filter.`
      );
    }

    // For each image, remove background and send to Discord
    for (let i = 0; i < images.length; i++) {
      await processImage(images[i], channel, i);
    }

    channel.send('Here you go! Right-click / long press to save them!');
  };

  try {
    // Race main request against a 30-second timeout
    await Promise.race([
      handleRequest(),
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error('Timeout exceeded: 30s'));
        }, 30000)
      ),
    ]);
  } catch (error) {
    console.error('Error or timeout processing request:', error);
    channel.send('Your request took too long (over 30 seconds) and was canceled. Please try again.');
  } finally {
    pendingUsers.delete(userId);
    isProcessing = false;
    processNextRequest(sogni);
  }
}

/**
 * processImage:
 *  - Saves the image
 *  - Removes background
 *  - Sends the result in Discord
 */
async function processImage(imageUrl, channel, idx) {
  try {
    const filePath = path.join(__dirname, 'renders', `discord_${Date.now()}_${idx + 1}.png`);

    // Save the image file
    await saveFile(filePath, imageUrl);

    // Remove background from the image
    let stickerImage;
    try {
      stickerImage = await removeImageBg(filePath);
    } catch (error) {
      console.error('Error in removeImageBg:', error);
      channel.send('An error occurred while removing the background from an image. Skipping this one.');
      return;
    }

    // Get image buffer from Jimp object
    const imageBuffer = await stickerImage.getBufferAsync('image/png');

    // Create an attachment from the buffer
    const attachment = new AttachmentBuilder(imageBuffer, { name: `sogni_sticker_${idx + 1}.png` });

    // Send the attachment
    await channel.send({ files: [attachment] });
  } catch (err) {
    console.error('Error processing image:', err);
    channel.send('Error occurred while processing an image. Skipping...');
  }
}

/**
 * Handle video generation request for Discord
 */
async function handleVideoRequest(sogni, channel, prompt, userId) {
  const performVideoGeneration = async () => {
    const model = 'wan_v2.2-14b-fp8_t2v'; // Text-to-video model
    const fps = 16;
    const frames = 80; // 5 seconds at 16fps = 80 frames

    console.log(`Creating video project with prompt: "${prompt}"`);

    let project = await sogni.projects.create({
      type: 'video',
      tokenType: "spark",
      modelId: model,
      positivePrompt: prompt,
      negativePrompt: 'low quality, blurry, distorted',
      stylePrompt: '',
      steps: 20,
      guidance: 7,
      numberOfMedia: 1,
      fps: fps,
      frames: frames,
      network: 'fast',
    });

    console.log(`Video project created: ${project.id}`);
    channel.send('Video project created, waiting for completion...');

    const videos = await project.waitForCompletion();
    console.log(`Video project ${project.id} completed. Received ${videos.length} video(s).`);

    if (videos.length === 0) {
      channel.send('No video was generated. Please try a different prompt!');
      return;
    }

    // Download and send the video
    const videoUrl = videos[0];
    const videoFilePath = path.join(__dirname, 'renders', `discord_video_${Date.now()}.mp4`);

    await saveFile(videoFilePath, videoUrl);
    console.log(`Saved video to ${videoFilePath}`);

    // Send the video as an attachment
    if (fs.existsSync(videoFilePath)) {
      const attachment = new AttachmentBuilder(videoFilePath, { name: 'sogni_video.mp4' });
      await channel.send({ files: [attachment] });
      channel.send('Here is your video!');
    } else {
      throw new Error(`Video file not found: ${videoFilePath}`);
    }
  };

  try {
    // Race video generation against a 6-minute timeout (can take up to 5 minutes)
    await Promise.race([
      performVideoGeneration(),
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error('Timeout exceeded: 6 minutes'));
        }, 360000)
      ),
    ]);
  } catch (error) {
    console.error('Error or timeout performing video generation:', error);
    channel.send('Your video request took too long (over 6 minutes) or encountered an error. Please try again.');
  } finally {
    pendingUsers.delete(userId);
    isProcessing = false;
    processNextRequest(sogni);
  }
}

module.exports = startDiscordBot;
