// /api/analyze.js
import rules from '../data/oca_rules.json' assert { type: 'json' };

// 把數值分進 1~4 區塊（教材門檻）
function toBlock(n) {
  if (n >= rules.blocks.b1[0]) return 1;
  if (n >= rules.blocks.b2[0]) return 2;
  if (n >= rules.blocks.b3[0] && n <= rules.blocks.b3[1]) return 3;
  return 4;
}

function pickSingle(scores) {
  const out = [];
  for (const letter of 'ABCDEFGHIJ') {
    const n = Number(scores[letter] ?? 0);
    const b = toBlock(n);
    const s = rules.single[letter];
    out.push({ letter, score: n, block: b, text: s[String(b)] });
  }
  return out;
}

function detectHints(scores) {
  const s = scores;
  const hints = [];
  if (Number(s.G) === 90 && Number(s.I) === 90) hints.push(rules.hints.G90_I90);
  if (s.A <= -40 && s.J <= -40) hints.push(rules.hints.AJ_low);
  if (s.E <= -40 && s.F <= -40) hints.push(rules.hints.EF_low);
  if (s.A <= -40 && s.B <= -40 && s.C <= -40 && s.E >= 70) hints.push(rules.hints.ABC_low_E_high);
  if (s.E >= 70 && s.G <= -40) hints.push(rules.hints.E_high_G_low);
  if (s.D <= -40 && s.J >= 70) hints.push(rules.hints.D_low_J_high);
  if (s.I >= 70) hints.push(rules.hints.I_high);
  if (s.F > s.E) hints.push(rules.hints.F_over_E);
  return hints;
}

// 症狀群B 的幾個典型組合（可再擴充）
function detectGroupB(blocks) {
  const b = blocks;
  const ret = [];
  if (b.A === 1 && (b.B === 3 || b.B === 4)) ret.push(rules.groupsB.A1_B34);
  if (b.A === 1 && (b.C === 3 || b.C === 4)) ret.push(rules.groupsB.A1_C34);
  if (b.B === 1 && (b.A === 3 || b.A === 4)) ret.push(rules.groupsB.B1_A34);
  if (b.B === 1 && (b.C === 3 || b.C === 4)) ret.push(rules.groupsB.B1_C34);
  if (b.C === 1 && (b.A === 3 || b.A === 4)) ret.push(rules.groupsB.C1_A34);
  return ret;
}

// 主函式
export function analyzeOCA({ name, gender, age, date, maniaB, maniaE, scores, wants }) {
  // 單點
  const singles = pickSingle(scores);

  // 躁狂（教材：僅 B/E）→ 替換 B/E 說明為躁狂語句
  const b = singles.find(x => x.letter === 'B');
  const e = singles.find(x => x.letter === 'E');
  if (maniaB) b.text = rules.mania.B;
  if (maniaE) e.text = rules.mania.E;

  // 整理區塊 map 給群組偵測
  const blocks = Object.fromEntries(singles.map(x => [x.letter, x.block]));

  // 症狀群與提示
  const groupB = detectGroupB(blocks);
  const hints = detectHints(scores);

  // 組裝輸出（逐段分開，利於 LINE 顯示）
  const header = `Hi ${name || ''}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || '未填'}）`;

  const singleText =
    '【A~J 單點】\n' +
    singles.map(x => `${x.letter} ${rules.single[x.letter].name}：${x.score} ｜ ${x.text}`).join('\n\n');

  const topAbs = [...singles].sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)).slice(0,3);
  const combo =
    '【綜合重點】\n' +
    `最需要留意／最有影響的面向：` +
    topAbs.map(t => `${t.letter}${rules.single[t.letter].name}：${t.score}（${['','高','中','低'][t.block] || '中'}）`).join('、') +
    `。\n躁狂：${maniaB?'B有':'B無'}；${maniaE?'E有':'E無'}；日期：${date || '未填'}。\n` +
    (groupB.length ? ('\n【症狀群B】\n' + groupB.join('\n')) : '') +
    (hints.length ? ('\n【判讀提示】\n' + hints.join('\n')) : '');

  const persona = (() => {
    const [p1, p2] = topAbs;
    if (!p1 || !p2) return '【人物側寫】\n整體較均衡。';
    const dir = v => v >= 0 ? '偏高' : '偏低';
    return `【人物側寫】\n${p1.letter}${rules.single[p1.letter].name}${dir(p1.score)}、` +
           `${p2.letter}${rules.single[p2.letter].name}${dir(p2.score)}；整體呈現「` +
           `${p1.score>=0?'主動':'保守'}、${p2.score>=0?'外放':'內敛'}」傾向（示意）。`;
  })();

  // wants: { single, combo, persona } 可選；若未指定則三段都回
  const out = [{ type:'text', text: header }];
  if (!wants || wants.single)  out.push({ type:'text', text: singleText.slice(0,5000) });
  if (!wants || wants.combo)   out.push({ type:'text', text: combo.slice(0,5000) });
  if (!wants || wants.persona) out.push({ type:'text', text: persona.slice(0,5000) });

  return out;
}
