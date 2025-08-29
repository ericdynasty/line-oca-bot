// /api/submit-oca.js
// 接收 LIFF 表單的 JSON、做欄位驗證、用 Messaging API 推播結果給用戶
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 讀 raw body -> 解析 JSON（避免 body-parser 差異造成解析不到）
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return { raw, data: JSON.parse(raw) };
  } catch (e) {
    throw new Error('JSON 內容無法解析');
  }
}

async function pushMessage(to, messages) {
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to, messages })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('Push API error:', resp.status, t);
    throw new Error(`Push 失敗：${resp.status}`);
  }
}

function validatePayload(p) {
  // 必填：userId（從 LIFF 取得）、姓名、年齡(>=14)、A~J 分數（-100~100）
  if (!p) throw new Error('內容為空');
  const { userId, name, age, sex, date, scores } = p;

  if (!userId) throw new Error('找不到 userId，請從與機器人的 1對1 聊天內開啟表單（不要用外部瀏覽器）');
  if (!name || !String(name).trim()) throw new Error('姓名必填');
  const a = Number(age);
  if (!Number.isFinite(a) || a < 14) throw new Error('年齡需 ≥ 14');

  // 驗分數
  const letters = 'ABCDEFGHIJ'.split('');
  if (!scores || typeof scores !== 'object') throw new Error('缺少分數');
  for (const k of letters) {
    const v = Number(scores[k]);
    if (!Number.isFinite(v) || v < -100 || v > 100) {
      throw new Error(`分數 ${k} 必須在 -100 ~ 100（目前：${scores[k]}）`);
    }
  }
  return { userId, name: String(name).trim(), age: a, sex: sex || '', date: date || '', letters };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!CHANNEL_ACCESS_TOKEN) {
      return res.status(500).json({ error: '後端未設定 LINE_CHANNEL_ACCESS_TOKEN' });
    }

    const { data } = await readJson(req);
    // 你的前端應該送上：{ userId, name, age, sex, date, scores:{A..J}, mania:bool, wantSingle, wantSynth, wantPersona }
    const { userId, name, age, sex, date, letters } = validatePayload(data);

    // 這裡先用「確認單」訊息推回（之後你再把規則/AI 分析塞進來）
    const scoreText = letters.map(k => `${k}:${data.scores[k]}`).join(', ');
    const maniaText = data.mania ? '（有勾躁狂）' : '';
    const lines = [
      `✅ 已收到資料：`,
      `姓名：${name}（${sex || '—'}，${age}歲）`,
      `日期：${date || '—'} ${maniaText}`,
      `分數：${scoreText}`,
      '',
      '稍後我會根據你的勾選項目回覆分析結果。'
    ];

    await pushMessage(userId, [{ type: 'text', text: lines.join('\n') }]);

    // 也回給 LIFF 一個成功訊息（前端會 alert 或顯示）
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('submit-oca error:', e);
    // 回更具體訊息給前端
    return res.status(500).json({ error: e.message || 'Server Error' });
  }
};
