// api/_oca_rules.js
// 將 A~J 分數套用教材規則，回傳「症狀群 A～D」的條列敘述。
// 用法：const { applyOcaRules } = require("./_oca_rules"); ruleHits = applyOcaRules(scores, {max: 6});

const LETTERS = "ABCDEFGHIJ".split("");

// 統一取得分數
function v(scores, L) {
  const n = Number(scores?.[L]);
  return Number.isFinite(n) ? n : 0;
}

// 分段（供顯示與條件判斷參考）
function band(n) {
  if (n >= 41) return "高(重)";
  if (n >= 11) return "高(輕)";
  if (n <= -41) return "低(重)";
  if (n <= -11) return "低(輕)";
  return "中性";
}

// 閾值判斷小工具
const hiHeavy = (n) => n >= 41;
const hiLight = (n) => n >= 11 && n <= 40;
const loHeavy = (n) => n <= -41;
const loLight = (n) => n <= -11 && n >= -40;

// 工具：把一個可讀的「點位+分段」字串做出來（用在說明文字內）
function show(L, n, hintCode) {
  return `${L}：${n}（${band(n)}｜教材 ${hintCode}）`;
}

// === 規則本體 ===
// 說明：
// - text 盡量教材式、可讀性高
// - code 保留教材代碼，方便之後你對照教材調整
// - when(scores) 回傳 true 代表命中
const RULES = [
  // ===== 症狀群 A（以 A、C、D 等穩定/變動/果敢相關組合為主）=====
  {
    code: "A5+C3",
    text: (s) => {
      const A = v(s, "A"), C = v(s, "C");
      return `【症狀群A】內在僵固、抗拒變動：${show("A", A, "A5")}，${show("C", C, "C3")}。`;
    },
    when: (s) => hiHeavy(v(s,"A")) && loHeavy(v(s,"C")),
  },
  {
    code: "A4+D4",
    text: (s) => {
      const A = v(s,"A"), D = v(s,"D");
      return `【症狀群A】穩定度偏高、行動偏保守：${show("A", A, "A4")}，${show("D", D, "D4")}。`;
    },
    when: (s) => hiLight(v(s,"A")) && loLight(v(s,"D")),
  },

  // ===== 症狀群 B（以 B 情緒、F 樂觀、J 滿意等情緒/感受面）=====
  {
    code: "B4+J3",
    text: (s) => {
      const B = v(s,"B"), J = v(s,"J");
      return `【症狀群B】情緒波動略高、滿意度偏低：${show("B", B, "B4")}，${show("J", J, "J3")}。`;
    },
    when: (s) => hiLight(v(s,"B")) && loLight(v(s,"J")),
  },
  {
    code: "B5+F3",
    text: (s) => {
      const B = v(s,"B"), F = v(s,"F");
      return `【症狀群B】情緒高張、正向期待不足：${show("B", B, "B5")}，${show("F", F, "F3")}。`;
    },
    when: (s) => hiHeavy(v(s,"B")) && loLight(v(s,"F")),
  },

  // ===== 症狀群 C（以 C 變化、E 活躍、G 責任、H 評估力之間的關係）=====
  {
    code: "C4+E4",
    text: (s) => {
      const C = v(s,"C"), E = v(s,"E");
      return `【症狀群C】適應力略低、外顯活躍較高：${show("C", C, "C4")}，${show("E", E, "E4")}。`;
    },
    when: (s) => loLight(v(s,"C")) && hiLight(v(s,"E")),
  },
  {
    code: "G3+H3",
    text: (s) => {
      const G = v(s,"G"), H = v(s,"H");
      return `【症狀群C】責任承擔偏低、評估/判斷偏低：${show("G", G, "G3")}，${show("H", H, "H3")}。`;
    },
    when: (s) => loLight(v(s,"G")) && loLight(v(s,"H")),
  },

  // ===== 症狀群 D（以 I 欣賞、J 滿意、E 活躍等成就/滿足面）=====
  {
    code: "I3+J3",
    text: (s) => {
      const I = v(s,"I"), J = v(s,"J");
      return `【症狀群D】內在成就感不足、外在滿意偏低：${show("I", I, "I3")}，${show("J", J, "J3")}。`;
    },
    when: (s) => loLight(v(s,"I")) && loLight(v(s,"J")),
  },
  {
    code: "E5+I3",
    text: (s) => {
      const E = v(s,"E"), I = v(s,"I");
      return `【症狀群D】活躍驅動強、內在欣賞不足：${show("E", E, "E5")}，${show("I", I, "I3")}。`;
    },
    when: (s) => hiHeavy(v(s,"E")) && loLight(v(s,"I")),
  },

  // ===== 幾個容易讀的綜合「兩高/兩低」 =====
  {
    code: "A4+E4",
    text: (s) => {
      const A = v(s,"A"), E = v(s,"E");
      return `【關聯】穩定與活躍並高：${show("A", A, "A4")}，${show("E", E, "E4")}；多半表現主動但偏保守。`;
    },
    when: (s) => hiLight(v(s,"A")) && hiLight(v(s,"E")),
  },
  {
    code: "C3+G3",
    text: (s) => {
      const C = v(s,"C"), G = v(s,"G");
      return `【關聯】面對改變與責任皆偏低：${show("C", C, "C3")}，${show("G", G, "G3")}；較需要外部支持與明確結構。`;
    },
    when: (s) => loLight(v(s,"C")) && loLight(v(s,"G")),
  },
];

// 主函式：回傳文字陣列
function applyOcaRules(scores, opts = {}) {
  const max = Number(opts.max) > 0 ? Number(opts.max) : 6;
  const out = [];
  for (const r of RULES) {
    try {
      if (r.when(scores)) {
        out.push(r.text(scores));
        if (out.length >= max) break;
      }
    } catch (e) {
      // 單條規則錯誤不影響整體
      console.error("[_oca_rules] rule error:", r.code, e);
    }
  }
  return out;
}

module.exports = { applyOcaRules };
