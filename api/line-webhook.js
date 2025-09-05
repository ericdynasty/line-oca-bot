// api/line-webhook.js  — 不會再回聲使用者輸入，僅在辨識到指令或流程中才回覆
import crypto from 'crypto';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

// 簡單的 in-memory session（serverless 會偶爾重置，僅供示範）
const sessions = new Map(); // key: userId -> { step: 'askName' | null, data: {...} }

async function replyMessage(replyToken, messages) {
  if (!replyToken) return;
  const body = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error('LINE reply error:', resp.status, text);
    // 不 throw，避免整體 webhook 500
  }
}

function validateSignature(req, rawBody) {
  try {
    if (!CHANNEL_SECRET) return true; // 沒設也別讓 webhook 500
    const signature = crypto
      .createHmac('sha256', CHANNEL_SECRET)
      .update(rawBody)
      .digest('base64');
    return signature === req.headers['x-line-signature'];
  } catch (e) {
    console.error('signature check error:', e);
    return true;
  }
}

function startForm(userId) {
  sessions.set(userId, { step: 'askName', data: {} });
}

async function handleTextEvent(event) {
  const userId = event.source?.userId || 'anon';
  const text = (event.message?.text || '').trim();

  // 指令：取消
  if (['取消', '中止', '結束'].includes(text)) {
    sessions.delete(userId);
    await replyMessage(event.replyToken, { type: 'text', text: '已取消。需要時再輸入「填表」開始。' });
    return;
  }

  // 指令：重新開始
  if (['重新開始', '重來', 'reset', '重置'].includes(text.toLowerCase())) {
    startForm(userId);
    await replyMessage(event.replyToken, [
      { type: 'text', text: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。' },
      { type: 'text', text: '請輸入填表人姓名：' },
    ]);
    return;
  }

  // 指令：填表 / 開始
  if (['填表', '開始', 'start'].includes(text.toLowerCase())) {
    startForm(userId);
    await replyMessage(event.replyToken, [
      { type: 'text', text: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。' },
      { type: 'text', text: '請輸入填表人姓名：' },
    ]);
    return;
  }

  // 若流程進行中，依 step 引導（示範：先收姓名；其餘欄位可在這裡擴充或串回你原本模組）
  const sess = sessions.get(userId);
  if (sess && sess.step === 'askName') {
    sess.data.name = text;
    sess.step = null; // 先結束示範步驟
    await replyMessage(event.replyToken, {
      type: 'text',
      text: `好的，${text}。表單已開始，接下來的欄位依原有流程繼續填寫。您也可輸入「取消」或「重新開始」。`,
    });
    return;
  }

  // 沒在流程中、也不是指令：不要回聲！
  await replyMessage(event.replyToken, {
    type: 'text',
    text: '我在這裡～輸入「填表」開始填資料，或輸入「取消」離開。',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!validateSignature(req, rawBody)) {
    console.warn('Invalid signature, but respond 200 to avoid 500.');
    res.status(200).send('ok');
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const events = body.events || [];

    for (const event of events) {
      // 略過 LINE 後台 Verify 的測試事件（replyToken 全 0）
      if (event.replyToken === '00000000000000000000000000000000') {
        console.log('Skip LINE webhook verification event.');
        continue;
      }

      if (event.type === 'message' && event.message?.type === 'text') {
        await handleTextEvent(event);
      } else {
        // 其他事件一律回 200 不處理
        console.log('Ignore event:', event.type);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('webhook error:', err);
    // 仍回 200，避免 LINE 將 webhook 判定失敗
    res.status(200).send('OK');
  }
}
