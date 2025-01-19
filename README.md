
# Sogni AI Sticker Bot

A battle-tested Telegram and Discord bot for generating AI-powered stickers, **powered by [Sogni Supernet](https://www.sogni.ai/supernet)**. This bot will generate images on-demand and convert them into stickers you can easily share.

## Sample Stickers

This bot can generate fun, unique stickers via chat prompt:

<img src="https://raw.githubusercontent.com/Sogni-AI/sogni-sticker-bot/main/assets/example-prompt.jpg" alt="Chat prompt example" width="600"/>

*Chat prompt example*

<img src="https://raw.githubusercontent.com/Sogni-AI/sogni-sticker-bot/main/assets/example-stickers.jpg" alt="Sticker examples" width="600"/>

*Sticker examples*

## How It Works

1. Users type a command (`!generate <prompt>`) in your Telegram/Discord server or DM.  
2. The bot connects to **Sogni Supernet** to create AI-generated images.  
3. The images are automatically processed (background removed, etc.) and then returned as stickers!

### Why Sogni?

[Sogni.ai](https://www.sogni.ai) is an all-in-one AI toolkit that harnesses a high-speed and extremely scalable “Supernet” dedicated to creative AI tasks. By using Sogni, you get:

- Fast, cheap, on-demand image generation.
- Built-in NSFW filtering and safety checks.
- Cross-platform usage (web, mobile, Mac, iOS) with a single account.
- A robust environment that supports concurrency and stable performance.

You’ll need **a free Sogni username and password** to use this bot. You can create an account:

- In the **Sogni Mac** or **iOS** app, or  
- At the **[Sogni Web App](https://app.sogni.ai/)** (click “Sign Up”)

---

## Running Your Own Bot

This bot can run in two modes at once (Telegram and/or Discord). If you only want to run one platform, that’s fine too—just add the corresponding token(s) in the .env. described below.

### 1. Clone or Download

```
git clone https://github.com/your-user/sogni-sticker-bot.git
cd sogni-sticker-bot
```

### 2. Install Dependencies

```
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file (or use environment variables in your hosting platform) with the following:

```bash
TELEGRAM_BOT_TOKEN=xxx
DISCORD_BOT_TOKEN=yyy

SOGNI_USERNAME=mySogniUsername
SOGNI_PASSWORD=mySogniPassword

APP_ID=stickerbot
```

- **TELEGRAM_BOT_TOKEN**: Provided by [@BotFather](https://t.me/BotFather) after creating a Telegram bot.  
- **DISCORD_BOT_TOKEN**: Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications), then copy the bot token.  
- **SOGNI_USERNAME** & **SOGNI_PASSWORD**: Your free Sogni account credentials.  
- **APP_ID**: Any string that uniquely identifies your bot. Defaults to “stickerbot,” but you can set any name you like.  

### 4. Create a Telegram Bot (If You Want Telegram)

1. Open [BotFather](https://t.me/BotFather) on Telegram.  
2. Send `/newbot` and follow the steps (choose a name, username, etc.).  
3. Copy the **HTTP API token** it gives you and paste it into your `.env` as `TELEGRAM_BOT_TOKEN`.  

### 5. Create a Discord Bot (If You Want Discord)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).  
2. Create a new application, then go to **Bot** > **Add Bot**.  
3. Copy the **Bot Token** and paste it into `.env` as `DISCORD_BOT_TOKEN`.  
4. Invite the bot to your server by generating an invite link with the correct scopes and permissions (e.g., “Send Messages”, “Read Message History”, “Attach Files”).  

### 6. Run the Bot

```
npm start
```

Or if you use PM2:
```
pm2 start ecosystem.config.js
```

That’s it! The bot should connect to both Telegram and Discord if you provided both tokens.

---

## Using the Bot

- **Telegram**:  
  1. Type `!generate <prompt>` in your group or in a DM to the bot.  
  2. The bot will reply with AI-generated stickers.

- **Discord**:  
  1. Type `!generate <prompt>` in any channel where the bot can read messages.  
  2. The bot will DM or respond in the same channel with the generated stickers.

- **Repeat**: Use `!repeat` to generate more images based on your **previous** prompt, if you want more variations.

**Admins** in Telegram can use slash commands to manage whitelists and blacklists, e.g.:
- `/addwhitelist cat,dog`  
- `/addblacklist spam,scam`  
- `/listwhitelist` and `/listblacklist`  
- `/clearwhitelist` and `/clearblacklist`

These commands ensure only certain words are allowed (or disallowed) in user prompts.

---

## Don’t Want to Host It Yourself?

You can **try or use the official Sogni sticker bot** instead of running your own:

- **Telegram**: [@SogniAIbot](https://t.me/SogniAIbot)  
- **Discord**: In the official [Sogni Community server](https://discord.sogni.ai).  

If you’re an admin of your group or server, you can invite the official bot to your community. Then you can set whitelists of words that must be used and blacklists of words that can’t be used, just like you would if you hosted your own.

---

## Contributing

Feel free to open issues or pull requests to improve the code or documentation.

---

## License

MIT License.

---

**Powered by [Sogni.ai Supernet](https://www.sogni.ai/supernet).**  
Contact us on [Telegram](https://t.me/sogniai) or [Discord](https://discord.sogni.ai) for help or suggestions!
