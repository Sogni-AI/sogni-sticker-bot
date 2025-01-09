module.exports = {
  apps: [{
    name: "stickerbot",
    script: "./index.js",
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    cron_restart: "0 */8 * * *" // Restart every 8 hours
  }]
}
