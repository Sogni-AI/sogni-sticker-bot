// telegramBot.js
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

    bot.on('polling_error', handlePollingError);
};

function handlePollingError(error) {
    console.error('Polling error:', error);

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
            startTelegramBot(true);
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

    try {
        const prompt = message.text;
        const style = 'One big Sticker, thin white outline, cartoon, solid green screen background';
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

        const images = await project.waitForCompletion();

        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            const filePath = `renders/${project.id}_${i + 1}.png`;

            // Save the image file
            await saveFile(filePath, imageUrl);

            // Remove background from the image
            let stickerImage;
            try {
                stickerImage = await removeImageBg(filePath);
            } catch (error) {
                console.error('Error in removeImageBg:', error);
                bot.sendMessage(chatId, 'An error occurred while removing the background. Please try again.');
                continue;
            }

            // Save the background-removed image to a new file
            const bgRemovedFilePath = filePath.replace('.png', '_nobg.png');
            await stickerImage.writeAsync(bgRemovedFilePath);

            // Convert the background-removed image to sticker
            const stickerFilePath = await convertImageToSticker(bgRemovedFilePath);

            if (fs.existsSync(stickerFilePath)) {
                console.log('Generated sticker file path:', stickerFilePath);
                await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath));
            } else {
                console.error('File not found:', stickerFilePath);
                bot.sendMessage(chatId, 'Failed to find the generated sticker. Please try again.');
            }
        }

        bot.sendMessage(chatId, 'Here you go! Right-click / long press to save them!');
    } catch (error) {
        console.error('Error processing request:', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again.');
    } finally {
        pendingUsers.delete(userId);
        isProcessing = false;
        processNextRequest(sogni);
    }
}

module.exports = startTelegramBot;
