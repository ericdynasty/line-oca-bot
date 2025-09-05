// api/line-webhook.js
// 單檔可覆蓋版：修正「輸入姓名後卡住/重複」→ 姓名寫入後必定續問下一題
// 支援：填表 / 重新開始 / 取消 指令；數字選單；A~J 依序輸入；可輸入「分析」觸發後端分析（可依你現有 analyze/submit API 調整）
//
// 環境變數：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN
// Node: ESM

import { Client, validateSignature } from '@line/bot-sdk';

// ------- LINE 基本設定 -------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || process.env.CHANNEL_SECRET || '',
};
const client = new Client(config);

// ------- 極簡 session（記憶體） -------
/** @type {Map<string, any>} */
const sessions = new Map();
const SCORE_KEYS = ['A','B','C','D','E','F','G','H','I','J'];

function getSession(uid) {
  let s = sessions.get(uid);
  if (!s) {
    s = freshSession();
    sessions.set(uid, s);
  }
  return s;
}
function freshSession() {
  return {
    phase: 'idle',          // idle | form | done
    step: 0,                // 目前進度
    form: {
      name: '',
      gender: '',           // 男/女/其他
      age: null,            // number
      date: '',             // YYYY/MM/DD
      maniaB: null,         // true/false
      maniaE: null,         // true/false
      want: 4,              // 1~4; 4=全部
      scores: { A:null,B:null,C:null,D:null,E:null,F:null,G:null,H:null,I:null,J:null },
    },
    scoreIndex: 0,          // A~J 進度
    waiting: null,          // 目前等哪一題（僅供除錯）
  };
}
function resetToForm(s) {
  const keepScores = false; // 若要保留舊分數可改 true
  const base = freshSession();
  if (keepScores) base.form.scores = s.form.scores;
  sessions.set(s.userId, base);
  return base;
}

// ------- 小工具 -------
function todayStr() {
  const d = new Date();
  const mm = `${d.getMonth()+1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}
function toNumberSafe(v) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}
function genderFromNum(n) {
  return ({ 1:'男', 2:'女', 3:'其他' })[n] || null;
}
function yesNoFromNum(n) {
  if (n === 1) return true;
  if (n === 2) return false;
  return null;
}
function buildQR(items) {
  // LINE Quick Reply
  return {
    items: items.map(({ label, text }) => ({
      type: 'action',
      action: { type: 'message', label, text },
    })),
  };
}

// ------- 問下一題（核心修正：每題寫入後一定會 call 這個續問） -------
async function askNext(replyToken, s) {
  s.waiting = null;

  // 依 step 順序詢問
  switch (s.step) {
    case 0: { // 歡迎 + 問姓名
      s.phase = 'form';
      s.waiting = 'name';
      s.step = 1;
      await client.replyMessage(replyToken, [
        { type: 'text', text: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。' },
        { type: 'text', text: '請輸入填表人姓名：' },
      ]);
      return;
    }
    case 1: { // 問性別
      s.waiting = 'gender';
      s.step = 2;
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '性別請選（輸入 1/2/3）：\n1. 男\n2. 女\n3. 其他',
        quickReply: buildQR([
          { label: '1 男', text: '1' },
          { label: '2 女', text: '2' },
          { label: '3 其他', text: '3' },
        ]),
      });
      return;
    }
    case 2: { // 問年齡
      s.waiting = 'age';
      s.step = 3;
      await client.replyMessage(replyToken, { type: 'text', text: '請輸入年齡（數字）：' });
      return;
    }
    case 3: { // 問日期
      s.waiting = 'date';
      s.step = 4;
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '日期：輸入「1」代表今天，或手動輸入 YYYY/MM/DD。',
        quickReply: buildQR([
          { label: '1 今天', text: '1' },
        ]),
      });
      return;
    }
    case 4: { // 躁狂 B（情緒）
      s.waiting = 'maniaB';
      s.step = 5;
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '躁狂（B 情緒）是否偏高？\n1. 有\n2. 無',
        quickReply: buildQR([
          { label: '1 有', text: '1' },
          { label: '2 無', text: '2' },
        ]),
      });
      return;
    }
    case 5: { // 躁狂 E（E 點）
      s.waiting = 'maniaE';
      s.step = 6;
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '躁狂（E 點）是否偏高？\n1. 有\n2. 無',
        quickReply: buildQR([
          { label: '1 有', text: '1' },
          { label: '2 無', text: '2' },
        ]),
      });
      return;
    }
    case 6: { // 想看的內容
      s.waiting = 'want';
      s.step = 7;
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '想看的內容（請選 1~4；4=全部）：\n1. A~J 單點\n2. 綜合重點\n3. 人物側寫\n4. 全部\n請輸入您的選項（1~4）。',
        quickReply: buildQR([
          { label: '1 A~J', text: '1' },
          { label: '2 綜合重點', text: '2' },
          { label: '3 人物側寫', text: '3' },
          { label: '4 全部', text: '4' },
        ]),
      });
      return;
    }
    // 之後是 A~J 分數
    default: {
      // 若 want 包含 1（或等同 4）才要進入 A~J
      const needScores = (s.form.want === 1 || s.form.want === 4);
      if (!needScores) {
        s.phase = 'done';
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '已記錄。若要產生分析，請輸入「分析」。或輸入「重新開始」重來。',
        });
        return;
      }
      // 還有分數要填
      if (s.scoreIndex < SCORE_KEYS.length) {
        const curKey = SCORE_KEYS[s.scoreIndex];
        s.waiting = `score:${curKey}`;
        await client.replyMessage(replyToken, {
          type: 'text',
          text: `請輸入 ${curKey}（${labelOfKey(curKey)}）分數（-100 ～ 100）：`,
        });
        return;
      }
      // A~J 填完
      s.phase = 'done';
      await client.replyMessage(replyToken, [
        { type: 'text', text: 'A~J 分數已填完。' },
        { type: 'text', text: '若要產生結果，請輸入「分析」。或輸入「重新開始」重來。' },
      ]);
    }
  }
}

function labelOfKey(key) {
  // 教材定義
  const map = {
    A:'穩定性', B:'愉快', C:'鎮定', D:'確定力', E:'活躍',
    F:'積極', G:'負責', H:'評估能力', I:'欣賞能力', J:'溝通能力',
  };
  return map[key] || key;
}

// ------- 寫入答案並續問（每次使用者回覆都走這裡） -------
async function writeAndNext(replyToken, s, text) {
  const t = String(text || '').trim();

  switch (s.waiting) {
    case 'name': {
      s.form.name = t;
      return askNext(replyToken, s);
    }
    case 'gender': {
      const g = genderFromNum(Number(t));
      if (!g) return client.replyMessage(replyToken, { type:'text', text:'請輸入 1/2/3。' });
      s.form.gender = g;
      return askNext(replyToken, s);
    }
    case 'age': {
      const n = toNumberSafe(t);
      if (!Number.isFinite(n) || n < 0) return client.replyMessage(replyToken, { type:'text', text:'請輸入正確的年齡（數字）。' });
      s.form.age = n;
      return askNext(replyToken, s);
    }
    case 'date': {
      if (t === '1') {
        s.form.date = todayStr();
      } else {
        // 簡單驗證 YYYY/MM/DD
        if (!/^\d{4}\/\d{2}\/\d{2}$/.test(t)) {
          return client.replyMessage(replyToken, { type:'text', text:'請輸入「1」或日期格式 YYYY/MM/DD。' });
        }
        s.form.date = t;
      }
      return askNext(replyToken, s);
    }
    case 'maniaB': {
      const v = yesNoFromNum(Number(t));
      if (v === null) return client.replyMessage(replyToken, { type:'text', text:'請輸入 1（有）或 2（無）。' });
      s.form.maniaB = v;
      return askNext(replyToken, s);
    }
    case 'maniaE': {
      const v = yesNoFromNum(Number(t));
      if (v === null) return client.replyMessage(replyToken, { type:'text', text:'請輸入 1（有）或 2（無）。' });
      s.form.maniaE = v;
      return askNext(replyToken, s);
    }
    case 'want': {
      const n = Number(t);
      if (![1,2,3,4].includes(n)) {
        return client.replyMessage(replyToken, { type:'text', text:'請輸入 1~4 其中一個數字。' });
      }
      s.form.want = n;
      // 若需要 A~J，進入分數回合；否則直接 done
      if (n === 1 || n === 4) {
        s.scoreIndex = 0;
        // step 設高一點避免再回想看的內容
        s.step = 999;
      }
      return askNext(replyToken, s);
    }
    default: {
      // 可能在填 A~J
      if (String(s.waiting || '').startsWith('score:')) {
        const k = s.waiting.split(':')[1];
        const val = toNumberSafe(t);
        if (!Number.isFinite(val) || val < -100 || val > 100) {
          return client.replyMessage(replyToken, { type:'text', text:'請輸入 -100 ～ 100 之間的數字。' });
        }
        s.form.scores[k] = val;
        s.scoreIndex += 1;
        return askNext(replyToken, s);
      }
      // 萬一 waiting 為空：補一個提示或重新導向
      return client.replyMessage(replyToken, { type:'text', text:'我在等下一個答案，若要重來請輸入「重新開始」。' });
    }
  }
}

// ------- 指令處理 -------
async function handleCommandText(replyToken, s, text) {
  const t = String(text).trim();

  // 系統指令
  if (t === '取消') {
    sessions.delete(s.userId);
    return client.replyMessage(replyToken, {
      type:'text',
      text:'已取消。若要重新開始，輸入「填表」。',
    });
  }
  if (t === '重新開始') {
    const ns = freshSession();
    ns.userId = s.userId;
    sessions.set(s.userId, ns);
    return askNext(replyToken, ns); // 直接從姓名開始
  }
  if (t === '填表') {
    if (s.phase !== 'form') {
      s.phase = 'form';
      s.step = 0;
      return askNext(replyToken, s);
    }
  }

  // 產生分析（你可以改成呼叫 /api/submit-oca 或 /api/analyze）
  if (t === '分析') {
    // 這裡僅示範：回應已接收。你可以改成呼叫你現有的分析 API。
    // const base = `https://${process.env.VERCEL_URL || ''}`; // 若要呼叫自己後端可用此組 URL
    await client.replyMessage(replyToken, { type:'text', text:'分析處理中，請稍候…（可依你現有的 API 實作）' });
    return;
  }

  // 其他文字：若在流程中就寫入答案；不在流程中就提示
  if (s.phase === 'form') {
    return writeAndNext(replyToken, s, t);
  }
  // 不在流程 → 提示開始
  return client.replyMessage(replyToken, {
    type:'text',
    text:'我在這裡～輸入「填表」開始填資料，或輸入「取消」離開。',
    quickReply: buildQR([
      { label:'開始填表', text:'填表' },
      { label:'重新開始', text:'重新開始' },
      { label:'取消', text:'取消' },
    ]),
  });
}

// ------- LINE webhook handler -------
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const signature = req.headers['x-line-signature'] || '';
    const bodyBuf = await readAll(req);
    const bodyText = bodyBuf.toString('utf8');

    if (!validateSignature(bodyText, config.channelSecret, signature)) {
      res.status(401).send('Bad signature');
      return;
    }
    const json = JSON.parse(bodyText);

    // 處理所有 event
    for (const ev of json.events || []) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const userId = ev.source?.userId || 'unknown';
      const s = getSession(userId);
      s.userId = userId;

      await handleCommandText(ev.replyToken, s, ev.message.text);
    }

    res.status(200).end();
  } catch (e) {
    console.error('webhook error:', e);
    res.status(200).end(); // 回 200 讓 LINE 不重送；實際錯誤已寫 log
  }
}

async function readAll(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
