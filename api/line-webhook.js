// api/line-webhook.js  (ESM, Node 22)
// v6: 修正「想看內容=全部」會誤觸送出；新增 A~J 逐題輸入（-100~100），完成後才可「分析」送出

import crypto from 'node:crypto';

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

/* ---------- LINE HTTP ---------- */
async function lineReply(replyToken, messages) {
  const body = { replyToken, messages: Array.isArray(messages) ? messages : [messages] };
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('Reply API error:', res.status, await res.text().catch(() => ''));
  }
}

/* ---------- In-Memory Session ---------- */
const SESS = new Map(); // userId -> session
function getSess(uid) {
  if (!SESS.has(uid)) SESS.set(uid, { step: 'idle', data: {}, greeted: false });
  return SESS.get(uid);
}
function resetSess(uid, keepGreeted = true) {
  const greeted = keepGreeted && getSess(uid).greeted;
  SESS.set(uid, { step: 'idle', data: {}, greeted });
}

/* ---------- 文案 ---------- */
const MSG = {
  hello1: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。',
  hello2: '請輸入填表人姓名：',
  already: '我們正在進行中喔～我會幫你接續目前這一題。',
  cancelHint: '輸入「取消」可中止，或輸入「重新開始」隨時重來。也可輸入「填表」直接開始。',
  canceled: '好的，已取消本次填寫。如需再次開始，輸入「填表」或「重新開始」。',
  restarted: '已重新開始，從頭來一次。',
  startBtn: '開始填表',
  gender: '性別請選（輸入數字或文字皆可）：\n1. 男\n2. 女\n3. 其他',
  age: '年齡（必填，需 ≥14）：\n（直接輸入數字，例如 22）',
  date: '日期：輸入「1」代表今天，或手動輸入 YYYY/MM/DD。',
  maniaB: '躁狂（B 情緒）是否偏高？\n1. 有\n2. 無',
  maniaE: '躁狂（E 點）是否偏高？\n1. 有\n2. 無',
  wants: '想看的內容（可多選，空白代表全部）：\n1. A~J 單點\n2. 綜合重點\n3. 人物側寫\n請輸入像「1,2」或「全部」。',
  badInput: '看起來格式不對，請再試一次。',
  nextMark: '（收到，下一步）',
  afterScores: 'A~J 分數已填完。若要產生結果，請輸入「分析」。\n（或輸入「重新開始」重來）',
};

const QR = {
  start: [
    { type: 'action', action: { type: 'message', label: '填表', text: '填表' } },
    { type: 'action', action: { type: 'message', label: '重新開始', text: '重新開始' } },
    { type: 'action', action: { type: 'message', label: '取消', text: '取消' } },
  ],
  gender: [
    { type: 'action', action: { type: 'message', label: '1 男', text: '1' } },
    { type: 'action', action: { type: 'message', label: '2 女', text: '2' } },
    { type: 'action', action: { type: 'message', label: '3 其他', text: '3' } },
  ],
  yesno: [
    { type: 'action', action: { type: 'message', label: '1 有', text: '1' } },
    { type: 'action', action: { type: 'message', label: '2 無', text: '2' } },
  ],
  date: [{ type: 'action', action: { type: 'message', label: '1 今天', text: '1' } }],
};

/* ---------- A~J 定義 ---------- */
const POINTS = [
  { key: 'A', name: '穩定性' },
  { key: 'B', name: '愉快' },
  { key: 'C', name: '鎮定' },
  { key: 'D', name: '確定力' },
  { key: 'E', name: '活躍' },
  { key: 'F', name: '積極' },
  { key: 'G', name: '負責' },
  { key: 'H', name: '評估能力' },
  { key: 'I', name: '欣賞能力' },
  { key: 'J', name: '溝通能力' },
];
const scorePrompt = (idx) => {
  const p = POINTS[idx];
  return `請輸入 ${p.key}（${p.name}）分數（-100～100）：`;
};

/* ---------- 小幫手 ---------- */
const toInt = s => {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : NaN;
};
const toYesNo = s => {
  const t = String(s).trim();
  if (t === '1' || /^(有|yes|y)$/i.test(t)) return true;
  if (t === '2' || /^(無|no|n)$/i.test(t)) return false;
  return null;
};
const parseGender = s => {
  const t = String(s).trim();
  if (t === '1' || /^男$/.test(t)) return '男';
  if (t === '2' || /^女$/.test(t)) return '女';
  if (t === '3' || /^其他$/.test(t)) return '其他';
  return null;
};
const parseDateInput = s => {
  const t = String(s).trim();
  if (t === '1') {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(t)) return t;
  return null;
};

/* ---------- 主 Handler ---------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // 簽名驗證（有設才驗）
  const signature = req.headers['x-line-signature'];
  if (CHANNEL_SECRET && signature) {
    const bodyStr = JSON.stringify(req.body);
    const mac = crypto.createHmac('sha256', CHANNEL_SECRET).update(bodyStr).digest('base64');
    if (mac !== signature) return res.status(401).send('Bad signature');
  }

  try {
    const events = req.body?.events ?? [];
    for (const e of events) {
      if (e.type !== 'message' || e.message?.type !== 'text') continue;

      const text = String(e.message.text || '').trim();
      const uid = e.source?.userId || '';
      const replyToken = e.replyToken;
      if (!uid) continue;

      /* 全域指令 */
      if (/^取消$/.test(text)) {
        resetSess(uid);
        await lineReply(replyToken, { type: 'text', text: MSG.canceled, quickReply: { items: QR.start } });
        continue;
      }
      if (/^重新開始$/.test(text)) {
        resetSess(uid);
        await lineReply(replyToken, { type: 'text', text: MSG.restarted, quickReply: { items: QR.start } });
        const s = getSess(uid);
        s.step = 'name';
        await lineReply(replyToken, { type: 'text', text: MSG.hello2 });
        continue;
      }
      if (/^填表$/.test(text)) {
        const s = getSess(uid);
        s.greeted = true;
        s.step = 'name';
        await lineReply(replyToken, [
          { type: 'text', text: MSG.hello1 },
          { type: 'text', text: MSG.hello2 },
        ]);
        continue;
      }

      const s = getSess(uid);

      /* 第一次歡迎 */
      if (s.step === 'idle' && !s.greeted) {
        s.greeted = true;
        s.step = 'name';
        await lineReply(replyToken, [
          { type: 'text', text: MSG.hello1 },
          { type: 'text', text: MSG.hello2, quickReply: { items: QR.start } },
        ]);
        continue;
      }

      switch (s.step) {
        case 'idle':
          await lineReply(replyToken, {
            type: 'text',
            text: `輸入「填表」即可開始聊天填表。\n${MSG.cancelHint}`,
            quickReply: { items: QR.start },
          });
          break;

        case 'name': {
          const name = text.trim();
          if (!name) {
            await lineReply(replyToken, { type: 'text', text: '請輸入姓名（不可空白）。' });
            break;
          }
          s.data.name = name;
          s.step = 'gender';
          await lineReply(replyToken, {
            type: 'text',
            text: `${MSG.nextMark}\n${MSG.gender}`,
            quickReply: { items: QR.gender },
          });
          break;
        }

        case 'gender': {
          const g = parseGender(text);
          if (!g) {
            await lineReply(replyToken, {
              type: 'text',
              text: MSG.badInput + '\n' + MSG.gender,
              quickReply: { items: QR.gender },
            });
            break;
          }
          s.data.gender = g;
          s.step = 'age';
          await lineReply(replyToken, { type: 'text', text: MSG.age });
          break;
        }

        case 'age': {
          const n = toInt(text);
          if (!Number.isFinite(n) || n < 14 || n > 120) {
            await lineReply(replyToken, { type: 'text', text: '年齡需是 14~120 的整數，請重新輸入。' });
            break;
          }
          s.data.age = n;
          s.step = 'date';
          await lineReply(replyToken, { type: 'text', text: MSG.date, quickReply: { items: QR.date } });
          break;
        }

        case 'date': {
          const d = parseDateInput(text);
          if (!d) {
            await lineReply(replyToken, { type: 'text', text: MSG.badInput + '\n' + MSG.date, quickReply: { items: QR.date } });
            break;
          }
          s.data.date = d;
          s.step = 'maniaB';
          await lineReply(replyToken, { type: 'text', text: MSG.maniaB, quickReply: { items: QR.yesno } });
          break;
        }

        case 'maniaB': {
          const v = toYesNo(text);
          if (v === null) {
            await lineReply(replyToken, { type: 'text', text: MSG.badInput + '\n' + MSG.maniaB, quickReply: { items: QR.yesno } });
            break;
          }
          s.data.maniaB = v;
          s.step = 'maniaE';
          await lineReply(replyToken, { type: 'text', text: MSG.maniaE, quickReply: { items: QR.yesno } });
          break;
        }

        case 'maniaE': {
          const v = toYesNo(text);
          if (v === null) {
            await lineReply(replyToken, { type: 'text', text: MSG.badInput + '\n' + MSG.maniaE, quickReply: { items: QR.yesno } });
            break;
          }
          s.data.maniaE = v;
          s.step = 'wants';
          await lineReply(replyToken, { type: 'text', text: MSG.wants });
          break;
        }

        case 'wants': {
          const t = text.replace(/，/g, ',').trim();
          let wants = { single: false, combo: false, persona: false };
          if (!t || /^全部$/.test(t)) wants = { single: true, combo: true, persona: true };
          else {
            const parts = t.split(',').map(x => x.trim()).filter(Boolean);
            for (const p of parts) {
              if (p === '1') wants.single = true;
              if (p === '2') wants.combo = true;
              if (p === '3') wants.persona = true;
            }
            if (!wants.single && !wants.combo && !wants.persona) {
              await lineReply(replyToken, { type: 'text', text: MSG.badInput + '\n' + MSG.wants });
              break;
            }
          }
          s.data.wants = wants;

          // 進入逐題輸入 A~J
          s.data.scores = {};
          s.scoreIdx = 0;
          s.step = 'score';
          await lineReply(replyToken, { type: 'text', text: scorePrompt(s.scoreIdx) });
          break;
        }

        case 'score': {
          // 必須輸入 -100 ~ 100 的整數
          const n = toInt(text);
          if (!Number.isInteger(n) || n < -100 || n > 100) {
            await lineReply(replyToken, { type: 'text', text: '請輸入 -100～100 的整數。' });
            break;
          }
          const p = POINTS[s.scoreIdx];
          s.data.scores[p.key] = n;

          s.scoreIdx += 1;
          if (s.scoreIdx < POINTS.length) {
            await lineReply(replyToken, { type: 'text', text: scorePrompt(s.scoreIdx) });
          } else {
            // A~J 全部填完
            s.step = 'afterScores';
            await lineReply(replyToken, { type: 'text', text: MSG.afterScores });
          }
          break;
        }

        case 'afterScores': {
          if (/^(分析|送出)$/.test(text)) {
            await lineReply(replyToken, { type: 'text', text: '分析處理中，請稍候…' });
            // 這裡接你的分析 API / 呈現結果（略）。若已有 /api/analyze，可在這裡呼叫並把結果回傳。
          } else {
            await lineReply(replyToken, { type: 'text', text: '若要產生結果，請輸入「分析」。' });
          }
          break;
        }

        default:
          await lineReply(replyToken, { type: 'text', text: MSG.already });
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
}
