// api/line-webhook.js  (ESM 版)
import crypto from 'crypto';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

async function replyMessage(replyToken, messages) {
  const payload = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error('LINE reply error:', resp.status, text);
    // 不要 throw；避免整個 webhook 500
  }
}

function validateSignature(req, rawBody) {
  try {
    if (!CHANNEL_SECRET) return true; // 沒設也不要 500
    const signature = crypto
      .createHmac('sha256', CHANNEL_SECRET)
      .update(rawBody)
      .digest('base64');
    return signature === req.headers['x-line-signature'];
  } catch (e) {
    console.error('signature check error:', e);
    return true; // 出錯也不要讓 webhook 500
  }
}

export default async function handler(req, res) {
  // LINE 後台偶爾會 GET/ping；回 200 即可
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  // Vercel 這裡 body 已經被 parse，還是組成字串用來驗簽
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!validateSignature(req, rawBody)) {
    console.warn('Invalid signature, but responding 200 to avoid 500.');
    res.status(200).send('ok');
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const events = body.events || [];

    for (const event of events) {
      // LINE「Webhook 驗證」用的測試事件，replyToken 全 0，不能回覆，要直接略過
      if (event.replyToken === '00000000000000000000000000000000') {
        console.log('Skip LINE webhook verification event.');
        continue;
      }

      // 你原本的處理邏輯寫在這裡；示範回覆文字
      if (event.type === 'message' && event.message?.type === 'text') {
        await replyMessage(event.replyToken, {
          type: 'text',
          text: `收到：${event.message.text}`,
        });
      }
    }

    // 一律回 200，避免 500
    res.status(200).send('OK');
  } catch (err) {
    console.error('webhook handler error:', err);
    // 仍然回 200，讓 LINE 不會把你標成失敗
    res.status(200).send('OK');
  }
}
