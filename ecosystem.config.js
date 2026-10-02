module.exports = {
  apps: [{
    name: "stickerbot",
    script: "./index.js",
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // Back off between crash restarts (3 s growing to pm2's 15 s cap, reset after
    // 30 s up) instead of a flat 3 s: each restart is a fresh Sogni login.
    exp_backoff_restart_delay: 3000,
    cron_restart: "0 */8 * * *" // Restart every 8 hours
  }]
}
