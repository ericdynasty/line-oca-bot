// api/line-webhook.js (ESM) — 教材規則版：A~J單點文字直接套用 data/oca_rules.json
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

const SESS = new Map(); // userId -> { step, idx, data }

const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES = {
  A: 'A 穩定',
  B: 'B 價值',
  C: 'C 變化',
  D: 'D 果敢',
  E: 'E 活躍',
  F: 'F 樂觀',
  G: 'G 責任',
  H: 'H 評估力',
  I: 'I 欣賞能力',
  J: 'J 滿意能力',
};

function getSession(userId) {
  if (!SESS.has(userId)) {
    SESS.set(userId, { step: 'idle', idx: 0, data: { scores: {} } });
  }
  return SESS.get(userId);
}
function resetSession(userId) {
  SESS.set(userId, { step: 'idle', idx: 0, data: { scores: {} } });
}

// ====== LINE helpers ======
async function replyMessage(replyToken, messages) {
  const chunks = Array.isArray(messages) ? messages : [messages];
  const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages: chunks }),
  });
  if (!resp.ok) {
    console.error('LINE reply error:', resp.status, await resp.text().catch(() => ''));
  }
}
async function pushMessage(to, messages) {
  const chunks = Array.isArray(messages) ? messages : [messages];
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages: chunks }),
  });
  if (!resp.ok) {
    console.error('LINE push error:', resp.status, await resp.text().catch(() => ''));
  }
}
const qi = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });
const withQR = (text, items) => ({ type: 'text', text, quickReply: { items } });

// ====== 載入教材規則 ======
async function loadRulesSafe() {
  const file = path.join(process.cwd(), 'data', 'oca_rules.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const rules = JSON.parse(raw);
    return { ok: true, rules };
  } catch (err) {
    console.warn('loadRulesSafe failed:', err?.message || err);
    return { ok: false, rules: null };
  }
}

// ====== 簡版描述（規則缺失時的備援）======
function bandDesc(n) {
  if (n >= 41) return ['高(重)', '偏強勢、驅動力大'];
  if (n >= 11) return ['高(輕)', '略偏高、傾向較明顯'];
  if (n <= -41) return ['低(重)', '不足感明顯、需特別留意'];
  if (n <= -11) return ['低(輕)', '略偏低、偶爾受影響'];
  return ['中性', '較平衡、影響小'];
}
function topLetters(scores, k = 3) {
  return Object.entries(scores).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, k);
}

// ====== 用「教材規則」產生單點文字 ======
// 預期 oca_rules.json 的結構：
// {
//   "letters": {
//     "A": {
//       "name": "A 穩定",  // 可選，沒給就用 NAMES
//       "bands": [
//         { "min": 41,  "max": 100, "title": "高(重)", "text": "教材 A5 文案..." },
//         { "min": 11,  "max": 40,  "title": "高(輕)", "text": "教材 A3 文案..." },
//         { "min": -10, "max": 10,  "title": "中性",   "text": "教材 中性 文案..." },
//         { "min": -40, "max": -11, "title": "低(輕)", "text": "教材 A4 文案..." },
//         { "min": -100,"max": -41, "title": "低(重)", "text": "教材 A2 文案..." }
//       ]
//     },
//     ...
//   }
// }
function pickBandByRules(bands = [], n) {
  // 允許 band 沒有 max/min，預設 min=-100, max=100
  for (const b of bands) {
    const min = Number.isFinite(b.min) ? b.min : -100;
    const max = Number.isFinite(b.max) ? b.max : 100;
    if (n >= min && n <= max) return b;
  }
  return null;
}
function renderSingleByRules(scores, rules) {
  const out = [];
  const rs = rules?.letters || {};
  for (const L of LETTERS) {
    const val = Number(scores[L] ?? 0);
    const def = rs[L] || {};
    const label = def.name || NAMES[L];
    const b = pickBandByRules(def.bands, val);
    if (b) {
      const title = b.title ? `｜${b.title}` : '';
      out.push(`${label}：${val}${title}\n${b.text || ''}`.trim());
    } else {
      // 規則缺漏時用備援描述
      const [lvl, hint] = bandDesc(val);
      out.push(`${label}：${val}｜${lvl}\n— ${hint}`);
    }
  }
  return `【A~J 單點】\n${out.join('\n\n')}`;
}

// ====== 綜合重點 / 人物側寫（暫用簡版；要換教材句式再告訴我）======
function renderSummaryAndPersona(payload) {
  const { name, gender, age, maniaB, maniaE, scores } = payload;

  const tops = topLetters(scores, 3);
  const topsText = tops.map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`).join('、');

  const combo =
    `【綜合重點】\n` +
    `最需要留意／最有影響的面向：${topsText || '無特別突出'}。\n` +
    `躁狂（B 情緒）：${maniaB ? '有' : '無'}；躁狂（E 點）：${maniaE ? '有' : '無'}；\n` +
    `人員：${name || '未填'}；年齡：${age || '未填'}；性別：${gender || '未填'}。`;

  let persona = '【人物側寫】\n';
  if (tops.length >= 2) {
    const [L1, v1] = tops[0];
    const [L2, v2] = tops[1];
    const dir1 = v1 >= 0 ? '偏高' : '偏低';
    const dir2 = v2 >= 0 ? '偏高' : '偏低';
    persona += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${dir1 === '偏高' ? '主動' : '保守'}、${dir2 === '偏高' ? '外放' : '內斂'}」傾向（示意）。`;
  } else {
    persona += '整體表現較均衡。';
  }
  return { combo, persona };
}

// ====== 問答流程（同前一版）======
function startFlow(userId) {
  const s = getSession(userId);
  s.step = 'name';
  s.idx = 0;
  s.data = { scores: {} };
  return [
    { type: 'text', text: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。' },
    withQR('請輸入填表人姓名：', [qi('取消', '取消'), qi('重新開始', '重新開始')]),
  ];
}
const askGender = () =>
  withQR('性別請選（或輸入 1/2/3）：\n1. 男  2. 女  3. 其他', [qi('1 男', '1'), qi('2 女', '2'), qi('3 其他', '3')]);
const askAge = () => withQR('請輸入年齡（14~120）：', [qi('取消', '取消'), qi('重新開始', '重新開始')]);
const askManiaB = () => withQR('躁狂 B（情緒）是否偏高？\n1. 無  2. 有', [qi('1 無', '1'), qi('2 有', '2')]);
const askManiaE = () => withQR('躁狂 E（活躍）是否偏高？\n1. 無  2. 有', [qi('1 無', '1'), qi('2 有', '2')]);
const askLetter = (L) =>
  withQR(`請輸入 ${NAMES[L]}（-100～100）的分數：`, [qi('-50', '-50'), qi('0', '0'), qi('50', '50')]);
const askResultChoice = () =>
  withQR('想看的內容（可多選，空白代表全部）：\n1. A~J 單點  2. 綜合重點  3. 人物側寫', [
    qi('1', '1'),
    qi('2', '2'),
    qi('3', '3'),
    qi('全部', '全部'),
  ]);

function parseGender(v) {
  const t = (v || '').trim();
  if (t === '1' || /男/.test(t)) return '男';
  if (t === '2' || /女/.test(t)) return '女';
  if (t === '3' || /其/.test(t)) return '其他';
  return null;
}
function parseYesNo12(v) {
  const t = (v || '').trim();
  if (t === '1') return false;
  if (t === '2') return true;
  if (/^無$/.test(t)) return false;
  if (/^有$/.test(t)) return true;
  return null;
}
function parseWants(v) {
  const t = (v || '').replaceAll('，', ',').trim();
  if (!t || t === '全部') return { single: true, combo: true, persona: true };
  const nums = t.split(',').map((x) => x.trim());
  return { single: nums.includes('1'), combo: nums.includes('2'), persona: nums.includes('3') };
}

// ====== 主 Handler（同前一版，只有分析段落換成教材規則）======
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }
  try {
    const raw = JSON.stringify(req.body || {});
    const sig = req.headers['x-line-signature'] || '';
    if (CHANNEL_SECRET) {
      const calc = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
      if (sig !== calc) console.warn('⚠️ signature mismatch (略過以利除錯)');
    }
  } catch {}

  const events = req.body?.events || [];
  for (const ev of events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

    const userId = ev.source?.userId;
    const text = (ev.message?.text || '').trim();
    const s = getSession(userId);

    if (/^取消$/.test(text)) {
      resetSession(userId);
      await replyMessage(ev.replyToken, withQR('已取消。要重新開始嗎？', [qi('填表', '填表'), qi('重新開始', '重新開始')]));
      continue;
    }
    if (/^(填表|聊天填表|開始|重新開始)$/.test(text)) {
      const msgs = startFlow(userId);
      await replyMessage(ev.replyToken, msgs);
      continue;
    }

    if (s.step === 'idle') {
      await replyMessage(ev.replyToken, withQR('輸入「填表」即可開始聊天填表。', [qi('填表', '填表'), qi('取消', '取消')]));
      continue;
    }

    if (s.step === 'name') {
      s.data.name = text.slice(0, 30);
      s.step = 'gender';
      await replyMessage(ev.replyToken, askGender());
      continue;
    }
    if (s.step === 'gender') {
      const g = parseGender(text);
      if (!g) { await replyMessage(ev.replyToken, askGender()); continue; }
      s.data.gender = g;
      s.step = 'age';
      await replyMessage(ev.replyToken, askAge());
      continue;
    }
    if (s.step === 'age') {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 14 || n > 120) {
        await replyMessage(ev.replyToken, withQR('年齡需要是 14~120 的數字，請再輸入：', [qi('取消', '取消')]));
        continue;
      }
      s.data.age = n;
      s.step = 'maniaB';
      await replyMessage(ev.replyToken, askManiaB());
      continue;
    }
    if (s.step === 'maniaB') {
      const v = parseYesNo12(text);
      if (v === null) { await replyMessage(ev.replyToken, askManiaB()); continue; }
      s.data.maniaB = v;
      s.step = 'maniaE';
      await replyMessage(ev.replyToken, askManiaE());
      continue;
    }
    if (s.step === 'maniaE') {
      const v = parseYesNo12(text);
      if (v === null) { await replyMessage(ev.replyToken, askManiaE()); continue; }
      s.data.maniaE = v;
      s.step = 'score';
      s.idx = 0;
      await replyMessage(ev.replyToken, askLetter(LETTERS[s.idx]));
      continue;
    }
    if (s.step === 'score') {
      const n = Number(text);
      if (!Number.isFinite(n) || n < -100 || n > 100) {
        await replyMessage(ev.replyToken, withQR('請輸入 -100～100 的數字：', [qi('-50', '-50'), qi('0', '0'), qi('50', '50')]));
        continue;
      }
      const L = LETTERS[s.idx];
      s.data.scores[L] = n;
      s.idx += 1;
      if (s.idx < LETTERS.length) {
        await replyMessage(ev.replyToken, askLetter(LETTERS[s.idx]));
      } else {
        s.step = 'wants';
        await replyMessage(ev.replyToken, askResultChoice());
      }
      continue;
    }
    if (s.step === 'wants') {
      const wants = parseWants(text);
      s.data.wants = wants;

      await replyMessage(ev.replyToken, { type: 'text', text: '分析處理中，請稍候…' });

      // 讀取教材規則 → 產生 A~J 單點
      const { ok, rules } = await loadRulesSafe();
      const singleText = ok
        ? renderSingleByRules(s.data.scores, rules)
        : (() => {
            // 規則載入失敗，退回簡版
            const out = [];
            for (const L of LETTERS) {
              const val = Number(s.data.scores[L] ?? 0);
              const [lvl, hint] = bandDesc(val);
              out.push(`${NAMES[L]}：${val}｜${lvl}\n— ${hint}`);
            }
            return `【A~J 單點】\n${out.join('\n\n')}`;
          })();

      const { combo, persona } = renderSummaryAndPersona({
        name: s.data.name,
        gender: s.data.gender,
        age: s.data.age,
        maniaB: s.data.maniaB,
        maniaE: s.data.maniaE,
        scores: s.data.scores,
      });

      const outMsgs = [];
      if (!wants || wants.single) outMsgs.push({ type: 'text', text: singleText.slice(0, 5000) });
      if (!wants || wants.combo) outMsgs.push({ type: 'text', text: combo.slice(0, 5000) });
      if (!wants || wants.persona) outMsgs.push({ type: 'text', text: persona.slice(0, 5000) });

      const first = outMsgs.splice(0, 5);
      await pushMessage(userId, outMsgs);
      await replyMessage(ev.replyToken, first);

      resetSession(userId);
      continue;
    }

    await replyMessage(ev.replyToken, withQR('輸入「重新開始」可重來。', [qi('重新開始', '重新開始')]));
  }

  res.status(200).json({ ok: true });
}
