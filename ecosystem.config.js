module.exports = {
  apps: [{
    name: "stickerbot",
    script: "./index.js",
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000
  }]
}
