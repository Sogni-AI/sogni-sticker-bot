require('dotenv').config();
const fs = require('fs');
require('dotenv').config();

// Check for required environment variables
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const discordToken = process.env.DISCORD_BOT_TOKEN;

if (!telegramToken && !discordToken) {
    console.error('Error: Neither TELEGRAM_BOT_TOKEN nor DISCORD_BOT_TOKEN is set in the environment.');
    process.exit(1); // Exit the process if no bot tokens are set
}

const sogniPromise = require('./sogni');
let startTelegramBot, startDiscordBot;

// Load Telegram bot only if its token is set
if (telegramToken) {
    console.log('Loading Telegram bot...');
    startTelegramBot = require('./telegramBot');
}

// Load Discord bot only if its token is set
if (discordToken) {
    console.log('Loading Discord bot...');
    startDiscordBot = require('./discordBot');
}

// Check if renders folder exists
fs.mkdir('renders', { recursive: true }, (err) => {
    if (err) throw err;
});

// Start the bots once the Sogni API client is initialized
sogniPromise.then((sogni) => {
    if (telegramToken) {
        console.log('Starting Telegram bot...');
        startTelegramBot(sogni);
    }

    if (discordToken) {
        console.log('Starting Discord bot...');
        startDiscordBot(sogni);
    }
});
