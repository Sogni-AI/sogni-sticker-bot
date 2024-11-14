const fs = require('fs');
const sogniPromise = require('./sogni');
const startTelegramBot = require('./telegramBot');
//Check if renders folder exists
fs.mkdir('renders', { recursive: true }, (err) => {
    if (err) throw err;
});

// Start the Telegram bot once the Sogni API client is initialized
sogniPromise.then((sogni)=>{
    startTelegramBot(sogni);
})
