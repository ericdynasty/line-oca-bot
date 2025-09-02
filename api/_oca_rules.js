// api/_oca_rules.js
// 規則資料 + 套用引擎（教材《症狀群 A～D》）
// 區塊定義：1=+70~+100, 2=+20~+69, 3=-39~+19, 4=-100~-40 （教材四區切點）
const BLOCKS = { HI_HEAVY: 1, HI_LIGHT: 2, MID: 3, LOW: 4 };

// 將分數換成四區
function toBlock(n) {
  if (n >= 70) return 1;
  if (n >= 20) return 2;
  if (n >= -39) return 3;
  return 4;
}

// ====== 症狀群規則表 ======
// 下面幾條為「教材示例＋常見組合」的起手式。
// 👉 請你依教材逐條補完（把 text 換成教材正文，必要時增修 when 條件）。
const OCA_RULES = [
  // 症狀群 C：ABC 低 → 神經緊繃／陷在過往失落（教材示例）
  {
    id: "C-ABC-low",
    group: "C",
    title: "神經緊繃／陷在過往失落",
    severity: 90,
    when: {
      all: [
        { L: "A", inBlocks: [LOW] },
        { L: "B", inBlocks: [LOW] },
        { L: "C", inBlocks: [LOW] },
      ],
    },
    text:
      "A、B、C 同時偏低：容易神經緊繃、情緒內縮，容易卡在過往失落（教材：症狀群C，示意）。",
  },

  // 症狀群 C：A 高 + H 低 → 完美主義傾向（教材示例）
  {
    id: "C-AH",
    group: "C",
    title: "完美主義傾向",
    severity: 80,
    when: {
      all: [
        { L: "A", inBlocks: [HI_HEAVY, HI_LIGHT] },
        { L: "H", inBlocks: [LOW] },
      ],
    },
    text:
      "A 高 + H 低：完美主義傾向，標準高且挑剔，對人事要求嚴，易影響人際（教材：症狀群C，示意）。",
  },

  // 症狀群 C：B 高 + D 低 → 有躁狂困擾（教材示例）
  {
    id: "C-BD",
    group: "C",
    title: "躁狂困擾（傻笑）",
    severity: 80,
    when: {
      all: [
        { L: "B", inBlocks: [HI_HEAVY, HI_LIGHT] },
        { L: "D", inBlocks: [LOW] },
      ],
    },
    text:
      "B 高 + D 低：可能出現躁狂困擾（會傻笑），情緒高亢但實際表現與能力不相稱（教材：症狀群C，示意）。",
  },

  // 其他常見（示意）：E 高 + G 低 → 衝動行事、紀律不足
  {
    id: "X-EG",
    group: "C",
    title: "衝動＋紀律不足",
    severity: 60,
    when: {
      all: [
        { L: "E", inBlocks: [HI_HEAVY, HI_LIGHT] },
        { L: "G", inBlocks: [LOW] },
      ],
    },
    text:
      "E 偏高 + G 偏低：行動衝動、紀律與承擔不足，容易『先做再想』，後續收拾負擔大（示意，請對照教材條目調整）。",
  },

  // 其他常見（示意）：C 低 + D 低 → 僵滯迴避
  {
    id: "X-CD",
    group: "C",
    title: "僵滯迴避",
    severity: 55,
    when: {
      all: [
        { L: "C", inBlocks: [LOW] },
        { L: "D", inBlocks: [LOW] },
      ],
    },
    text:
      "C、D 同時偏低：面對變動與問題容易僵住或迴避，延宕決定與行動（示意，請對照教材條目調整）。",
  },

  // 其他常見（示意）：F 低 + J 低 → 悲觀撤退、關係退縮
  {
    id: "X-FJ",
    group: "C",
    title: "悲觀撤退",
    severity: 50,
    when: {
      all: [
        { L: "F", inBlocks: [LOW] },
        { L: "J", inBlocks: [LOW] },
      ],
    },
    text:
      "F、J 偏低：情緒悲觀且社交退縮，互動容易躲開或無力（示意，請對照教材條目調整）。",
  },

  // 你可以在這裡繼續把症狀群 A、B、C、D 的所有條目補齊……
];

// ====== 引擎：計算命中的規則 ======
// opts.max 返回的最大條數（避免爆訊息）
function applyOcaRules(scores, opts = {}) {
  const max = opts.max ?? 6;

  const B = {};
  for (const [k, v] of Object.entries(scores)) B[k] = toBlock(v);

  const hits = [];
  for (const rule of OCA_RULES) {
    const ok = isMatch(rule.when, scores, B);
    if (ok) hits.push(rule);
  }

  // 依 severity（重要性）排序，取前 max
  hits.sort((a, b) => (b.severity || 0) - (a.severity || 0));
  return hits.slice(0, max).map(r => `（症狀群 ${r.group}）${r.title}：${r.text}`);
}

function isMatch(when, raw, blocks) {
  if (!when) return false;
  if (when.all) {
    return when.all.every(cond => check(cond, raw, blocks));
  }
  if (when.any) {
    return when.any.some(cond => check(cond, raw, blocks));
  }
  return false;
}

function check(cond, raw, blocks) {
  const v = raw[cond.L];
  const b = blocks[cond.L];

  if (cond.inBlocks) {
    return cond.inBlocks.includes(b);
  }
  if (typeof cond.gte === "number" && !(v >= cond.gte)) return false;
  if (typeof cond.lte === "number" && !(v <= cond.lte)) return false;
  return true;
}

// 輸出給 submit-oca.js 使用
module.exports = {
  BLOCKS,
  toBlock,
  OCA_RULES,
  applyOcaRules,
};
