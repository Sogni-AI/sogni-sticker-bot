const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, rm, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');
const TelegramBot = require('node-telegram-bot-api');
const removeImageBg = require('../lib/removeImageBgOriginal');
const floodFill = require('../lib/removeImageBg');
const convertImageToSticker = require('../lib/convertImageToSticker');

async function withImage(width, height, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sogni-sticker-test-'));
  try {
    const file = path.join(dir, 'source.png');
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const subject = x >= width / 4 && x < width * 3 / 4 &&
          y >= height / 4 && y < height * 3 / 4;
        pixels[i] = subject ? 255 : 0;
        pixels[i + 1] = subject ? 0 : 255;
        pixels[i + 3] = 255;
      }
    }
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(file);
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('background removal preserves subject pixels and PNG transparency', async () => {
  await withImage(64, 64, async file => {
    for (const remove of [removeImageBg, floodFill]) {
      const image = await remove(file);
      const { data, width } = image.bitmap;
      assert.equal(data[3], 0);
      assert.deepEqual([...data.subarray((32 * width + 32) * 4, (32 * width + 32) * 4 + 4)],
        [255, 0, 0, 255]);
      // Discord sends this PNG directly; Telegram first writes it to disk.
      const png = await image.getBuffer('image/png');
      assert.equal((await sharp(png).metadata()).format, 'png');
      const output = file.replace('.png', '-removed.png');
      await image.write(output);
      assert.equal((await sharp(output).metadata()).hasAlpha, true);
    }
  });
});

for (const [width, height, expected] of [[64, 64, [64, 64]], [640, 320, [512, 256]]]) {
  test(`sticker conversion keeps ${width}x${height} within the original 512px limit`, async () => {
    await withImage(width, height, async file => {
      const output = await convertImageToSticker(file);
      const meta = await sharp(output).metadata();
      assert.equal(meta.format, 'webp');
      assert.deepEqual([meta.width, meta.height], expected);
      assert.equal(meta.hasAlpha, true);
      const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(data[3], 0);
      const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
      assert.deepEqual([...data.subarray(center, center + 4)], [255, 0, 0, 255]);
      await access(file);
      await assert.rejects(access(file.replace('.png', '_sticker.png')));
    });
  });
}

test('Telegram transport handles messages, multipart stickers and API errors offline', async t => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/getMe')) {
      res.end(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests',
        parameters: { retry_after: 3 } }));
    } else {
      res.end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const bot = new TelegramBot('offline-test-token', {
    polling: false,
    baseApiUrl: `http://127.0.0.1:${server.address().port}`,
  });
  assert.equal((await bot.sendMessage(7, 'sticker ready', { message_thread_id: 9 })).message_id, 42);
  assert.match(received[0].body, /sticker(?:\+|%20)ready/);
  assert.match(received[0].body, /message_thread_id=9/);
  const png = await sharp({ create: { width: 8, height: 8, channels: 4,
    background: '#ff0000' } }).png().toBuffer();
  assert.equal((await bot.sendSticker(7, png, {}, { filename: 'sticker.png',
    contentType: 'image/png' })).message_id, 42);
  assert.match(received[1].headers['content-type'], /multipart\/form-data; boundary=/);
  assert.match(received[1].body, /filename="sticker.png"/);
  await assert.rejects(bot.getMe(), error => {
    assert.equal(error.code, 'ETELEGRAM');
    assert.equal(error.response.body.parameters.retry_after, 3);
    return true;
  });
});
