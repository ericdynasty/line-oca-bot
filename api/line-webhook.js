// /api/line-webhook.js
// 驗簽 + 關鍵字「填表」開 LIFF + 簡易數字輸入 fallback
const crypto = require('crypto');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID || ''; // 例如 2000xxxxxx-xxxxx
const LIFF_LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

async function replyMessage(replyToken, messages) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ replyToken, messages })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(()=>'');
    console.error('Reply API error:', resp.status, t);
  }
}

function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET)
                     .update(body)
                     .digest('base64');
  return hmac === headerSignature;
}

// 簡易偵測是不是 A~J 的文字輸入（讓舊體驗仍可用）
function seemsScoreText(text) {
  // 允許「A:10, B:-20, ...」或「A10 B-20」等
  const m = text.match(/[A-Jａ-ｊＡ-Ｊ]\s*[:：]?\s*-?\d+/gi);
  return m && m.length >= 3; // 至少 3 點才當作分數
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const rawBody = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);

    // 1) 簽章驗證
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) {
      return res.status(403).send('Bad signature');
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      // 只處理文字訊息
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();

        // 2) 關鍵字：填表 / 表單 / 填寫 → 回 LIFF 連結
        if (/填表|表單|填寫/i.test(text)) {
          if (LIFF_LINK) {
            await replyMessage(ev.replyToken, [
              {
                type: 'template',
                altText: '開啟 OCA 填表',
                template: {
                  type: 'buttons',
                  text: '請點「開啟表單」填寫 A~J 與基本資料。',
                  actions: [
                    { type: 'uri', label: '開啟表單', uri: LIFF_LINK }
                  ]
                }
              }
            ]);
          } else {
            await replyMessage(ev.replyToken, [
              { type: 'text', text: '還沒設定 LIFF_ID，請先到 Vercel 設定環境變數 LIFF_ID 後重新部署。' }
            ]);
          }
          continue;
        }

        // 3) 舊的手打分數體驗（防呆）
        if (seemsScoreText(text)) {
          await replyMessage(ev.replyToken, [
            { type: 'text', text: '我已收到分數，稍後會回覆分析結果（或改用「填表」開 LIFF 會更快）。' }
          ]);
          // 若你有「文字分數 → 直接分析」的既有流程，可以在這裡呼叫你的分析 API
          continue;
        }

        // 4) 說明 / 幫助
        await replyMessage(ev.replyToken, [
          {
            type: 'text',
            text: '嗨！要開始分析，請輸入「填表」開啟 OCA 表單；或用文字輸入 A~J 分數（例如 A:10, B:-20, ...）。'
          }
        ]);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
