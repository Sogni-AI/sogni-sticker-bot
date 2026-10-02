require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { SogniClientWrapper, ClientEvent } = require('@sogni-ai/sogni-intelligence-client');
const { backoffDelay, sogniStatus, sogniRetryAfterMs } = require('./lib/backoff');

// Express app setup
const app = express();
const port = process.env.PORT || 3004;
const SOGNI_APP_SOURCE = process.env.SOGNI_APP_SOURCE || 'sogni-sticker-bot';

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

function withSogniSocketAppSource(socketEndpoint) {
  if (!socketEndpoint) return socketEndpoint;
  try {
    const url = new URL(socketEndpoint);
    url.searchParams.set('appSource', SOGNI_APP_SOURCE);
    return url.toString();
  } catch (error) {
    console.warn(`Could not attach Sogni socket appSource: ${error.message}`);
    return socketEndpoint;
  }
}

/**
 * Connect to the Sogni API, retrying in this process with a growing delay
 * (30 s doubling to 5 min, or Retry-After on a 429). Exiting on every failure
 * (as before) meant pm2 restarted us every few seconds: a fresh login each time
 * for as long as the error lasted. Rejected credentials still end the process.
 */
async function connectSogni() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await createSogniClient();
    } catch (error) {
      const status = sogniStatus(error);
      if (status === 401 || status === 403) throw error;
      const delay = (status === 429 && sogniRetryAfterMs(error)) || backoffDelay(attempt, { baseMs: 30 * 1000 });
      console.error(`Could not connect to Sogni (attempt ${attempt}${status ? `, HTTP ${status}` : ''}): ${error.message}. Retrying in ${Math.round(delay / 1000)} s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function createSogniClient() {
  let sogni;
  try {
    console.log('Attempting to create Sogni client wrapper instance...');

    sogni = new SogniClientWrapper({
      username: process.env.SOGNI_USERNAME,
      password: process.env.SOGNI_PASSWORD,
      appId: process.env.APP_ID,
      appSource: SOGNI_APP_SOURCE,
      network: 'fast',
      restEndpoint: process.env.REST_ENDPOINT,
      socketEndpoint: withSogniSocketAppSource(process.env.SOCKET_ENDPOINT),
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
    // Never leave a half-connected client behind to reconnect on its own.
    try {
      await sogni?.disconnect();
    } catch {
      /* already closed */
    }
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
    console.error('Exiting in 5 seconds...');
    setTimeout(() => process.exit(1), 5000);
  });
