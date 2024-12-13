require('dotenv').config();
const fs = require('fs');
const sogniPromise = require('./sogni');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const discordToken = process.env.DISCORD_BOT_TOKEN;

if (!telegramToken && !discordToken) {
  console.error('Error: No bot tokens provided');
  process.exit(1);
}

fs.mkdir('renders', { recursive: true }, (err) => {
  if (err) throw err;
});

sogniPromise.then((sogni) => {
  if (telegramToken) {
    console.log('Starting Telegram bot...');
    const startTelegramBot = require('./telegramBot');
    startTelegramBot(sogni);
  }

  if (discordToken) {
    console.log('Starting Discord bot...');
    const startDiscordBot = require('./discordBot');
    startDiscordBot(sogni);
  }
}).catch((error) => {
  console.error('Error starting bots:', error);
  process.exit(1);
});
