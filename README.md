# Sogni Sticker Bot

Sogni Sticker Bot is a Telegram bot that transforms your text prompts into custom stickers using advanced AI image generation techniques. Whether you're looking to create personalized stickers for your chats or want to add a creative flair to your conversations, Sogni Sticker Bot has got you covered!

## Features

- **AI-Powered Sticker Generation**: Converts your text prompts into unique and high-quality stickers.
- **Queue Management**: Handles multiple requests efficiently with a request queue and user-specific pending states.
- **Error Handling & Retry Logic**: Ensures reliability with robust error handling and exponential backoff for polling errors.
- **Image Processing**: Utilizes Jimp and Sharp for image manipulation and optimization, ensuring stickers meet Telegram's requirements.
- **Green Screen Background Removal**: Automatically removes green screen backgrounds to create transparent stickers.
- **Multiple Formats Support**: Generates stickers in both PNG and WEBP formats, optimized for Telegram.

## 📦 Installation

- npm install
- create `.env` file and fill out `TELEGRAM_BOT_TOKEN=`. You need to talk to botfather on Telegram to get a new token.

### Prerequisites

- [Node.js](https://nodejs.org/en/) v14 or higher
- [npm](https://www.npmjs.com/) v6 or higher
- A Telegram account

