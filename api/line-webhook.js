// api/line-webhook.js
// v5: 兩段式歡迎詞 + 指令（取消/重新開始/填表）+ 誤觸保護 + 防重複歡迎（去抖 + 冷啟容錯）

/* =========================
 * 訊息字串
 * ========================= */
const MSG = {
  hello1: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。',
  hello2: '請輸入填表人姓名：',
  startBtn: '開始填寫',
  alreadyIn: '我們正在進行中，我會從目前這一步繼續唷。',
  // 指令
  cmdHint: '常用指令：輸入「填表」可立即開始；輸入「取消」可終止這次填寫；輸入「重新開始」可從頭重來。',
  // 確認
  confirmCancel: '要取消本次填寫嗎？\n（1：確定取消 / 2：回到填寫）',
  confirmRestart: '要從頭重新開始嗎？\n（1：確定重來 / 2：回到填寫）',
  canceled: '本次填寫已取消。要再開始請輸入「填表」。',
  restarted: '已重新開始，先從姓名開始。請輸入填表人姓名：',
  // 步驟提示（按鍵式與數字快速鍵）
  askGender: '性別請選：1.男  2.女  3.其他（輸入 1/2/3）',
  askAge: '年齡（必填，需 ≥14）。請輸入整數，或輸入 1 表示「我已滿 14 歲」。',
  askDate: '日期：1.今天  2.自訂（YYYY/MM/DD）',
  askManiaB: '躁狂（B 情緒）是否有偏高跡象？1.有  2.無',
  askManiaE: '躁狂（E 點）是否有偏高跡象？1.有  2.無',
  askScore: (L, name) => `請輸入 ${L} 點（-100～100）的分數：`,
  askWants: '想看的內容（可多選，空白代表全部）：\n1. A~J 單點  2. 綜合重點  3. 人物側寫\n請輸入像「1,2」或「全部」。',
  // 誤觸與容錯
  notNumber: '格式看起來不像數字，請再試一次（可輸入負數）。',
  notDate: '日期格式應為 YYYY/MM/DD，或輸入 1 代表今天。',
  notOption: '看起來不像有效的選項，請輸入題目提示中的數字（或文字）。',
  needAge14: '年齡需 ≥ 14。',
  // 一鍵動作
  quickKeys: {
    cancel: '取消',
    restart: '重新開始',
    fill: '填表',
  }
};

/* =========================
 * 套件 & 驗簽
 * ========================= */
const crypto = require('crypto');

// fetch polyfill（Vercel Node 18 有 fetch；若本地或舊版本就動態載入）
const fetchFn = (...args) =>
  (typeof fetch === 'function' ? fetch : (...a) => import('node-fetch').then(m => m.default(...a)))(...args);

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function verifySignature(signature, body) {
  if (!CHANNEL_SECRET) return false;
  const h = crypto.createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
  return h === signature;
}

/* =========================
 * LINE API helpers
 * ========================= */
async function reply(replyToken, messages) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const r = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ replyToken, messages })
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    console.error('Reply API error:', r.status, t);
  }
}

async function push(to, messages) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const r = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to, messages })
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    console.error('Push API error:', r.status, t);
  }
}

/* =========================
 * 極小型 session（記憶體）+ 去抖
 * － 注意：serverless 可能冷啟，記憶體會遺失
 * － 我用「去抖 + 內容判斷」讓冷啟也不會重複歡迎或崩流程
 * ========================= */
const S = new Map(); // key: userId -> {step, data, helloAt, confirm?: 'cancel'|'restart'}
const TTL_MS = 15 * 60 * 1000; // 15 分鐘
function now() { return Date.now(); }
function getS(uid) {
  const o = S.get(uid);
  if (o && (now() - (o.ts || 0) < TTL_MS)) return o;
  const n = { step: null, data: {}, ts: now(), helloAt: 0 };
  S.set(uid, n);
  return n;
}
function saveS(uid, obj) {
  obj.ts = now();
  S.set(uid, obj);
}

/* =========================
 * 小工具
 * ========================= */
const LETTERS = 'ABCDEFGHIJ'.split('');
function isInt(v) { return /^-?\d+$/.test(String(v).trim()); }
function parseIntSafe(v) { return parseInt(String(v).trim(), 10); }
function isValidDateStr(s) { return /^\d{4}\/\d{2}\/\d{2}$/.test(String(s).trim()); }

function mkQuick(commands = []) {
  // 生成下方快速指令按鈕
  const items = commands.map((label) => ({
    type: 'action',
    action: { type: 'message', label, text: label }
  }));
  return { items };
}

/* =========================
 * 流程：提問
 * ========================= */
async function askName(replyToken) {
  await reply(replyToken, [
    { type: 'text', text: MSG.hello1 },
    {
      type: 'text',
      text: MSG.hello2,
      quickReply: mkQuick([MSG.quickKeys.fill, MSG.quickKeys.cancel, MSG.quickKeys.restart])
    }
  ]);
}

async function askGender(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askGender,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askAge(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askAge,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askDate(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askDate,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askManiaB(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askManiaB,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askManiaE(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askManiaE,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askScore(replyToken, L) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askScore(L),
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}
async function askWants(replyToken) {
  await reply(replyToken, [{
    type: 'text',
    text: MSG.askWants,
    quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart])
  }]);
}

/* =========================
 * 送出分析（呼叫你現有 /api/submit-oca）
 * ========================= */
async function submitAndAck(uid, replyToken, payload) {
  // push結果，reply 先回「分析處理中」
  await reply(replyToken, [{ type: 'text', text: '分析處理中，請稍候…' }]);

  const url = `${process.env.PUBLIC_BASE_URL || ''}/api/submit-oca`;
  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      console.error('submit-oca error:', r.status, t);
      await push(uid, [{ type: 'text', text: '分析送出失敗，請稍後再試或輸入「填表」改用表單。' }]);
    }
  } catch (e) {
    console.error(e);
    await push(uid, [{ type: 'text', text: '分析送出失敗，請稍後再試或輸入「填表」改用表單。' }]);
  }
}

/* =========================
 * 主流程處理
 * ========================= */
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, raw)) return res.status(403).send('Bad signature');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      const replyToken = ev.replyToken;
      const src = ev.source || {};
      const uid = src.userId || '';
      if (!uid || !replyToken) continue;

      // 只處理文字訊息
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const text = (ev.message.text || '').trim();

      // 取 session
      const ss = getS(uid);

      // ===== 指令（可隨時輸入） =====
      if (text === MSG.quickKeys.cancel) {
        ss.confirm = 'cancel';
        saveS(uid, ss);
        await reply(replyToken, [{ type: 'text', text: MSG.confirmCancel, quickReply: mkQuick([MSG.quickKeys.restart]) }]);
        continue;
      }
      if (text === MSG.quickKeys.restart) {
        ss.confirm = 'restart';
        saveS(uid, ss);
        await reply(replyToken, [{ type: 'text', text: MSG.confirmRestart, quickReply: mkQuick([MSG.quickKeys.cancel]) }]);
        continue;
      }
      if (ss.confirm === 'cancel') {
        if (text === '1') {
          // 確定取消
          S.delete(uid);
          await reply(replyToken, [{ type: 'text', text: MSG.canceled }]);
        } else if (text === '2') {
          ss.confirm = null;
          saveS(uid, ss);
          await reply(replyToken, [{ type: 'text', text: MSG.alreadyIn }]);
        } else {
          await reply(replyToken, [{ type: 'text', text: MSG.notOption }]);
        }
        continue;
      }
      if (ss.confirm === 'restart') {
        if (text === '1') {
          // 確定重來
          S.delete(uid);
          const nss = getS(uid);
          nss.step = 'name';
          saveS(uid, nss);
          await reply(replyToken, [{ type: 'text', text: MSG.restarted }]);
        } else if (text === '2') {
          ss.confirm = null;
          saveS(uid, ss);
          await reply(replyToken, [{ type: 'text', text: MSG.alreadyIn }]);
        } else {
          await reply(replyToken, [{ type: 'text', text: MSG.notOption }]);
        }
        continue;
      }

      if (text === MSG.quickKeys.fill) {
        // 立即開始
        ss.step = 'name';
        ss.data = {};
        saveS(uid, ss);
        await askName(replyToken); // 兩段式（hello1 + hello2）
        continue;
      }

      // ===== 首次互動：去抖 + 冷啟容錯 =====
      if (!ss.step) {
        // 15 秒內不要重複丟歡迎詞（LINE 可能重送事件）
        const tooClose = now() - (ss.helloAt || 0) < 15000;

        // 若看起來像是中文姓名（非指令、非選項），就直接把此訊息當「姓名」處理，不再丟歡迎詞
        const maybeName = !/^\d/.test(text) && ![MSG.quickKeys.cancel, MSG.quickKeys.restart].includes(text);
        if (maybeName && !tooClose) {
          ss.step = 'gender';
          ss.data = { name: text };
          ss.helloAt = now(); // 仍記錄，避免重複
          saveS(uid, ss);
          await askGender(replyToken);
          continue;
        }

        // 正常首問（兩段式）－只發一次
        if (!tooClose) {
          ss.step = 'name';
          ss.data = {};
          ss.helloAt = now();
          saveS(uid, ss);
          await askName(replyToken);
          continue;
        }

        // 去抖時間內重送：提醒正在進行
        await reply(replyToken, [{ type: 'text', text: MSG.alreadyIn }]);
        continue;
      }

      // ===== 依步驟處理 =====
      if (ss.step === 'name') {
        if (!text || /^\d+$/.test(text)) {
          await reply(replyToken, [{ type: 'text', text: '看起來不像姓名，請直接輸入姓名文字。' }]);
          continue;
        }
        ss.data.name = text;
        ss.step = 'gender';
        saveS(uid, ss);
        await askGender(replyToken);
        continue;
      }

      if (ss.step === 'gender') {
        const mp = { '1': '男', '2': '女', '3': '其他' };
        const g = mp[text] || (['男', '女', '其他'].includes(text) ? text : null);
        if (!g) { await reply(replyToken, [{ type: 'text', text: MSG.notOption }]); continue; }
        ss.data.gender = g;
        ss.step = 'age';
        saveS(uid, ss);
        await askAge(replyToken);
        continue;
      }

      if (ss.step === 'age') {
        let age;
        if (text === '1') {
          age = 14;
        } else if (isInt(text)) {
          age = parseIntSafe(text);
        }
        if (!isInt(age) || age < 14) {
          await reply(replyToken, [{ type: 'text', text: MSG.needAge14 }]);
          continue;
        }
        ss.data.age = age;
        ss.step = 'date';
        saveS(uid, ss);
        await askDate(replyToken);
        continue;
      }

      if (ss.step === 'date') {
        let dStr = '';
        if (text === '1') {
          const d = new Date();
          const m = String(d.getMonth()+1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          dStr = `${d.getFullYear()}/${m}/${day}`;
        } else if (isValidDateStr(text)) {
          dStr = text;
        } else {
          await reply(replyToken, [{ type: 'text', text: MSG.notDate }]);
          continue;
        }
        ss.data.date = dStr;
        ss.step = 'maniaB';
        saveS(uid, ss);
        await askManiaB(replyToken);
        continue;
      }

      if (ss.step === 'maniaB') {
        const mp = { '1': true, '2': false, '有': true, '無': false };
        if (!(text in mp)) { await reply(replyToken, [{ type: 'text', text: MSG.notOption }]); continue; }
        ss.data.maniaB = mp[text];
        ss.step = 'maniaE';
        saveS(uid, ss);
        await askManiaE(replyToken);
        continue;
      }

      if (ss.step === 'maniaE') {
        const mp = { '1': true, '2': false, '有': true, '無': false };
        if (!(text in mp)) { await reply(replyToken, [{ type: 'text', text: MSG.notOption }]); continue; }
        ss.data.maniaE = mp[text];
        ss.step = `score_${LETTERS[0]}`; // A 開始
        saveS(uid, ss);
        await askScore(replyToken, LETTERS[0]);
        continue;
      }

      if (ss.step?.startsWith('score_')) {
        const L = ss.step.split('_')[1];
        if (!isInt(text)) { await reply(replyToken, [{ type: 'text', text: MSG.notNumber }]); continue; }
        const v = parseIntSafe(text);
        if (v < -100 || v > 100) { await reply(replyToken, [{ type: 'text', text: '需介於 -100 ~ 100。' }]); continue; }

        ss.data.scores = ss.data.scores || {};
        ss.data.scores[L] = v;

        const idx = LETTERS.indexOf(L);
        if (idx < LETTERS.length - 1) {
          const nextL = LETTERS[idx + 1];
          ss.step = `score_${nextL}`;
          saveS(uid, ss);
          await askScore(replyToken, nextL);
          continue;
        } else {
          ss.step = 'wants';
          saveS(uid, ss);
          await askWants(replyToken);
          continue;
        }
      }

      if (ss.step === 'wants') {
        const wants = { single: true, combo: true, persona: true }; // 預設全開
        const low = text.replace(/\s/g,'').toLowerCase();
        if (low !== '全部' && low !== '全' && low !== 'all') {
          // 解析 1,2,3
          const parts = low.split(/[,，]/).filter(Boolean);
          wants.single = parts.includes('1');
          wants.combo = parts.includes('2');
          wants.persona = parts.includes('3');
          if (!wants.single && !wants.combo && !wants.persona) {
            await reply(replyToken, [{ type: 'text', text: MSG.notOption }]);
            continue;
          }
        }
        // 送出
        const payload = {
          userId: uid,
          name: ss.data.name,
          gender: ss.data.gender,
          age: ss.data.age,
          date: ss.data.date,
          mania: ss.data.maniaB || ss.data.maniaE, // 你原本就用布林判斷
          scores: ss.data.scores || {},
          wants
        };
        // 清掉 session，避免後續重複
        S.delete(uid);

        await submitAndAck(uid, replyToken, payload);
        continue;
      }

      // 落網之魚
      await reply(replyToken, [{
        type: 'text',
        text: `${MSG.alreadyIn}\n${MSG.cmdHint}`,
        quickReply: mkQuick([MSG.quickKeys.cancel, MSG.quickKeys.restart, MSG.quickKeys.fill])
      }]);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
