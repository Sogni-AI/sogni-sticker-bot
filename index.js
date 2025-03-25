require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { SogniClient } = require('@sogni-ai/sogni-client');

// Exponential backoff settings
let sogniRetryCount = 0;            // How many times we've retried Sogni so far
const sogniMaxRetries = 1000;       // Increase if you want more attempts
const sogniBaseDelayMs = 1000;      // First attempt delay in ms (gets doubled)

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

// Exponential Backoff Connection to Sogni
async function connectWithBackoff() {
  try {
    console.log(`Attempting to create SogniClient instance (attempt #${sogniRetryCount + 1})...`);

    const sogni = await SogniClient.createInstance({
      appId: process.env.APP_ID,
      testnet: true,
      network: 'fast',
      restEndpoint: process.env.REST_ENDPOINT,
      socketEndpoint: process.env.SOCKET_ENDPOINT,
    });

    // If we got here, it means we connected successfully.
    console.log('Sogni API client initialized successfully.');

    // Reset the retry count on successful connect
    sogniRetryCount = 0;

    // Attach event listeners
    sogni.apiClient.on('connected', () => {
      console.log('Connected to Sogni API');
    });

    sogni.apiClient.on('disconnected', ({ code, reason }) => {
      console.error('Disconnected from Sogni API', code, reason);
      console.log('Attempting to reconnect to Sogni with exponential backoff...');
      attemptReconnect();
    });

    // Attempt to login
    await sogni.account.login(process.env.SOGNI_USERNAME, process.env.SOGNI_PASSWORD);

    return sogni;
  } catch (error) {
    console.error('Error initializing Sogni API client:', error);

    // If we have not exceeded max retries, schedule another attempt
    if (sogniRetryCount < sogniMaxRetries) {
      attemptReconnect();
    } else {
      console.error(`Max Sogni retries (${sogniMaxRetries}) reached. Exiting...`);
      setTimeout(() => process.exit(1), 5000);
    }
    // Throw so that the caller sees the error
    throw error;
  }
}

// Helper to schedule the next reconnection
function attemptReconnect() {
  sogniRetryCount++;
  // Exponential backoff, but cap it so we don't reach Infinity
  const rawBackoff = Math.pow(2, sogniRetryCount) * sogniBaseDelayMs;
  // Example: cap at 1 hour
  const maxBackoffMs = 60 * 60 * 1000;
  const backoffTime = Math.min(rawBackoff, maxBackoffMs);

  console.log(`Reconnecting to Sogni in ${backoffTime / 1000} seconds... (attempt #${sogniRetryCount + 1})`);

  setTimeout(() => {
    connectWithBackoff().catch(() => {
      // If it fails again, the function itself will repeat or exit.
    });
  }, backoffTime);
}

// Main Startup
connectWithBackoff()
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
    // We either exit now or let the backoff continue. The above logic handles retry,
    // so typically we do not exit here.
  });
