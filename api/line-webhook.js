// api/line-webhook.js (ESM 版)
// 極簡可動：收到文字就回「收到：內容」；Follow 事件會推播歡迎
import crypto from 'crypto';

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

async function replyMessage(replyToken, messages) {
  const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!resp.ok) {
    console.error('LINE reply error:', resp.status, await resp.text().catch(() => ''));
  }
}

async function pushMessage(to, messages) {
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!resp.ok) {
    console.error('LINE push error:', resp.status, await resp.text().catch(() => ''));
  }
}

export default async function handler(req, res) {
  // LINE 的 webhook 是 POST；非 POST 時回 200 讓健康檢查通過
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }

  // --- 簽章驗證（失敗先記警告，不擋流程，方便除錯）---
  const body = req.body || {};
  const raw = JSON.stringify(body);
  const sig = req.headers['x-line-signature'] || '';
  if (CHANNEL_SECRET) {
    try {
      const h = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
      if (sig !== h) {
        console.warn('⚠️ LINE signature mismatch (先略過以利除錯)');
      }
    } catch (e) {
      console.warn('⚠️ signature 計算失敗', e);
    }
  }

  const events = body.events || [];
  for (const ev of events) {
    try {
      if (ev.type === 'message' && ev.message?.type === 'text') {
        // 回聲訊息，確認 webhook/權杖都正常
        await replyMessage(ev.replyToken, [{ type: 'text', text: `收到：${ev.message.text}` }]);
      } else if (ev.type === 'follow' && ev.source?.userId) {
        await pushMessage(ev.source.userId, [{ type: 'text', text: '感謝加好友！' }]);
      } else {
        // 其他事件先忽略，避免 400
      }
    } catch (e) {
      console.error('handle event error:', e);
    }
  }

  res.status(200).json({ ok: true });
}
