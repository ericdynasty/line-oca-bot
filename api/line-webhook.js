// /api/line-webhook.js
// v5: 歡迎詞分成兩則 + 指令（取消 / 重新開始 / 填表）+ 防誤觸 + 按鍵式問答 + 數字化輸入
//    內建簡易流程暫存（Map），無 DB 版

// ====== 常用文字 ======
const MSG = {
  hello1: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。',
  hello2: '請輸入填表人姓名：',

  cancelHint: '輸入「取消」可中止，或輸入「重新開始」隨時重來。',
  canceled: '已取消這次填寫。要再開始，請輸入「填表」、或點下方按鈕。',
  restarted: '已重新開始，從頭來一次。',
  alreadyInFlow: '我們正在進行中喔～我再幫你接續目前這一題。',
  startBtn: '開始填寫～',

  // 驗證錯誤
  askName: '請輸入填表人姓名：',
  askGender: '性別請選：1. 男　2. 女　3. 其他（直接輸入 1/2/3）',
  askAge: '年齡（必填，需 ≥14）：請輸入數字（例如 16）',
  askDate: '日期：輸入 1 代表今天；或輸入 YYYY/MM/DD（例如 2025/09/02）',
  askManiaB: '躁狂（B 情緒）：1. 有　2. 無（直接輸入 1/2）',
  askManiaE: '躁狂（E 點）：1. 有　2. 無（直接輸入 1/2）',

  askWant: '想看的內容（可擇一或最後選「全部」）：\n1. A~J 單點\n2. 綜合分析 + 痛點\n3. 人物側寫\n4. 全部（直接輸入 1/2/3/4）',

  // A~J
  askScore: (L, name) => `請輸入 ${L} 點（-100～100）的分數：`,
  invalidScore: '分數需介於 -100 ~ 100，請重新輸入（或點下方快捷）。',

  // 通用
  typeContinue: '輸入「繼續」回到當前題目，或「取消」「重新開始」。',
  processing: '分析處理中，請稍候...',
  submitOK: '資料已送出，分析將稍後送達。',
  submitFail: '分析送出失敗，請稍後再試或改用「填表」。',
};

// ====== 依序要問的 A~J ======
const LETTERS = 'ABCDEFGHIJ'.split('');

// ====== Node 18+ 內建 fetch，若執行環境無則動態載入 ======
const crypto = require('crypto');
const fetchFn = (...args) => (typeof fetch === 'function' ? fetch(...args) : import('node-fetch').then(m => m.default(...args)));

// ====== LINE 環境變數 ======
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || process.env.CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN || '';

// ====== Reply API ======
async function replyMessage(replyToken, messages) {
  const resp = await fetchFn('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('Reply API error:', resp.status, t);
  }
}

// ====== 簽章驗證 ======
function verifySignature(sig, body) {
  if (!CHANNEL_SECRET) return false;
  const h = crypto.createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
  return sig === h;
}

// ====== 小工具 ======
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}/${m}/${day}`;
};
const isDateYYYYMMDD = (s) => /^\d{4}\/\d{2}\/\d{2}$/.test(s);

// 快捷鈕產生器
const quickItem = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });

// ====== 流程暫存（無 DB 版本） ======
const FLOW = new Map();
/*
  session 結構：
  {
    active: true/false,
    stage: 'name' | 'gender' | 'age' | 'date' | 'maniaB' | 'maniaE' | 'A'...'J' | 'want' | 'done',
    name, gender, age, date, maniaB, maniaE,
    scores: { A:0, B:0, ... },
  }
*/
const getFlow = (uid) => FLOW.get(uid) || null;
const setFlow = (uid, data) => {
  const now = getFlow(uid) || {};
  FLOW.set(uid, { ...now, ...data });
};
const resetFlow = (uid) => {
  FLOW.set(uid, { active: true, stage: 'name', scores: {} });
};
const clearFlow = (uid) => FLOW.delete(uid);

// ====== 啟動提問（各題目） ======
async function askName(ev) {
  await replyMessage(ev.replyToken, [
    { type: 'text', text: MSG.hello1 },
    {
      type: 'text',
      text: MSG.hello2,
      quickReply: {
        items: [
          quickItem('取消', '取消'),
          quickItem('重新開始', '重新開始'),
        ],
      },
    },
  ]);
}
async function askGender(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askGender,
    quickReply: { items: [quickItem('1 男', '1'), quickItem('2 女', '2'), quickItem('3 其他', '3'), quickItem('取消', '取消')] },
  }]);
}
async function askAge(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askAge,
    quickReply: { items: [quickItem('14', '14'), quickItem('18', '18'), quickItem('25', '25'), quickItem('取消', '取消')] },
  }]);
}
async function askDate(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askDate,
    quickReply: { items: [quickItem('今天(1)', '1'), quickItem(todayStr(), todayStr()), quickItem('取消', '取消')] },
  }]);
}
async function askManiaB(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askManiaB,
    quickReply: { items: [quickItem('有(1)', '1'), quickItem('無(2)', '2'), quickItem('取消', '取消')] },
  }]);
}
async function askManiaE(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askManiaE,
    quickReply: { items: [quickItem('有(1)', '1'), quickItem('無(2)', '2'), quickItem('取消', '取消')] },
  }]);
}
async function askScore(ev, L) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askScore(L),
    quickReply: {
      items: [
        quickItem('-50', '-50'),
        quickItem('-25', '-25'),
        quickItem(' 0 ', '0'),
        quickItem(' 25', '25'),
        quickItem(' 50', '50'),
        quickItem('取消', '取消'),
      ],
    },
  }]);
}
async function askWant(ev) {
  await replyMessage(ev.replyToken, [{
    type: 'text',
    text: MSG.askWant,
    quickReply: {
      items: [
        quickItem('1 單點', '1'),
        quickItem('2 綜合+痛點', '2'),
        quickItem('3 側寫', '3'),
        quickItem('4 全部', '4'),
        quickItem('取消', '取消'),
      ],
    },
  }]);
}

// ====== 推進到下一題 ======
function nextLetter(cur) {
  if (!cur) return LETTERS[0];
  const idx = LETTERS.indexOf(cur);
  if (idx < 0 || idx === LETTERS.length - 1) return null;
  return LETTERS[idx + 1];
}

// ====== 提交到 /api/submit-oca ======
async function submitToBackend(body) {
  const url = `${process.env.PUBLIC_BASE_URL || ''}/api/submit-oca`;
  if (!url) throw new Error('PUBLIC_BASE_URL 未設定');
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`submit-oca failed: ${resp.status} ${t}`);
  }
  return resp.json().catch(() => ({}));
}

// ====== 主要入口 ======
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) return res.status(403).send('Bad signature');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    // 逐筆處理 LINE 事件
    for (const ev of events) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

      const userId = ev.source?.userId;
      if (!userId) continue;

      const textRaw = (ev.message.text || '').trim();
      const text = textRaw; // 不轉小寫，因為是數字選項
      const session = getFlow(userId);
      const inFlow = !!session?.active;

      // ===== 1) 指令：取消 / 重新開始 / 填表 / 開始 =====
      if (/^(取消)$/i.test(text)) {
        clearFlow(userId);
        await replyMessage(ev.replyToken, [
          { type: 'text', text: MSG.canceled },
          {
            type: 'text',
            text: MSG.cancelHint,
            quickReply: {
              items: [quickItem('填表', '填表'), quickItem('重新開始', '重新開始')],
            },
          },
        ]);
        continue;
      }

      if (/^(重新開始)$/i.test(text)) {
        resetFlow(userId);
        await replyMessage(ev.replyToken, [
          { type: 'text', text: MSG.restarted },
          {
            type: 'text',
            text: MSG.startBtn,
            quickReply: {
              items: [quickItem('開始', '開始'), quickItem('取消', '取消')],
            },
          },
        ]);
        continue;
      }

      if (/^(填表|開始)$/i.test(text)) {
        resetFlow(userId);
        await askName(ev);
        continue;
      }

      // ===== 2) 正在流程中但輸入其他字 → 防誤觸提醒（在各題處理後會跳過這段）=====
      // 這段會在每題處理後 return，不會錯誤觸發
      // 只有完全沒有命中的才會走到這裡
      // 但為了不攔截有效輸入，這段放在每題處理邏輯最後的「兜底」
      const guard = async () => {
        if (inFlow) {
          await replyMessage(ev.replyToken, [{
            type: 'text',
            text: MSG.alreadyInFlow,
            quickReply: {
              items: [quickItem('繼續', '繼續'), quickItem('取消', '取消'), quickItem('重新開始', '重新開始')],
            },
          }]);
          return true;
        }
        return false;
      };

      // ===== 3) 若不在流程中 → 送歡迎詞（兩則）+ 快捷鍵 =====
      if (!inFlow) {
        await askName(ev);
        continue;
      }

      // ===== 4) 流程問答（State Machine）=====
      // stage: name → gender → age → date → maniaB → maniaE → A → ... → J → want → done
      let stage = session.stage;

      // 允許使用者輸入「繼續」回到當前題目（不改 stage）
      if (/^繼續$/i.test(text)) {
        // 重問當前題
        if (stage === 'name') { await askName(ev); continue; }
        if (stage === 'gender') { await askGender(ev); continue; }
        if (stage === 'age') { await askAge(ev); continue; }
        if (stage === 'date') { await askDate(ev); continue; }
        if (stage === 'maniaB') { await askManiaB(ev); continue; }
        if (stage === 'maniaE') { await askManiaE(ev); continue; }
        if (LETTERS.includes(stage)) { await askScore(ev, stage); continue; }
        if (stage === 'want') { await askWant(ev); continue; }
      }

      // --- name ---
      if (stage === 'name') {
        const name = text.replace(/\s+/g, '');
        if (!name) {
          await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.askName }]);
          continue;
        }
        setFlow(userId, { name, stage: 'gender' });
        await askGender(ev);
        continue;
      }

      // --- gender (1/2/3) ---
      if (stage === 'gender') {
        const map = { '1': '男', '2': '女', '3': '其他' };
        if (!map[text]) { await askGender(ev); continue; }
        setFlow(userId, { gender: map[text], stage: 'age' });
        await askAge(ev);
        continue;
      }

      // --- age (>=14) ---
      if (stage === 'age') {
        const n = Number(text);
        if (!Number.isFinite(n) || n < 14) { await askAge(ev); continue; }
        setFlow(userId, { age: n, stage: 'date' });
        await askDate(ev);
        continue;
      }

      // --- date (1 today or YYYY/MM/DD) ---
      if (stage === 'date') {
        let d = text;
        if (text === '1') d = todayStr();
        if (!isDateYYYYMMDD(d)) { await askDate(ev); continue; }
        setFlow(userId, { date: d, stage: 'maniaB' });
        await askManiaB(ev);
        continue;
      }

      // --- maniaB (1 yes / 2 no) ---
      if (stage === 'maniaB') {
        if (!/^[12]$/.test(text)) { await askManiaB(ev); continue; }
        const maniaB = text === '1';
        setFlow(userId, { maniaB, stage: 'maniaE' });
        await askManiaE(ev);
        continue;
      }

      // --- maniaE (1 yes / 2 no) ---
      if (stage === 'maniaE') {
        if (!/^[12]$/.test(text)) { await askManiaE(ev); continue; }
        const maniaE = text === '1';
        // 進入 A 分數
        setFlow(userId, { maniaE, stage: 'A' });
        await askScore(ev, 'A');
        continue;
      }

      // --- A~J 分數 ---
      if (LETTERS.includes(stage)) {
        const v = Number(text);
        if (!Number.isFinite(v) || v < -100 || v > 100) {
          await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.invalidScore }]);
          await askScore(ev, stage);
          continue;
        }
        // 記錄分數
        const scores = session.scores || {};
        scores[stage] = v;
        setFlow(userId, { scores });

        const next = nextLetter(stage);
        if (next) {
          setFlow(userId, { stage: next });
          await askScore(ev, next);
          continue;
        } else {
          // J 填完，問想看內容
          setFlow(userId, { stage: 'want' });
          await askWant(ev);
          continue;
        }
      }

      // --- 想看內容 (1/2/3/4) ---
      if (stage === 'want') {
        if (!/^[1-4]$/.test(text)) { await askWant(ev); continue; }
        const map = {
          1: { single: true, combo: false, persona: false },
          2: { single: false, combo: true, persona: false },
          3: { single: false, combo: false, persona: true },
          4: { single: true, combo: true, persona: true },
        };
        const wants = map[text];
        setFlow(userId, { wants, stage: 'done' });

        // 送出
        await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.processing }]);
        try {
          await submitToBackend({
            userId,
            name: session.name,
            gender: session.gender,
            age: session.age,
            date: session.date,
            mania: (session.maniaB ? 'B有 ' : 'B無 ') + (session.maniaE ? 'E有' : 'E無'),
            scores: session.scores,
            wants,
          });
          await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.submitOK }]);
        } catch (e) {
          console.error(e);
          await replyMessage(ev.replyToken, [{ type: 'text', text: MSG.submitFail }]);
        } finally {
          clearFlow(userId);
        }
        continue;
      }

      // --- 兜底：流程中但沒命中 ---
      const wasGuarded = await guard();
      if (wasGuarded) continue;

      // --- 兜底：非流程（理論上不會到這）---
      await askName(ev);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
