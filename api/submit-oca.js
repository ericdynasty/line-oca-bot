// /api/submit-oca.js
// 產生 OCA 結果（文字版） +（可選）推播到 LINE
const fs = require('fs');
const path = require('path');

const LETTERS = ['A','B','C','D','E','F','G','H','I','J'];
let RULES_CACHE = null;

function loadRules() {
  if (RULES_CACHE) return RULES_CACHE;
  const p = path.join(process.cwd(), 'data', 'oca_rules.json');
  const raw = fs.readFileSync(p, 'utf8');
  RULES_CACHE = JSON.parse(raw);
  return RULES_CACHE;
}

function inRange(x, [lo, hi]) { return x >= lo && x <= hi; }

function scoreToBlock(score, rules) {
  const b = rules.blocks;
  if (inRange(score, b['1'])) return 1;
  if (inRange(score, b['2'])) return 2;
  if (inRange(score, b['3'])) return 3;
  if (inRange(score, b['4'])) return 4;
  // fallback：容錯
  if (score >= 70) return 1;
  if (score >= 20) return 2;
  if (score >= -39) return 3;
  return 4;
}

function getBlocks(scores, rules) {
  const blocks = {};
  for (const k of LETTERS) blocks[k] = scoreToBlock(scores[k], rules);
  return blocks;
}

function getRelative(scores, rules) {
  const vals = LETTERS.map(k => scores[k]);
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
  const rel = {};
  const { highDelta=20, lowDelta=-20 } = rules.relativeThresholds || {};
  for (const k of LETTERS) {
    const d = scores[k] - avg;
    rel[k] = { delta: d, rel_high: d >= highDelta, rel_low: d <= lowDelta };
  }
  const highest = LETTERS.reduce((best, k) =>
    scores[k] > scores[best] ? k : best, LETTERS[0]);
  return { avg, rel, highest };
}

function matchCond(token, ctx) {
  // 支援： "A:1" / "B:3-4" / "A:rel_low" / "H:rel_high" / "C:highest" / "E>F"
  const { scores, blocks, rel, highest } = ctx;
  if (token.includes('>')) {
    const [L, R] = token.split('>');
    return scores[L] > scores[R];
  }
  if (token.includes(':')) {
    const [k, right] = token.split(':');
    if (right === 'highest') return highest === k;
    if (right === 'rel_high') return rel[k].rel_high;
    if (right === 'rel_low')  return rel[k].rel_low;
    // 3-4 or 1
    if (right.includes('-')) {
      const [a,b] = right.split('-').map(n => parseInt(n,10));
      return blocks[k] >= a && blocks[k] <= b;
    }
    return blocks[k] === parseInt(right,10);
  }
  return false;
}

function collectByRules(ruleList, ctx) {
  const out = [];
  for (const r of ruleList || []) {
    const ok = (r.when || []).every(t => matchCond(t, ctx));
    if (ok) out.push(r.text);
  }
  return out;
}

function singleTexts(blocks, rules) {
  const out = [];
  for (const k of LETTERS) {
    const b = String(blocks[k]);
    const t = rules.single[k][b];
    out.push(`${k}${b}：${t}`);
  }
  return out;
}

function maniaTexts(blocks, rules, maniaFlags) {
  const lines = [];
  if (maniaFlags?.B) {
    const note = rules.mania?.B?.note || '情緒起伏異常';
    const seg = rules.mania?.B?.blocks?.[String(blocks.B)] || '';
    lines.push(`【躁狂（B）】${note}${seg ? '｜' + seg : ''}`);
  }
  if (maniaFlags?.E) {
    const note = rules.mania?.E?.note || '活躍能量起伏異常';
    lines.push(`【躁狂（E）】${note}`);
  }
  return lines;
}

function profileFrom(scores, rel, blocks) {
  // 口語化人物側寫：抓 2 高 2 低 + 氣質
  const arr = LETTERS.map(k => ({ k, v: scores[k] }))
                     .sort((a,b)=>b.v-a.v);
  const highs = arr.slice(0,2).map(x=>x.k).join('、');
  const lows  = arr.slice(-2).map(x=>x.k).reverse().join('、');

  const traits = [];
  if (blocks.B === 1) traits.push('樂觀');
  if (blocks.C >= 3) traits.push('緊張');
  if (blocks.A <= 2) traits.push('較穩');
  if (blocks.J >= 3) traits.push('社交保留');
  if (blocks.H >= 3) traits.push('挑剔');
  if (blocks.I <= 2) traits.push('能體諒人');
  const tag = traits.length ? `（氣質：${traits.join('、')}）` : '';

  return [
    `整體傾向：高分在【${highs}】，低分在【${lows}】${tag}`.trim()
  ];
}

function validate(body) {
  const errs = [];
  const required = ['name','age','A','B','C','D','E','F','G','H','I','J'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      errs.push(`${k} 必填`);
    }
  }
  if (!(Number(body.age) >= 14)) errs.push('年齡需 ≥ 14');
  for (const k of LETTERS) {
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < -100 || v > 100) {
      errs.push(`${k} 分數需介於 -100 ~ 100`);
    }
  }
  return errs;
}

async function pushToLine(userId, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !userId) return false;
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type:'text', text }]
      })
    });
    return r.ok;
  } catch (e) {
    console.error('LINE push error', e);
    return false;
  }
}

function buildReport(payload, rules) {
  const meta = [];
  meta.push(`姓名：${payload.name}`);
  if (payload.gender) meta.push(`性別：${payload.gender}`);
  meta.push(`年齡：${payload.age}`);
  if (payload.date) meta.push(`日期：${payload.date}`);

  const scores = {};
  for (const k of LETTERS) scores[k] = Number(payload[k]);
  const blocks = getBlocks(scores, rules);
  const relCtx  = getRelative(scores, rules);
  const ctx = { scores, blocks, rel: relCtx.rel, highest: relCtx.highest };

  const parts = [];

  // 躁狂（如有勾）
  const mania = maniaTexts(blocks, rules, payload.mania || {});
  if (mania.length) parts.push('— 躁狂觀察 —\n' + mania.join('\n'));

  // A~J 單點
  if (payload.want?.single) {
    const ss = singleTexts(blocks, rules);
    parts.push('— 單點解析 —\n' + ss.join('\n'));
  }

  // 綜合＋痛點
  if (payload.want?.combine) {
    const b = collectByRules(rules.syndromeB || [], ctx);
    const c = collectByRules(rules.syndromeC || [], ctx);
    const d = collectByRules(rules.syndromeD || [], ctx);

    const lines = [...b, ...c, ...d];
    if (lines.length) {
      parts.push('— 綜合分析／痛點 —\n' + lines.map(s => '• ' + s).join('\n'));
    } else {
      parts.push('— 綜合分析／痛點 —\n（本次未觸發規則）');
    }
  }

  // 人物側寫
  if (payload.want?.profile) {
    const prof = profileFrom(scores, relCtx.rel, blocks);
    parts.push('— 人物側寫 —\n' + prof.join('\n'));
  }

  // 測謊小提醒（若教材有設）
  if (rules.syndromeA?.liarCheck) {
    const warns = [];
    const lc = rules.syndromeA.liarCheck;
    if (scores.G >= (lc.G||999)) warns.push('G 分數異常偏高');
    if (scores.I >= (lc.I||999)) warns.push('I 分數異常偏高');
    if (warns.length) parts.push('— 測謊提示 —\n' + warns.join('、'));
  }

  const head = '【OCA 分析結果】\n' + meta.join('｜');
  return [head, ...parts].join('\n\n');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Content-Type','application/json');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }

    const body = req.body || {};
    // 後端再做一遍驗證
    const errors = validate(body);
    if (errors.length) return res.status(400).json({ ok:false, errors });

    const rules = loadRules();

    // 預設想看的區段（若前端沒傳）
    body.want = Object.assign({ single:true, combine:true, profile:true }, body.want || {});
    body.mania = Object.assign({ B:false, E:false }, body.mania || {});

    const text = buildReport(body, rules);

    // 有 userId + Token 就推播；否則只回傳 JSON
    let pushed = false;
    if (body.userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      pushed = await pushToLine(body.userId, text);
    }

    return res.status(200).json({ ok:true, pushed, textPreview: pushed ? undefined : text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:'Server Error' });
  }
};
