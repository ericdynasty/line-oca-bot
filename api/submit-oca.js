// api/submit-oca.js
// 你的送出 + 推播（ESM 版），已加上安全載入教材規則
import { loadRules } from './_oca_rules.js';

const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES = {
  A: 'A 自我', B: 'B 情緒', C: 'C 任務', D: 'D 關係', E: 'E 支援',
  F: 'F 壓力', G: 'G 目標', H: 'H 執行', I: 'I 自律', J: 'J 活力',
};

// 分數→等級文字（維持你原本邏輯）
function bandDesc(n) {
  if (n >= 41) return ['高(重)', '偏強勢、驅動力大'];
  if (n >= 11) return ['高(輕)', '略偏高、傾向較明顯'];
  if (n <= -41) return ['低(重)', '不足感明顯、需特別留意'];
  if (n <= -11) return ['低(輕)', '略偏低、偶爾受影響'];
  return ['中性', '較平衡、影響小'];
}

function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    const v = Number(input?.[L]);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

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
    const text = await resp.text().catch(() => '');
    console.error('Push API error:', resp.status, text);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // 先把規則載起來（讀不到也不會壞，只記錄）
    const rulesLoad = await loadRules(req);
    const rulesOk   = !!rulesLoad.ok && !!rulesLoad.rules;
    const rules     = rulesOk ? rulesLoad.rules : null;

    const { userId, name, gender, age, date, mania, scores: raw, wants } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: '缺少 userId' });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: '年齡需 ≥ 14' });

    // 分數容錯
    const scores = normalizeScores(raw);

    // 單點（維持你既有格式）
    const singleLines = [];
    for (const L of LETTERS) {
      const n = scores[L];
      const [lvl, hint] = bandDesc(n);

      // 若教材規則有對應欄位，你可以在這裡補充（不保證一定存在，故要防呆）
      // 以下只示意：嘗試抓 rules?.A?.A3 這類文字，如果沒有就忽略。
      let ruleNote = '';
      try {
        const r = rules && (rules[L] || rules[L.toLowerCase()]);
        // 你可以依照自己的 JSON 結構挑一段代表字串
        // 例如 r?.A3?.text 或 r?.desc 等（請依你的 oca_rules.json 調整）
        const pick = r?.A3?.text || r?.desc || '';
        if (pick) ruleNote = `（教材）${String(pick).slice(0, 24)}…`;
      } catch (_) {}

      singleLines.push(`${NAMES[L]}：${n}（${lvl}）— ${hint}${ruleNote ? `\n${ruleNote}` : ''}`);
    }

    // 前三個絕對值
    const tops = topLetters(scores, 3);
    const topText = tops
      .map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`)
      .join('、');

    const combined =
      `【綜合重點】\n最需要留意／最有影響的面向：${topText || '無特別突出'}。\n` +
      `躁狂傾向：${mania ? '有' : '無'}；日期：${date || '未填'}。`;

    // 人物側寫（維持你原本示意寫法）
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

    // 組裝訊息
    const replyChunks = [];
    replyChunks.push({
      type: 'text',
      text: `Hi ${name || ''}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || '未填'}）${rulesOk ? '\n[教材規則：載入成功]' : ''}`,
    });

    if (!wants || wants.single) {
      replyChunks.push({ type: 'text', text: '【A~J 單點】\n' + singleLines.join('\n') });
    }
    if (!wants || wants.combo) {
      replyChunks.push({ type: 'text', text: combined });
    }
    if (!wants || wants.persona) {
      replyChunks.push({ type: 'text', text: persona });
    }

    // 推播
    await pushMessage(userId, replyChunks);
    return res.status(200).json({ ok: true, rulesLoaded: !!rulesOk, meta: rulesLoad.meta || null });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
}
