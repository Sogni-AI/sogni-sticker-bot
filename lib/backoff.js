/**
 * Retry pacing for the bot's long-lived connections.
 *
 * Restarting the whole process on every error (the old behaviour) meant a fresh
 * Sogni login each time, and pm2 brought it back in 3 s: several logins a minute
 * for as long as the error lasted. These helpers pace in-process retries instead.
 */

/** Wait before the nth consecutive retry: `baseMs` doubling up to `maxMs`. */
function backoffDelay(attempt, { baseMs = 5000, maxMs = 5 * 60 * 1000 } = {}) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** HTTP status of a node-telegram-bot-api error, when it carries one. */
function telegramStatus(error) {
  return error?.response?.statusCode ?? error?.response?.body?.error_code ?? null;
}

/** Milliseconds a Telegram 429 asks us to wait (parameters.retry_after), or null. */
function telegramRetryAfterMs(error) {
  const seconds = Number(error?.response?.body?.parameters?.retry_after);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Status of a Sogni client error, wherever the wrapper put it. */
function sogniStatus(error) {
  const status = error?.status ?? error?.statusCode ?? error?.cause?.status;
  return Number.isFinite(status) ? status : null;
}

/** Milliseconds a Sogni 429 asks us to wait (Retry-After seconds), or null. */
function sogniRetryAfterMs(error) {
  const seconds = Number(error?.retryAfter ?? error?.cause?.retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10 * 60 * 1000) : null;
}

module.exports = { backoffDelay, telegramStatus, telegramRetryAfterMs, sogniStatus, sogniRetryAfterMs };
