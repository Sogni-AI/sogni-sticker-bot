require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { SogniClientWrapper, ClientEvent } = require('@sogni-ai/sogni-client-wrapper');

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
 * Connect to the Sogni API through the wrapper.
 * On startup failure, we log and exit so that an external process can restart us.
 */
async function connectSogni() {
  try {
    console.log('Attempting to create Sogni client wrapper instance...');

    const sogni = new SogniClientWrapper({
      username: process.env.SOGNI_USERNAME,
      password: process.env.SOGNI_PASSWORD,
      appId: process.env.APP_ID,
      network: 'fast',
      restEndpoint: process.env.REST_ENDPOINT,
      socketEndpoint: process.env.SOCKET_ENDPOINT,
      autoConnect: false,
    });

    sogni.on(ClientEvent.CONNECTED, () => {
      console.log('Connected to Sogni API');
    });

    sogni.on(ClientEvent.RECONNECTING, (attempt) => {
      console.warn(`Reconnecting to Sogni API (attempt ${attempt})...`);
    });

    sogni.on(ClientEvent.DISCONNECTED, () => {
      console.warn('Disconnected from Sogni API');
    });

    sogni.on(ClientEvent.ERROR, (error) => {
      console.error('Sogni client error:', error);
    });

    await sogni.connect();

    console.log('Sogni API client initialized successfully.');

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
  });
