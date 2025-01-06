// discordBot.js
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');

// Load the Discord token from the environment variables
const token = process.env.DISCORD_BOT_TOKEN;

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('warn', console.warn);
client.on('error', console.error);

const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;

// Keep track of each user's last prompt so we can handle "!repeat"
const lastPromptByUser = {};

/**
 * Start the Discord Bot
 * @param sogni
 */
const startDiscordBot = (sogni) => {
  client.once('ready', () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    client.guilds.cache.forEach((guild) => console.log('guilds:', guild.name, guild.id));
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
      message.channel.send('Good day! Use `!generate [your prompt]` to create an image.');
    }
    else if (command === 'help') {
      message.channel.send(
        'Available commands:\n' +
          '`!start` - Start interaction with the bot.\n' +
          '`!generate [prompt]` - Generate images.\n' +
          '`!repeat` - Generate more images with your last prompt.\n' +
          '`!help` - Show this help message.'
      );
    }
    else if (command === 'generate') {
      const prompt = args.join(' ');
      if (!prompt) {
        message.channel.send('Please provide a prompt. Usage: `!generate [your prompt]`');
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

      processNextRequest(sogni);
    }
    else if (command === 'repeat') {
      // Use the last prompt
      const lastPrompt = lastPromptByUser[userId];
      if (!lastPrompt) {
        message.channel.send('No last prompt found. Please use `!generate [your prompt]` first.');
        return;
      }

      if (pendingUsers.has(userId)) {
        message.channel.send('You already have a pending request. Please wait until it’s processed.');
        return;
      }

      requestQueue.push({ userId, channel: message.channel, prompt: lastPrompt });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        message.channel.send(`Your repeat request is queued. You are number ${positionInQueue} in the queue.`);
      } else {
        message.channel.send(`Generating images for (repeat): ${lastPrompt}`);
      }

      processNextRequest(sogni);
    }
    else {
      message.channel.send('Unknown command. Use `!help` to see available commands.');
    }
  });

  client.login(token);
};

async function processNextRequest(sogni) {
  if (isProcessing) return;
  if (requestQueue.length === 0) return;

  isProcessing = true;

  const { userId, channel, prompt } = requestQueue.shift();

  // Wrap main request logic
  const handleRequest = async () => {
    // We’ll use the same prompt each attempt if the NSFW filter zeroes out
    const style = 'One big Sticker, thin white outline, cartoon, solid green screen background';
    const negativePrompt =
      'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
    const model = 'flux1-schnell-fp8';
    const batchSize = 1;

    let images = [];
    const maxNsfwRetries = 2;

    for (let attempt = 1; attempt <= maxNsfwRetries; attempt++) {
      // Create the project
      let project = await sogni.projects.create({
        modelId: model,
        positivePrompt: prompt,
        negativePrompt: negativePrompt,
        stylePrompt: style,
        steps: 4,
        guidance: 1,
        numberOfImages: batchSize,
        scheduler: 'Euler',
        timeStepSpacing: 'Linear',
      });

      channel.send(`**Attempt ${attempt}**: Generating...`);
      images = await project.waitForCompletion();

      if (images.length === 0 && attempt < maxNsfwRetries) {
        channel.send(
          'No images generated — possibly NSFW filter false positive. Retrying...'
        );
        continue;
      } else {
        break; // we either have images or we’re at the final attempt
      }
    }

    // If 0 images returned after all attempts, truly blocked by NSFW
    if (images.length === 0) {
      channel.send(
        'No images were generated (NSFW filter). Please try a safer prompt!'
      );
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

module.exports = startDiscordBot;
