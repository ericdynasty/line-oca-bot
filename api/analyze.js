// api/analyze.js
// 讀取 data/oca_rules.json（若失敗則使用後備規則）
// 輸入：{ name, gender, age, scores:{A..J}, maniaB, maniaE, want(1~4) }
// 輸出：{ messages: [ {type:"text", text:"..."} , ... ] }

import fs from "node:fs/promises";
import path from "node:path";

// ---- A~J 對應名稱（依教材）----
const TRAIT_NAMES = {
  A: "穩定性",
  B: "愉快",
  C: "鎮定",
  D: "確定力",
  E: "活躍",
  F: "積極",
  G: "負責",
  H: "評估能力",
  I: "欣賞能力",
  J: "溝通能力",
};
const ORDER = ["A","B","C","D","E","F","G","H","I","J"];

// ---- 後備規則（當 oca_rules.json 缺失或讀不到時使用）----
// 結構與預期 JSON 相容：每個 trait 有一組 ranges，用 min/max/label/desc 表達
function buildFallbackRules() {
  const ranges = [
    { min: -100, max: -61, label: "低(重)", desc: "顯著偏低，建議多觀察與調整。" },
    { min: -60,  max: -21, label: "低(輕)", desc: "略偏低，偶有影響，需留意。" },
    { min: -20,  max:  20, label: "中性",   desc: "較平衡，影響小。" },
    { min:  21,  max:  60, label: "高(輕)", desc: "略偏高，傾向較明顯。" },
    { min:  61,  max: 100, label: "高(重)", desc: "顯著偏高，驅動力大。" },
  ];
  const traits = {};
  for (const k of ORDER) {
    traits[k] = { name: TRAIT_NAMES[k], ranges };
  }
  return { ok: true, traits };
}

// ---- 安全載入 JSON 規則 ----
async function loadRules() {
  const file = path.join(process.cwd(), "data", "oca_rules.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    // 期待結構：{ traits:{ A:{ name, ranges:[{min,max,label,desc,ref?}] }, ... } }
    if (!json?.traits) throw new Error("traits missing");
    return { ok: true, ...json };
  } catch (e) {
    return buildFallbackRules();
  }
}

// ---- 找對應區間 ----
function pickRange(ranges, score) {
  if (!Array.isArray(ranges)) return null;
  return ranges.find(r => score >= r.min && score <= r.max) || null;
}

// ---- 單點區塊 ----
function buildSinglePointBlocks(traitsRules, scores) {
  const blocks = [];
  for (const k of ORDER) {
    const s = Number(scores?.[k] ?? 0);
    const t = traitsRules[k];
    const r = pickRange(t?.ranges, s);
    const level = r?.label ?? "中性";
    const desc = r?.desc ? `（教材 ${r?.ref || ""}） ${r.desc}`.trim() : "";
    const lineTitle = `${k} ${t?.name || ""}：${s} ｜ ${level}`;
    const details = desc ? `—— ${desc}` : "";
    // 加入一行空白，利讀性
    blocks.push(`${lineTitle}\n${details}`.trim());
  }
  return blocks.join("\n\n");
}

// ---- 綜合重點 ----
function buildSummaryBlock(traitsRules, scores, maniaB, maniaE) {
  // 取絕對值最高的 3 個
  const list = ORDER.map(k => ({ k, name: traitsRules[k]?.name || k, score: Number(scores[k] ?? 0) }));
  list.sort((a,b)=>Math.abs(b.score)-Math.abs(a.score));
  const top = list.slice(0,3);

  const mania = [];
  if (maniaB === 1) mania.push("躁狂（B 情緒）");
  if (maniaE === 1) mania.push("躁狂（E 點）");

  const lines = [];
  lines.push("【綜合重點】");
  lines.push(`最需要留意／最有影響的面向：${top.map(x=>`${x.k} ${x.name}：${x.score}`).join("、")}。`);
  if (mania.length) {
    lines.push(`躁狂：${mania.join("、")}；`);
  } else {
    lines.push("躁狂：無；");
  }
  const d = new Date();
  const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}.`;
  lines.push(`案：日期：${dateStr}`);
  return lines.join("\n");
}

// ---- 人物側寫（簡潔的 heuristics，若 JSON 無特別文案時）----
function buildPersonaBlock(traitsRules, scores) {
  const s = k => Number(scores?.[k] ?? 0);
  const parts = [];

  // 活躍 / 愉快 / 穩定性
  if (s("E") >= 30 && s("B") >= 20) {
    parts.push("偏外向熱絡、樂於互動，願意主動發起。");
  } else if (s("E") <= -30 || s("B") <= -20) {
    parts.push("偏保守安靜，互動動機較低，先觀察再行動。");
  } else {
    parts.push("社交動力適中，能依情境調整互動強度。");
  }

  if (s("A") >= 30 && s("C") >= 20) {
    parts.push("情緒較穩且冷靜，遇壓力能維持運作。");
  } else if (s("A") <= -20 || s("C") <= -20) {
    parts.push("情緒穩定度需留意，面對壓力建議安排緩衝。");
  }

  if (s("G") >= 20) {
    parts.push("責任感較強，任務可依約完成。");
  } else if (s("G") <= -20) {
    parts.push("對規範依從性較低，需強化期望與邊界。");
  }

  if (s("H") >= 20) {
    parts.push("評估偏理性，能就事論事。");
  }
  if (s("J") >= 20) {
    parts.push("溝通表達較直接，適合明確對焦。");
  } else if (s("J") <= -20) {
    parts.push("溝通較含蓄，建議提供具體選項輔助。");
  }

  return `【人物側寫】\n${parts.join(" ")}`
}

// ---- 將長文分段，避免超過 LINE 單則限制 ----
function splitToMessages(text, max = 4000) {
  const out = [];
  let buf = "";
  const lines = text.split(/\n/);
  for (const ln of lines) {
    if ((buf + ln + "\n").length > max) {
      out.push({ type: "text", text: buf.trimEnd() });
      buf = "";
    }
    buf += ln + "\n";
  }
  if (buf.trim()) out.push({ type: "text", text: buf.trimEnd() });
  return out.length ? out : [{ type: "text", text }];
}

// ---- 主處理 ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const body = req.body || {};
    const { name, gender, age, scores = {}, maniaB, maniaE, want = 4 } = body;

    // 讀規則
    const rules = await loadRules();
    const traitsRules = rules.traits || buildFallbackRules().traits;

    const wantNum = Number(want);
    const msgs = [];

    // 1. A~J 單點
    if (wantNum === 1 || wantNum === 4) {
      const single = buildSinglePointBlocks(traitsRules, scores);
      msgs.push(`【A～J 單點】\n\n${single}`);
    }

    // 2. 綜合重點
    if (wantNum === 2 || wantNum === 4) {
      const summary = buildSummaryBlock(traitsRules, scores, maniaB, maniaE);
      msgs.push(summary);
    }

    // 3. 人物側寫
    if (wantNum === 3 || wantNum === 4) {
      const persona = buildPersonaBlock(traitsRules, scores);
      msgs.push(persona);
    }

    // 加上抬頭（基本資料）
    if (msgs.length) {
      const head = `【基本資料】\n姓名：${name || "-"}｜性別：${gender || "-"}｜年齡：${age || "-"}`;
      msgs.unshift(head);
    } else {
      msgs.push("沒有可顯示的內容。");
    }

    // 分段回傳
    const messages = msgs.flatMap(t => splitToMessages(t));

    res.status(200).json({ messages });
  } catch (e) {
    console.error("analyze error:", e);
    res.status(200).json({
      messages: [{ type: "text", text: "分析時發生錯誤，請稍後再試。" }],
    });
  }
}
