// api/_oca_rules.js
// OCA 規則引擎：先嘗試讀 data/oca_rules.json；讀不到就用內建 fallback。
// 也提供格式化輸出的工具（單點、綜合重點、人物側寫）。

const fs = require('fs');
const path = require('path');

const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES = {
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

// 內建「非常簡化」的 fallback（避免讀不到 JSON 時什麼都沒有）。
// 你要的教材用詞，請放在 data/oca_rules.json，這份只會在讀檔失敗時使用。
const FALLBACK = {
  _meta: {
    source: 'fallback',
    schema: 'v1',
    note: '未讀到 data/oca_rules.json，先用示意規則',
  },
  bands: {
    // 每個 band 給一個「方向、標籤、簡述」。教材請放到 JSON。
    // 這裡只有示意文字，實際請以教材填入 data 檔。
    A: [
      { code: 'A5', min: 41, label: '高(重)', desc: '偏高且影響重、驅動力大。' },
      { code: 'A4', min: 11, max: 40, label: '高(輕)', desc: '略偏高、傾向較明顯。' },
      { code: 'A3', min: -10, max: 10, label: '中性', desc: '較平衡、影響小。' },
      { code: 'A2', min: -40, max: -11, label: '低(輕)', desc: '略偏低、偶爾受影響。' },
      { code: 'A1', max: -41, label: '低(重)', desc: '不足感明顯、需特別留意。' },
    ],
    B: [
      { code: 'B5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'B4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'B3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'B2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'B1', max: -41, label: '低(重)', desc: '不足明顯。' },
    ],
    C: [
      { code: 'C5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'C4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'C3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'C2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'C1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    D: [
      { code: 'D5', min: 41, label: '高(重)', desc: '偏高且影響重、傾向明顯。' },
      { code: 'D4', min: 11, max: 40, label: '高(輕)', desc: '略偏高、傾向較明顯。' },
      { code: 'D3', min: -10, max: 10, label: '中性', desc: '較平衡、影響小。' },
      { code: 'D2', min: -40, max: -11, label: '低(輕)', desc: '略偏低、偶爾受影響。' },
      { code: 'D1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    E: [
      { code: 'E5', min: 41, label: '高(重)', desc: '偏高且影響重、驅動力大。' },
      { code: 'E4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'E3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'E2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'E1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    F: [
      { code: 'F5', min: 41, label: '高(重)', desc: '偏高且影響重、驅動力大。' },
      { code: 'F4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'F3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'F2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'F1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    G: [
      { code: 'G5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'G4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'G3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'G2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'G1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    H: [
      { code: 'H5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'H4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'H3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'H2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'H1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
    I: [
      { code: 'I5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'I4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'I3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'I2', min: -40, max: -11, label: '低(輕)', desc: '不足略明顯、需留意。' },
      { code: 'I1', max: -41, label: '低(重)', desc: '不足明顯、需特別留意。' },
    ],
    J: [
      { code: 'J5', min: 41, label: '高(重)', desc: '偏高且影響重。' },
      { code: 'J4', min: 11, max: 40, label: '高(輕)', desc: '略偏高。' },
      { code: 'J3', min: -10, max: 10, label: '中性', desc: '較平衡。' },
      { code: 'J2', min: -40, max: -11, label: '低(輕)', desc: '略偏低。' },
      { code: 'J1', max: -41, label: '低(重)', desc: '不足明顯、需留意。' },
    ],
  },
};

// 嘗試讀 data/oca_rules.json
function loadRules() {
  const tryPaths = [
    // Vercel lambda 內的打包路徑
    path.join('/var/task', 'data', 'oca_rules.json'),
    // 本機開發
    path.join(process.cwd(), 'data', 'oca_rules.json'),
  ];

  for (const p of tryPaths) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(txt);
      json._meta = json._meta || {};
      json._meta.source = `file:${p}`;
      return json;
    } catch (e) {
      // 讀不到就試下一個
    }
  }
  return FALLBACK;
}

// 依分數找 band（教材的 A1~A5 / B1~B5 …）
function pickBand(letter, score, rules) {
  const bands = rules.bands?.[letter];
  if (!bands || !bands.length) {
    return { code: `${letter}3`, label: '中性', desc: '' };
  }
  // 按照 min/max 比對
  for (const b of bands) {
    const hasMin = typeof b.min === 'number';
    const hasMax = typeof b.max === 'number';
    if (hasMin && hasMax) {
      if (score >= b.min && score <= b.max) return b;
    } else if (hasMin && !hasMax) {
      if (score >= b.min) return b;
    } else if (!hasMin && hasMax) {
      if (score <= b.max) return b;
    }
  }
  // 萬一都沒命中，回中性
  return bands.find(b => /中性/.test(b.label)) || { code: `${letter}3`, label: '中性', desc: '' };
}

// 產單點：每一點「一段文字」＋**中間空一行**
function formatSingles(scores, rules, options = {}) {
  const lines = [];
  LETTERS.forEach((L) => {
    const n = Number(scores[L] ?? 0);
    const band = pickBand(L, n, rules);
    // A 穩定：44｜高(重)｜（教材 A5） 說明……
    const one =
      `${L} ${NAMES[L]}：${n}｜${band.label}｜（教材 ${band.code}）\n` +
      `— ${band.desc}`;
    lines.push(one);
  });
  // 每點之間空一行
  return lines.join('\n\n');
}

// 取絕對值前 3 名，做綜合重點（簡版）
function formatCombined(scores, rules, extra = {}) {
  const arr = LETTERS.map(L => [L, Number(scores[L] ?? 0)]);
  arr.sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]) );
  const top3 = arr.slice(0,3).map(([L,v]) => `${L} ${NAMES[L]}：${v}（${pickBand(L, v, rules).label}）`);
  const maniaB = extra.maniaB ? '有' : '無';
  const maniaE = extra.maniaE ? '有' : '無';
  const date = extra.date || '';
  return (
    `【綜合重點】\n` +
    `最需要留意／最有影響的面向：${top3.join('、')}。\n` +
    `躁狂（B 情緒）：${maniaB}；躁狂（E 點）：${maniaE}；\n` +
    `日 期：${date || '未填'}。`
  );
}

// 人物側寫（簡版示例）
function formatPersona(scores, rules) {
  const arr = LETTERS.map(L => [L, Number(scores[L] ?? 0)]);
  arr.sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]) );
  if (arr.length < 2) return '【人物側寫】\n整體表現較均衡。';
  const [L1, v1] = arr[0];
  const [L2, v2] = arr[1];
  const dir1 = v1 >= 0 ? '偏高' : '偏低';
  const dir2 = v2 >= 0 ? '偏高' : '偏低';
  return (
    `【人物側寫】\n` +
    `${L1} ${NAMES[L1]}${dir1}、${L2} ${NAMES[L2]}${dir2}；整體呈現「${dir1 === '偏高' ? '主動' : '保守'}、${dir2 === '偏高' ? '外放' : '內斂'}」傾向（示意）。`
  );
}

module.exports = {
  LETTERS,
  NAMES,
  loadRules,
  pickBand,
  formatSingles,
  formatCombined,
  formatPersona,
};
