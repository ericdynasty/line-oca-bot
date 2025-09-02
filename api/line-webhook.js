// api/line-webhook.js
// v3.0: 數字選項輸入（性別/日期/躁狂/想看內容）+ 自動歡迎詞 + 驗簽

const crypto = require('crypto');

// ---- fetch polyfill (for Node 16/older) ----
const fetchFn = (...args) =>
  (typeof fetch === 'function'
    ? fetch(...args)
    : import('node-fetch').then(m => m.default(...args)));

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const LIFF_ID = process.env.LIFF_ID || ''; // 若還想保留 LIFF 按鈕
const LIFF_LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

// 簡易「記憶」對話狀態（冷啟動會重置）
const SESSIONS = new Map(); // key: userId -> {step, data, letterIdx}

// ---- LINE Reply ----
async function replyMessage(replyToken, messages) {
  try {
    const resp = await fetchFn('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ replyToken, messages })
    });
    if (!resp.ok) {
      const t = await resp.text().catch(()=> '');
      console.error('Reply API error:', resp.status, t);
    }
  } catch (e) {
    console.error('Reply API failed:', e);
  }
}

const t = (text) => ({ type: 'text', text });

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
  // 全形數字轉半形
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

function pad(n) { return String(n).padStart(2,'0'); }

function todayYMD() {
  const dt = new Date();
  // 以台灣時區取今天
  const fY = new Intl.DateTimeFormat('zh-TW',{ timeZone:'Asia/Taipei', year:'numeric' }).format(dt);
  const fM = new Intl.DateTimeFormat('zh-TW',{ timeZone:'Asia/Taipei', month:'2-digit' }).format(dt);
  const fD = new Intl.DateTimeFormat('zh-TW',{ timeZone:'Asia/Taipei', day:'2-digit' }).format(dt);
  return `${fY}/${fM}/${fD}`;
}

function isYmd(str) {
  // YYYY/MM/DD 簡驗
  const m = /^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/.exec(str);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return true;
}

// ---- 問句與流程 ----
const MSG = {
  hello: `您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。\n請輸入填表人姓名：`,
  gender: `性別請輸入數字：\n1：男　2：女　3：其他`,
  age: `請輸入年齡（需 ≥ 14）：`,
  date: `日期請輸入：\n1：今天　或輸入 YYYY/MM/DD（例如 2025/09/02）`,
  maniaB: `躁狂（B 情緒）是否有？請輸入數字：\n1：有　2：無`,
  maniaE: `躁狂（E 點）是否有？請輸入數字：\n1：有　2：無`,
  wants: `想看的內容（可擇一；若要全部選 4）：\n1：A~J 單點　2：綜合重點　3：人物側寫　4：全部`,
  finishing: `分析處理中，請稍候……`,
};

// 建立/取得 session
function getSession(userId) {
  let s = SESSIONS.get(userId);
  if (!s) {
    s = { step: 0, letterIdx: 0, data: { scores: {} } };
    SESSIONS.set(userId, s);
  }
  return s;
}

// 送出下一個問題
async function askNext(replyToken, s) {
  switch (s.step) {
    case 0:  return replyMessage(replyToken, [t(MSG.hello)]);
    case 1:  return replyMessage(replyToken, [t(MSG.gender)]);
    case 2:  return replyMessage(replyToken, [t(MSG.age)]);
    case 3:  return replyMessage(replyToken, [t(MSG.date)]);
    case 4:  return replyMessage(replyToken, [t(MSG.maniaB)]);
    case 5:  return replyMessage(replyToken, [t(MSG.maniaE)]);
    case 6: {
      const L = LETTERS[s.letterIdx];
      return replyMessage(replyToken, [t(`請輸入 ${L} 點（-100～100）的分數：`)]);
    }
    case 7:  return replyMessage(replyToken, [t(MSG.wants)]);
    case 8:  return replyMessage(replyToken, [t(MSG.finishing)]);
    default: return replyMessage(replyToken, [t('流程結束。')]);
  }
}

// 解析使用者輸入
async function handleText(ev, text) {
  const replyToken = ev.replyToken;
  const userId = ev.source?.userId;
  if (!userId) return;

  // 取消
  if (/^取消$/i.test(text.trim())) {
    SESSIONS.delete(userId);
    return replyMessage(replyToken, [t('已取消，若要重新開始可再次傳訊。')]);
  }

  const s = getSession(userId);

  if (s.step === 0) {
    // 姓名
    const name = text.trim();
    if (!name) return replyMessage(replyToken, [t('姓名不可空白，請重新輸入姓名：')]);
    s.data.name = name.slice(0,40);
    s.step = 1;
    return askNext(replyToken, s);
  }

  if (s.step === 1) {
    // 性別：1=男 2=女 3=其他
    const v = normalizeNumStr(text);
    let gender = '';
    if (v === '1') gender = '男';
    else if (v === '2') gender = '女';
    else if (v === '3') gender = '其他';
    if (!gender) return replyMessage(replyToken, [t('請輸入數字 1/2/3：\n1：男　2：女　3：其他')]);
    s.data.gender = gender;
    s.step = 2;
    return askNext(replyToken, s);
  }

  if (s.step === 2) {
    // 年齡
    const age = parseIntLoose(text);
    if (!Number.isFinite(age) || age < 14 || age > 120) {
      return replyMessage(replyToken, [t('年齡需為 14~120 的整數，請重新輸入：')]);
    }
    s.data.age = age;
    s.step = 3;
    return askNext(replyToken, s);
  }

  if (s.step === 3) {
    // 日期
    const v = normalizeNumStr(text);
    if (v === '1') {
      s.data.date = todayYMD();
    } else if (isYmd(v)) {
      s.data.date = v.replace(/-/g,'/'); // 正規化
    } else {
      return replyMessage(replyToken, [t('格式不正確，請輸入 1（今天）或 YYYY/MM/DD：')]);
    }
    s.step = 4;
    return askNext(replyToken, s);
  }

  if (s.step === 4) {
    // 躁狂B 1=有 2=無
    const v = normalizeNumStr(text);
    if (v !== '1' && v !== '2') {
      return replyMessage(replyToken, [t('請輸入數字 1（有）或 2（無）：')]);
    }
    s.data.maniaB = (v === '1');
    s.step = 5;
    return askNext(replyToken, s);
  }

  if (s.step === 5) {
    // 躁狂E 1=有 2=無
    const v = normalizeNumStr(text);
    if (v !== '1' && v !== '2') {
      return replyMessage(replyToken, [t('請輸入數字 1（有）或 2（無）：')]);
    }
    s.data.maniaE = (v === '1');
    s.step = 6;
    s.letterIdx = 0;
    return askNext(replyToken, s);
  }

  if (s.step === 6) {
    // A~J 分數
    const L = LETTERS[s.letterIdx];
    const sc = parseScore(text);
    if (sc === null) {
      return replyMessage(replyToken, [t(`分數需為 -100~100 的整數，請重新輸入 ${L} 點分數：`)]);
    }
    s.data.scores[L] = sc;
    s.letterIdx++;
    if (s.letterIdx < LETTERS.length) {
      return askNext(replyToken, s);
    }
    // 分數輸入完
    s.step = 7;
    return askNext(replyToken, s);
  }

  if (s.step === 7) {
    // 想看的內容 1/2/3/4
    const v = normalizeNumStr(text);
    if (!['1','2','3','4'].includes(v)) {
      return replyMessage(replyToken, [t('請輸入數字 1~4（若要全部選 4）：\n1：A~J 單點　2：綜合重點　3：人物側寫　4：全部')]);
    }
    const wants = { single:false, combo:false, persona:false };
    if (v === '4') wants.single = wants.combo = wants.persona = true;
    else if (v === '1') wants.single = true;
    else if (v === '2') wants.combo = true;
    else if (v === '3') wants.persona = true;
    s.data.wants = wants;

    // 送交分析
    s.step = 8;
    await askNext(replyToken, s);

    try {
      const resp = await fetchFn(`${process.env.PUBLIC_BASE_URL || 'https://'+process.env.VERCEL_URL}/api/submit-oca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...s.data
        })
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
      // 完成後清掉 session
      SESSIONS.delete(userId);
    }
    return;
  }

  // 預設
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
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();

        // 若使用者說「填表」或「聊天填表」，強制重新開始
        if (/^(填表|聊天填表)$/i.test(text)) {
          const userId = ev.source?.userId;
          if (userId) SESSIONS.delete(userId);
          await replyMessage(ev.replyToken, [t('已開始新的填表流程。')]);
          const s = getSession(userId);
          s.step = 0;
          await askNext(ev.replyToken, s);
          continue;
        }

        // 自動帶入歡迎＆流程（若沒有 session 就建立）
        const userId = ev.source?.userId;
        const s = getSession(userId);
        if (s.step === 0 && !/^取消$/.test(text)) {
          // 若第一次就不是姓名也沒關係，直接當姓名
          // 但仍先送出 hello 再要姓名
          await askNext(ev.replyToken, s); // hello
          continue;
        }

        await handleText(ev, text);
        continue;
      }
      // 非文字訊息忽略
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
