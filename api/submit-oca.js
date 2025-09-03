// api/submit-oca.js
// 產生 OCA 分析並推播給使用者（支援：/data/oca_rules.json 優先，否則退回 api/_oca_rules.js）
// 備註：本檔只負責「把前端/聊天上送的資料 -> 規則 -> 文字」與推播，其他 webhook/表單/聊天流程不用改。

const fs = require('fs/promises');
const path = require('path');

// ========= LINE push utility =========
async function pushMessage(to, messages) {
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('Push API error:', resp.status, t);
  }
}

// ========= rules loader =========
async function loadOcaRules() {
  // 1) 優先讀 /data/oca_rules.json
  try {
    const p = path.join(process.cwd(), 'data', 'oca_rules.json');
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt);
  } catch (_) {
    // 2) 讀不到就退回你現有的 api/_oca_rules.js
    try {
      return require('./_oca_rules.js');
    } catch (e2) {
      console.error('OCA rules not found in JSON nor JS:', e2);
      return null;
    }
  }
}

// ========= 分析核心 =========
const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES_FALLBACK = {
  A: '穩定',
  B: '價值',
  C: '變化',
  D: '果敢',
  E: '活躍',
  F: '樂觀',
  G: '責任',
  H: '評估力',
  I: '欣賞能力',
  J: '滿意能力',
};

function normalizeScores(raw) {
  const out = {};
  for (const L of LETTERS) {
    const v = Number(raw?.[L]);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function bandFromScore(bands, n) {
  // bands 需含 { id, min, label }，例如：
  // [{id:'high_heavy',min:41,label:'高(重)'}, {id:'high_light',min:11,label:'高(輕)'}, {id:'neutral',min:-10,label:'中性'}, {id:'low_light',min:-40,label:'低(輕)'}, {id:'low_heavy',min:-100,label:'低(重)'}]
  // 注意順序：由高到低，min 是該級距的下限（含）
  for (const b of bands) {
    if (n >= b.min) return b; // 第一個符合下限者
  }
  // 萬一寫反，最後回傳最後一個
  return bands[bands.length - 1];
}

function chunkByLimit(text, limit = 4800) {
  const parts = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > limit) {
      parts.push(buf);
      buf = line;
    } else {
      buf += (buf ? '\n' : '') + line;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/**
 * 依規則產出分析
 * @param {object} RULES 由 JSON 或 JS 載入的規則：
 * {
 *   bands:[{id,min,label},...],
 *   letters:{
 *     A:{ name:"穩定", text:{ high_heavy:"...", high_light:"...", neutral:"...", low_light:"...", low_heavy:"..." } },
 *     ...
 *   },
 *   persona:{ templates:["C{dir1}、E{dir2}..."] } // 可選
 * }
 * @param {object} payload 由前端/聊天送入：{ userId, name, gender, age, date, maniaB, maniaE, scores, wants }
 * @returns {Array<{type:"text",text:string}>}
 */
function analyzeOCA(RULES, payload) {
  const bands = RULES?.bands || [
    { id: 'high_heavy', min: 41, label: '高(重)' },
    { id: 'high_light', min: 11, label: '高(輕)' },
    { id: 'neutral', min: -10, label: '中性' },
    { id: 'low_light', min: -40, label: '低(輕)' },
    { id: 'low_heavy', min: -100, label: '低(重)' },
  ];

  const letters = RULES?.letters || {};
  const scores = normalizeScores(payload.scores);
  const wants = payload.wants || { single: true, combo: true, persona: true };

  const name = payload.name || '';
  const gender = payload.gender || '未填';
  const age = Number(payload.age) || 0;
  const date = payload.date || '';
  const maniaB = !!payload.maniaB; // 躁狂（B情緒）
  const maniaE = !!payload.maniaE; // 躁狂（E點）

  // === 單點 ===
  // 每點：A 穩定：44｜高(重) —— <教材 A5 的一句話>
  const singleLines = [];
  for (const L of LETTERS) {
    const conf = letters[L] || {};
    const displayName = conf.name || NAMES_FALLBACK[L] || L;
    const n = scores[L];
    const b = bandFromScore(bands, n);
    const sentence =
      (conf.text && conf.text[b.id]) ||
      // 落空時的保底句（你可保留或刪除）
      `（教材對應句待補）`;

    singleLines.push(`${L} ${displayName}：${n}｜${b.label} —— ${sentence}`);
  }

  const singleText =
    '【A～J 單點】\n\n' + singleLines.join('\n\n'); // 每點之間空一行較好讀

  // === 綜合＋痛點 ===
  // 抓絕對值最高的 3 個，讓使用者知道最需留意的面向
  const top3 = Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);

  const topText = top3
    .map(([L, v]) => {
      const conf = letters[L] || {};
      const displayName = conf.name || NAMES_FALLBACK[L] || L;
      const b = bandFromScore(bands, v);
      return `${L} ${displayName}：${v}（${b.label}）`;
    })
    .join('、');

  const comboText =
    '【綜合重點】\n' +
    `最需要留意／最有影響的面向：${topText || '整體較平均'}。\n` +
    `躁狂（B 情緒）：${maniaB ? '有' : '無'}；躁狂（E 點）：${maniaE ? '有' : '無'}。\n` +
    `年齡：${age || '未填'}；性別：${gender || '未填'}；日期：${date || '未填'}。`;

  // === 人物側寫（極簡範例，之後你可把 RULES.persona.templates 換成教材句庫） ===
  let personaText = '【人物側寫】\n';
  if (top3.length >= 2) {
    const [L1, v1] = top3[0];
    const [L2, v2] = top3[1];
    const name1 = (letters[L1]?.name || NAMES_FALLBACK[L1] || L1);
    const name2 = (letters[L2]?.name || NAMES_FALLBACK[L2] || L2);
    const dir1 = v1 >= 0 ? '偏高' : '偏低';
    const dir2 = v2 >= 0 ? '偏高' : '偏低';
    // 你可以把這句換成教材的人物側寫模板
    personaText += `${name1}${dir1}、${name2}${dir2}；整體呈現「${dir1 === '偏高' ? '主動' : '保守'}、${dir2 === '偏高' ? '外放' : '內斂'}」傾向（示意）。`;
  } else {
    personaText += '整體表現較均衡。';
  }

  // === 首段招呼 ===
  const hello = `Hi ${name || ''}！已收到你的 OCA 分數。\n（年齡：${age || '未填'}，性別：${gender || '未填'}）`;

  // === 組裝訊息 ===
  let fullTexts = [];
  fullTexts.push(hello);
  if (wants.single !== false) fullTexts.push(singleText);
  if (wants.combo !== false) fullTexts.push(comboText);
  if (wants.persona !== false) fullTexts.push(personaText);

  // 分塊避免 5000 字上限
  const chunks = [];
  for (const t of fullTexts) {
    for (const part of chunkByLimit(t, 4800)) {
      chunks.push({ type: 'text', text: part });
    }
  }
  return chunks;
}

// ========= HTTP handler =========
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const RULES = await loadOcaRules();
    if (!RULES) {
      return res.status(500).json({ ok: false, msg: 'OCA 規則檔缺失' });
    }

    // body 例：
    // {
    //   "userId": "...", "name": "...", "gender":"男/女/其他",
    //   "age": 22, "date": "2025/09/02",
    //   "maniaB": true, "maniaE": false,
    //   "scores": {"A":10,"B":-20,...},
    //   "wants": {"single":true,"combo":true,"persona":true}
    // }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { userId, age, scores } = body;

    if (!userId) return res.status(400).json({ ok: false, msg: '缺少 userId' });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: '年齡需 ≥ 14' });
    if (!scores) return res.status(400).json({ ok: false, msg: '缺少分數' });

    const messages = analyzeOCA(RULES, body);

    await pushMessage(userId, messages);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
