require('dotenv').config();
const { SogniClient } = require('@sogni-ai/sogni-client');

const sogniPromise = SogniClient.createInstance({
  appId: process.env.APP_ID,
  restEndpoint: 'https://api.sogni.ai',
  socketEndpoint: 'https://socket.sogni.ai',
  testnet: true,
  network: 'fast'
})
.then(async (sogni) => {
  console.log('Sogni API client initialized');

  sogni.apiClient.on('connected', () => {
    console.log('Connected to Sogni API');
  });

  sogni.apiClient.on('disconnected', ({ code, reason }) => {
    console.error('Disconnected from Sogni API', code, reason);
    process.exit(1); // Force exit so PM2 restarts
  });

  await sogni.account.login(process.env.SOGNI_USERNAME, process.env.SOGNI_PASSWORD);
  return sogni;
})
.catch((error) => {
  console.error('Error initializing Sogni API client', error);
  process.exit(1);
});

module.exports = sogniPromise;
