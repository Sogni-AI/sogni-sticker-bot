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

//client.on('debug', console.log);
client.on('warn', console.warn);
client.on('error', console.error);

const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;

const startDiscordBot = (sogni) => {
  client.once('ready', () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);

    console.log('client.guilds', client.guilds);
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

    if (command === 'start') {
      message.channel.send('Good day! Use `!generate [your prompt]` to create an image.');
    } else if (command === 'generate') {
      const prompt = args.join(' ');
      if (!prompt) {
        message.channel.send('Please provide a prompt. Usage: `!generate [your prompt]`');
        return;
      }

      if (pendingUsers.has(userId)) {
        message.channel.send('You already have a pending request. Please wait until it’s processed.');
        return;
      }

      requestQueue.push({ userId, channel: message.channel, prompt });
      pendingUsers.add(userId);

      if (isProcessing) {
        const positionInQueue = requestQueue.findIndex((req) => req.userId === userId) + 1;
        message.channel.send(`Your request is queued. You are number ${positionInQueue} in the queue.`);
      } else {
        message.channel.send(`Generating images for: ${prompt}`);
      }

      processNextRequest(sogni);
    } else if (command === 'help') {
      message.channel.send(
        'Available commands:\n' +
          '`!start` - Start interaction with the bot.\n' +
          '`!generate [prompt]` - Generate an image.\n' +
          '`!help` - Show this help message.'
      );
    } else {
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

  try {
    const style = 'One big Sticker, thin white outline, cartoon, grey solid background';
    const negativePrompt =
      'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
    const model = 'flux1-schnell-fp8';
    const batchSize = 1;

    const project = await sogni.projects.create({
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

    const images = await project.waitForCompletion();

    for (let i = 0; i < images.length; i++) {
      const imageUrl = images[i];
      const filePath = path.join(__dirname, 'renders', `${project.id}_${i + 1}.png`);

      // Save the image file
      await saveFile(filePath, imageUrl);

      // Remove background from the image
      let stickerImage;
      try {
        stickerImage = await removeImageBg(filePath);
      } catch (error) {
        console.error('Error in removeImageBg:', error);
        channel.send('An error occurred while removing the background. Please try again.');
        continue;
      }

      // Get image buffer from Jimp object
      const imageBuffer = await stickerImage.getBufferAsync('image/png');

      // Create an attachment from the buffer
      const attachment = new AttachmentBuilder(imageBuffer, { name: `sogni_sticker_${i + 1}.png` });

      // Send the attachment
      await channel.send({ files: [attachment] });
    }

    channel.send('Here you go! Right-click / long press to save them!');
  } catch (error) {
    console.error('Error processing request:', error);
    channel.send('An error occurred while processing your request. Please try again.');
  } finally {
    pendingUsers.delete(userId);
    isProcessing = false;
    processNextRequest(sogni);
  }
}

module.exports = startDiscordBot;
