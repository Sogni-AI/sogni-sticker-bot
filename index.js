require('dotenv').config();
const fs = require('fs');
const sogniPromise = require('./sogni');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const discordToken = process.env.DISCORD_BOT_TOKEN;

const express = require('express');

// Create an Express app
const app = express();

// Set the port (e.g., from .env or default to 3000)
const port = process.env.PORT || 3004;

// Add a simple heartbeat route
app.get('/heartbeat', (req, res) => {
  res.send('OK');
});

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

  app.listen(port, '0.0.0.0', () => {
    console.log(`Service is running and listening on 0.0.0.0:${port}`);
  });
}).catch((error) => {
  console.error('Error starting bots:', error);
  process.exit(1);
});
