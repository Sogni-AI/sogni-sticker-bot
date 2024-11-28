const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const saveFile = require('./lib/saveFile');
const removeImageBg = require('./lib/removeImageBgOriginal');
const path = require('path');

// Load the Discord token from the .env file
const token = process.env.DISCORD_BOT_TOKEN;

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('debug', console.log);
client.on('warn', console.warn);
client.on('error', console.error);

const requestQueue = [];
const pendingUsers = new Set();
let isProcessing = false;

const startDiscordBot = (sogni) => {
    client.once('ready', () => {
      console.log(`Discord bot logged in as ${client.user.tag}`);

      console.log('client.guilds', client.guilds);
      client.guilds.cache.forEach(guild => console.log('guilds:', guild.name, guild.id));
    });

    client.on('guildCreate', guild => {
      console.log(`Joined a new guild: ${guild.name}`);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const userId = message.author.id;
        const userMessage = message.content.toLowerCase();

        if (userMessage.startsWith('!start')) {
            message.channel.send('Good day! What would you like me to create an image of?');
        } else if (!userMessage.startsWith('!')) {
            if (pendingUsers.has(userId)) {
                message.channel.send('You already have a pending request. Please wait until it’s processed.');
                return;
            }

            requestQueue.push({ userId, channel: message.channel, message });
            pendingUsers.add(userId);

            if (isProcessing) {
                const positionInQueue = requestQueue.findIndex(req => req.userId === userId) + 1;
                message.channel.send(`Your request is queued. You are number ${positionInQueue} in the queue.`);
            } else {
                message.channel.send(`Generating images for: ${message.content}`);
            }

            processNextRequest(sogni);
        }
    });

    client.login(token);
};

async function processNextRequest(sogni) {
    if (isProcessing) return;
    if (requestQueue.length === 0) return;

    isProcessing = true;

    const { userId, channel, message } = requestQueue.shift();

    try {
      const prompt = message.content;
        const style = 'One big Sticker, thin white outline, cartoon, greenscreen background';
        const negativePrompt = 'Pencil, pen, hands, malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark';
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
            timeStepSpacing: 'Linear'
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
