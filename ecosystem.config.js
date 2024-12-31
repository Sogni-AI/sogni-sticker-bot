module.exports = {
  apps: [{
    name: "stickerbot",
    script: "./index.js",
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000
  }]
}
