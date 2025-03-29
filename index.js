require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { SogniClient } = require('@sogni-ai/sogni-client');

// Express app setup
const app = express();
const port = process.env.PORT || 3004;

// Simple heartbeat route for uptime monitoring
app.get('/heartbeat', (req, res) => {
  res.send('OK');
});

// Create output directory for renders
fs.mkdir('renders', { recursive: true }, (err) => {
  if (err) throw err;
});

// Telegram & Discord Tokens
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const discordToken = process.env.DISCORD_BOT_TOKEN;

if (!telegramToken && !discordToken) {
  console.error('Error: No bot tokens provided');
  process.exit(1);
}

/**
 * Connect to the Sogni API.
 * On error, we log and exit so that an external process (e.g. PM2) can restart us.
 */
async function connectSogni() {
  try {
    console.log('Attempting to create SogniClient instance...');

    const sogni = await SogniClient.createInstance({
      appId: process.env.APP_ID,
      testnet: true,
      network: 'fast',
      restEndpoint: process.env.REST_ENDPOINT,
      socketEndpoint: process.env.SOCKET_ENDPOINT,
    });

    console.log('Sogni API client initialized successfully.');

    // Attach event listeners
    sogni.apiClient.on('connected', () => {
      console.log('Connected to Sogni API');
    });

    sogni.apiClient.on('disconnected', ({ code, reason }) => {
      console.error('Disconnected from Sogni API', code, reason);
      console.log('Restarting process in 5 seconds...');
      setTimeout(() => process.exit(1), 5000);
    });

    // Attempt to login
    await sogni.account.login(process.env.SOGNI_USERNAME, process.env.SOGNI_PASSWORD);

    return sogni;
  } catch (error) {
    console.error('Error initializing Sogni API client:', error);
    console.error('Exiting in 5 seconds...');
    setTimeout(() => process.exit(1), 5000);
    throw error;
  }
}

// Main Startup
connectSogni()
  .then((sogni) => {
    // Once Sogni is connected, we can start our bots.
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

    // Finally start the Express server
    app.listen(port, '0.0.0.0', () => {
      console.log(`Service is running and listening on 0.0.0.0:${port}`);
    });
  })
  .catch((err) => {
    console.error('Could not start up fully due to Sogni initialization error:', err);
    // We rely on the setTimeout+exit inside connectSogni or here
  });
