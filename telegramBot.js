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
        bot.sendMessage(chatId, 'Good day! What would you like me to create a sticker of?');
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const userMessage = msg.text && msg.text.toLowerCase();

        if (!userMessage) {
            // If it is not a text message, ignore or let the user know.
            return;
        }

        if (userMessage.startsWith('hi') || userMessage.startsWith('hello')) {
            bot.sendMessage(chatId, `Hello, I am Sogni AI sticker bot! Type /start to get started!`);
        } else if (!userMessage.startsWith('/')) {
            if (pendingUsers.has(userId)) {
                // The user already has a pending request, let them know again (user experience improvement)
                bot.sendMessage(chatId, `You already have a pending request. Please wait until it's processed. Thank you for your patience!`);
                return;
            }

            // Add request to queue
            requestQueue.push({ userId, chatId, message: msg });
            pendingUsers.add(userId);
            console.log(`Received new request from userId: ${userId}, prompt: "${msg.text}". Queue length is now ${requestQueue.length}.`);

            if (isProcessing) {
                const positionInQueue = requestQueue.findIndex(req => req.userId === userId) + 1;
                bot.sendMessage(chatId, `Your request is queued. You are number ${positionInQueue} in the queue.`);
            } else {
                bot.sendMessage(chatId, `Generating stickers for: ${msg.text}`);
            }

            // Start processing queue if not already
            processNextRequest(sogni);
        }
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

        console.log(`Project created: ${project.id} for prompt: "${prompt}"`);

        const images = await project.waitForCompletion();
        console.log(`Project ${project.id} completed. Received ${images.length} images.`);

        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            const filePath = `renders/${project.id}_${i + 1}.png`;

            try {
                await saveFile(filePath, imageUrl);
                console.log(`Saved image to ${filePath}`);

                // Remove background from the image
                let stickerImage;
                try {
                    stickerImage = await removeImageBg(filePath);
                } catch (error) {
                    console.error('Error in removeImageBg:', error);
                    bot.sendMessage(chatId, 'An error occurred while removing the background. Please try again.');
                    continue;
                }

                const bgRemovedFilePath = filePath.replace('.png', '_nobg.png');
                await stickerImage.writeAsync(bgRemovedFilePath);
                console.log(`Saved background-removed image to ${bgRemovedFilePath}`);

                // Convert the background-removed image to sticker
                let stickerFilePath;
                try {
                    stickerFilePath = await convertImageToSticker(bgRemovedFilePath);
                    console.log('Generated sticker file path:', stickerFilePath);
                } catch (conversionError) {
                    console.error('Error converting image to sticker:', conversionError);
                    bot.sendMessage(chatId, 'Failed to convert to sticker. Please try again.');
                    continue;
                }

                if (fs.existsSync(stickerFilePath)) {
                    await bot.sendSticker(chatId, fs.createReadStream(stickerFilePath));
                } else {
                    console.error('File not found:', stickerFilePath);
                    bot.sendMessage(chatId, 'Failed to find the generated sticker. Please try again.');
                }

                // Optionally clean up files if no longer needed:
                // fs.unlinkSync(filePath);
                // fs.unlinkSync(bgRemovedFilePath);
                // fs.unlinkSync(stickerFilePath);
            } catch (downloadError) {
                console.error('Error during image download or processing:', downloadError);
                bot.sendMessage(chatId, 'An error occurred while preparing your sticker. Please try again later.');
            }
        }

        bot.sendMessage(chatId, 'Here you go! Right-click / long press to save them!');
    } catch (error) {
        console.error('Error processing request:', error);
        bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again.');
    } finally {
        pendingUsers.delete(userId);
        isProcessing = false;
        console.log(`Finished processing for userId: ${userId}. Queue length is now ${requestQueue.length}.`);
        processNextRequest(sogni);
    }
}

module.exports = startTelegramBot;
