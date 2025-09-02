// api/line-webhook.js
// v4: 加入 Quick Reply 按鍵；修正歡迎詞僅一次；支援數字選項與常用分數快捷鍵
// === messages / prompts ===
const MSG = {
  hello1: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。',
  hello2: '請輸入填表人姓名：',
  cancelHint: '輸入「取消」可中止，或輸入「重新開始」隨時重來。',
  canceled: '已取消這次填寫。要再開始，請輸入「填表」或點按下方按鈕。',
  restarted: '已重新開始，從頭來一次。',
  alreadyInFlow: '我們正在進行中哦～我再幫你接續目前這一題。',
  startBtn: '開始填表',
};


const crypto = require('crypto');

// ---- fetch polyfill ----
const fetchFn = (...args) =>
  (typeof fetch === 'function'
    ? fetch(...args)
    : import('node-fetch').then(m => m.default(...args)));

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

// 簡易 session（冷啟動會清）
const SESSIONS = new Map(); // userId -> { step, letterIdx, data:{...}, helloSent }

async function replyRaw(payload) {
  try {
    const resp = await fetchFn('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.error('Reply API error:', resp.status, t);
    }
  } catch (e) {
    console.error('Reply API failed:', e);
  }
}
async function replyMessage(replyToken, messages) {
  return replyRaw({ replyToken, messages });
}
const t = (text) => ({ type: 'text', text });

// 產 Quick Reply 文本
function qText(text, pairs /* [[label,text],...] */) {
  return {
    type: 'text',
    text,
    quickReply: {
      items: (pairs || []).map(([label, v]) => ({
        type: 'action',
        action: { type: 'message', label, text: v }
      }))
    }
  };
}

// ---- 驗簽 ----
function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hmac === headerSignature;
}

// ---- 工具 ----
const LETTERS = "ABCDEFGHIJ".split("");
const NAME_OF = {
  A: "A 自我", B: "B 情緒", C: "C 任務", D: "D 關係", E: "E 支援",
  F: "F 壓力", G: "G 目標", H: "H 執行", I: "I 自律", J: "J 活力"
};

function normalizeNumStr(s) {
  if (!s) return '';
  const full = '０１２３４５６７８９－—';
  const half = '0123456789--';
  let out = '';
  for (const ch of s) {
    const i = full.indexOf(ch);
    out += (i >= 0 ? half[i] : ch);
  }
  return out.trim();
}
function parseIntLoose(s) {
  const v = Number(normalizeNumStr(s));
  return Number.isFinite(v) ? Math.floor(v) : NaN;
}
function parseScore(s) {
  const v = Number(normalizeNumStr(s));
  if (!Number.isFinite(v)) return null;
  if (v < -100 || v > 100) return null;
  return Math.round(v);
}
function todayYMD() {
  const dt = new Date();
  const y = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(dt);
  const m = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit' }).format(dt);
  const d = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', day: '2-digit' }).format(dt);
  return `${y}/${m}/${d}`;
}
function isYmd(str) {
  const m = /^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/.exec(str);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return true;
}

// ---- 問句 ----
const MSG = {
  hello: `您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。\n請輸入填表人姓名：`,
  gender: `性別請選擇（或輸入 1/2/3）：`,
  age: `請輸入年齡（需 ≥ 14）：`,
  date: `請選擇日期（或輸入 YYYY/MM/DD）：`,
  maniaB: `躁狂（B 情緒）是否有？`,
  maniaE: `躁狂（E 點）是否有？`,
  wants: `想看的內容（可擇一；若要全部選 4）：`,
  finishing: `分析處理中，請稍候……`,
};

function getSession(userId) {
  let s = SESSIONS.get(userId);
  if (!s) {
    s = { step: 0, letterIdx: 0, data: { scores: {} }, helloSent: false };
    SESSIONS.set(userId, s);
  }
  return s;
}

async function askNext(replyToken, s) {
  switch (s.step) {
    case 0:
      return replyMessage(replyToken, [t(MSG.hello)]);
    case 1:
      return replyMessage(replyToken, [
        qText(MSG.gender, [
          ['男(1)', '1'],
          ['女(2)', '2'],
          ['其他(3)', '3'],
        ])
      ]);
    case 2:
      return replyMessage(replyToken, [t(MSG.age)]);
    case 3:
      return replyMessage(replyToken, [
        qText(MSG.date, [
          ['今天(1)', '1'],
        ])
      ]);
    case 4:
      return replyMessage(replyToken, [
        qText(MSG.maniaB, [
          ['有(1)', '1'],
          ['無(2)', '2'],
        ])
      ]);
    case 5:
      return replyMessage(replyToken, [
        qText(MSG.maniaE, [
          ['有(1)', '1'],
          ['無(2)', '2'],
        ])
      ]);
    case 6: {
      const L = LETTERS[s.letterIdx];
      // 常用分數快捷鍵
      const fav = [['-50','-50'], ['-25','-25'], ['0','0'], ['25','25'], ['50','50']];
      return replyMessage(replyToken, [
        qText(`請輸入 ${L} 點（-100～100）的分數：`, fav)
      ]);
    }
    case 7:
      return replyMessage(replyToken, [
        qText(MSG.wants, [
          ['A~J 單點(1)', '1'],
          ['綜合重點(2)', '2'],
          ['人物側寫(3)', '3'],
          ['全部(4)', '4'],
        ])
      ]);
    case 8:
      return replyMessage(replyToken, [t(MSG.finishing)]);
    default:
      return replyMessage(replyToken, [t('流程結束。')]);
  }
}

async function handleText(ev, text) {
  const replyToken = ev.replyToken;
  const userId = ev.source?.userId;
  if (!userId) return;

  if (/^取消$/i.test(text.trim())) {
    SESSIONS.delete(userId);
    return replyMessage(replyToken, [t('已取消，若要重新開始可再次傳訊。')]);
  }

  const s = getSession(userId);

  if (s.step === 0) {
    const name = text.trim();
    if (!name) return replyMessage(replyToken, [t('姓名不可空白，請重新輸入姓名：')]);
    s.data.name = name.slice(0, 40);
    s.step = 1;
    return askNext(replyToken, s);
  }

  if (s.step === 1) {
    const v = normalizeNumStr(text);
    let gender = '';
    if (v === '1') gender = '男';
    else if (v === '2') gender = '女';
    else if (v === '3') gender = '其他';
    if (!gender) {
      return replyMessage(replyToken, [
        qText('請點選或輸入 1/2/3：', [['男(1)','1'],['女(2)','2'],['其他(3)','3']])
      ]);
    }
    s.data.gender = gender;
    s.step = 2;
    return askNext(replyToken, s);
  }

  if (s.step === 2) {
    const age = parseIntLoose(text);
    if (!Number.isFinite(age) || age < 14 || age > 120) {
      return replyMessage(replyToken, [t('年齡需為 14~120 的整數，請重新輸入：')]);
    }
    s.data.age = age;
    s.step = 3;
    return askNext(replyToken, s);
  }

  if (s.step === 3) {
    const v = normalizeNumStr(text);
    if (v === '1') {
      s.data.date = todayYMD();
    } else if (isYmd(v)) {
      s.data.date = v.replace(/-/g, '/');
    } else {
      return replyMessage(replyToken, [
        qText('格式不正確，請點選「今天(1)」或輸入 YYYY/MM/DD：', [['今天(1)','1']])
      ]);
    }
    s.step = 4;
    return askNext(replyToken, s);
  }

  if (s.step === 4) {
    const v = normalizeNumStr(text);
    if (v !== '1' && v !== '2') {
      return replyMessage(replyToken, [
        qText('請輸入 1（有）或 2（無）：', [['有(1)','1'],['無(2)','2']])
      ]);
    }
    s.data.maniaB = (v === '1');
    s.step = 5;
    return askNext(replyToken, s);
  }

  if (s.step === 5) {
    const v = normalizeNumStr(text);
    if (v !== '1' && v !== '2') {
      return replyMessage(replyToken, [
        qText('請輸入 1（有）或 2（無）：', [['有(1)','1'],['無(2)','2']])
      ]);
    }
    s.data.maniaE = (v === '1');
    s.step = 6;
    s.letterIdx = 0;
    return askNext(replyToken, s);
  }

  if (s.step === 6) {
    const L = LETTERS[s.letterIdx];
    const sc = parseScore(text);
    if (sc === null) {
      return replyMessage(replyToken, [
        qText(`分數需為 -100~100 的整數，請重新輸入 ${L} 點分數：`, [['-50','-50'],['-25','-25'],['0','0'],['25','25'],['50','50']])
      ]);
    }
    s.data.scores[L] = sc;
    s.letterIdx++;
    if (s.letterIdx < LETTERS.length) {
      return askNext(replyToken, s);
    }
    s.step = 7;
    return askNext(replyToken, s);
  }

  if (s.step === 7) {
    const v = normalizeNumStr(text);
    if (!['1','2','3','4'].includes(v)) {
      return replyMessage(replyToken, [
        qText('請輸入 1~4（若要全部選 4）：', [
          ['A~J 單點(1)', '1'],
          ['綜合重點(2)', '2'],
          ['人物側寫(3)', '3'],
          ['全部(4)', '4'],
        ])
      ]);
    }
    const wants = { single:false, combo:false, persona:false };
    if (v === '4') wants.single = wants.combo = wants.persona = true;
    else if (v === '1') wants.single = true;
    else if (v === '2') wants.combo = true;
    else if (v === '3') wants.persona = true;
    s.data.wants = wants;

    s.step = 8;
    await askNext(replyToken, s);

    try {
      const base = process.env.PUBLIC_BASE_URL || ('https://' + process.env.VERCEL_URL);
      const resp = await fetchFn(`${base}/api/submit-oca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...s.data })
      });
      if (!resp.ok) {
        const msg = await resp.text().catch(()=> '');
        console.error('submit-oca error:', resp.status, msg);
        await replyMessage(replyToken, [t('分析送出失敗，請稍後再試或改用「填表」。')]);
      }
    } catch (e) {
      console.error('submit-oca fetch failed:', e);
      await replyMessage(replyToken, [t('分析送出失敗，請稍後再試或改用「填表」。')]);
    } finally {
      SESSIONS.delete(userId);
    }
    return;
  }

  return replyMessage(replyToken, [t('請依指示輸入；若要取消請輸入「取消」。')]);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) return res.status(403).send('Bad signature');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

      const text = (ev.message.text || '').trim();
      const userId = ev.source?.userId;
      if (!userId) continue;

      // 顯式觸發：重置並開始
      if (/^(填表|聊天填表|開始)$/i.test(text)) {
        SESSIONS.delete(userId);
        const s0 = getSession(userId);
        s0.helloSent = true;   // 避免緊接著又判斷一次
        await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.hello }]);
        continue;
      }

      const s = getSession(userId);

      // ---- 這裡是「不重覆歡迎詞」的關鍵 ----
      if (!s.helloSent) {
        // 這些字視為問候，不當姓名
        const GREET = /^(你好|哈囉|嗨|hi|hello)$/i;
        // 可能是日期或純數字（像 1/2/3）
        const norm = normalizeNumStr(text);
        const looksLikeDate = isYmd(norm);
        const looksLikePureNumber = /^\d{1,3}$/.test(norm);

        // 「像姓名」的條件：不是指令、不是問候、不是日期、不是純數字；長度合理
        const looksLikeName =
          !GREET.test(text) &&
          !/^(填表|聊天填表|開始|取消)$/i.test(text) &&
          !looksLikeDate &&
          !looksLikePureNumber &&
          text.length > 0 && text.length <= 40;

        s.helloSent = true;
        if (looksLikeName) {
          // 直接把這則訊息當「姓名」，不再送第二次歡迎詞
          await handleText(ev, text);
        } else {
          // 才送一次歡迎詞
          await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.hello }]);
        }
        continue;
      }
      // --------------------------------------

      await handleText(ev, text);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
