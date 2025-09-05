// api/analyze.js — 教材規則版（直接覆蓋）
// - 讀取 /data/oca_rules.json（透過 _oca_rules.js，含 FS/HTTP、正規化、快取）
// - 支援：A~J 單點、綜合重點（教材公式/權重）、人物側寫（when 條件）、躁狂提示（門檻從 JSON）
// - 版面：各段落空一行；A~J 每點之間空一行
import { loadRules, pickRange } from "./_oca_rules.js";

// 固定順序與名稱（教材）
const ORDER = ["A","B","C","D","E","F","G","H","I","J"];
const NAMES = {
  A: "穩定性", B: "愉快", C: "鎮定", D: "確定力", E: "活躍",
  F: "積極", G: "負責", H: "評估能力", I: "欣賞能力", J: "溝通能力",
};

// ---- 讀 body（支援 POST raw / 物件、GET query）----
async function readJson(req) {
  if (req.method === "POST") {
    try {
      if (typeof req.body === "object" && req.body) return req.body;
      const bufs = [];
      for await (const c of req) bufs.push(c);
      const raw = Buffer.concat(bufs).toString("utf8");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  try {
    const url = new URL(req.url, "http://x");
    const obj = {};
    for (const [k, v] of url.searchParams.entries()) obj[k] = v;
    return obj;
  } catch { return {}; }
}

const num = (v, d=0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function normalizeScores(payload={}) {
  const src = payload.scores ?? payload;
  const out = {};
  for (const k of ORDER) out[k] = num(src?.[k], 0);
  return out;
}
function parseView(payload={}) {
  const v = num(payload.view ?? payload.mode ?? payload.want, 4);
  return [1,2,3,4].includes(v) ? v : 4;
}
function parseMania(payload={}) {
  const m = payload.mania ?? {};
  const b = m.B ?? payload.B_mania ?? 0;
  const e = m.E ?? payload.E_mania ?? 0;
  const toBool = (x) => x === true || x === 1 || x === "1";
  return { B: toBool(b), E: toBool(e) };
}

// ---- 段落合併工具：把 lines 以「空一行」串起來，並切片避免超長 ----
function splitText(text, max=4000) {
  const out = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if ((buf + line + "\n").length > max) {
      out.push(buf.trimEnd());
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf.trim()) out.push(buf.trimEnd());
  return out;
}
function blockToTexts(block) {
  const body = block.lines.join("\n\n"); // ★每一點/每行之間「空一行」
  return splitText(`【${block.title}】\n\n${body}`); // ★段落標題與內容中間空一行
}

// ---- 單點 ----
function renderSingles(traits, scores) {
  const lines = [];
  for (const k of ORDER) {
    const s   = num(scores[k], 0);
    const rng = pickRange(traits, k, s);
    const nm  = traits?.[k]?.name || NAMES[k] || k;

    if (!rng) {
      lines.push(`${k} ${nm}：${s}｜（無對應區間）`);
      continue;
    }
    const tag  = rng.label ? `${rng.label}` : "";
    const desc = rng.desc  ? `｜${rng.desc}` : "";
    const ref  = rng.ref   ? `（教材 ${rng.ref}）` : "";
    lines.push(`${k} ${nm}：${s}｜${tag}${desc} ${ref}`.trim());
  }
  return { title: "A～J 單點", lines };
}

// ---- 綜合重點（教材公式/權重）----
// oca_rules.json 的 summary 可提供：
//   { "useWeights": true, "formula": "weighted_abs" | "weighted_signed" | "abs", "top": 3 }
// - weighted_abs（預設）：|score| * |weight|
// - weighted_signed：|score * weight|（與上者數學等價，但保留語意）
// - abs：僅看 |score|（忽略權重）
function renderSummary(summary, traits, scores) {
  const useWeights = summary?.useWeights !== false; // 預設使用權重
  const formula    = summary?.formula || (useWeights ? "weighted_abs" : "abs");
  const topN       = Math.max(1, num(summary?.top, 3));

  const arr = ORDER.map((k) => {
    const s = num(scores[k], 0);
    const w = useWeights ? num(summary?.weights?.[k], 1) : 1;
    let mag;
    switch (formula) {
      case "abs":              mag = Math.abs(s);           break;
      case "weighted_signed":  mag = Math.abs(s * w);       break;
      case "weighted_abs":
      default:                 mag = Math.abs(s) * Math.abs(w);
    }
    const nm  = traits?.[k]?.name || NAMES[k] || k;
    const rng = pickRange(traits, k, s);
    const tag = rng?.label ? rng.label : "";
    const desc= rng?.desc  ? `｜${rng.desc}` : "";
    const ref = rng?.ref   ? `（教材 ${rng.ref}）` : "";
    return {
      k, s, w, mag,
      text: `${k} ${nm}：${s}｜${tag}${desc} ${ref}`.trim(),
    };
  }).sort((a,b)=> b.mag - a.mag);

  const picked = arr.slice(0, topN);
  const lines  = [
    `依教材：公式 ${formula}${useWeights ? "、含權重" : "、不含權重"}；Top${topN}：`,
    ...picked.map((x,i)=> `${i+1}. ${x.text}`)
  ];
  return { title: "綜合重點", lines };
}

// ---- 人物側寫（when 條件）----
function evalWhen(expr, scores) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  // 嚴格白名單：A~J、數字與常見運算符
  const ok = /^[\sA-J0-9()+\-*/.<>=!&|]+$/u.test(expr);
  if (!ok) return false;
  try {
    const fn = new Function(...ORDER, `return (${expr});`); // eslint-disable-line no-new-func
    const args = ORDER.map(k => num(scores[k], 0));
    return !!fn(...args);
  } catch { return false; }
}
function renderPersona(persona, scores) {
  const rules = Array.isArray(persona?.rules) ? persona.rules : [];
  const hits  = [];
  for (const r of rules) {
    if (!r?.when || !r?.text) continue;
    if (evalWhen(r.when, scores)) hits.push(r.text);
  }
  const lines = hits.length ? hits : ["（本次未符合人物側寫規則）"];
  return { title: "人物側寫", lines };
}

// ---- 躁狂提示（門檻從 JSON）----
function renderMania(rulePack, scores, flags) {
  const th = num(rulePack?.mania?.threshold, 60);
  const items = [];
  if (rulePack?.mania?.B && (flags.B || num(scores.B) >= th)) {
    items.push(`${rulePack.mania.B.label}：${rulePack.mania.B.hint}`);
  }
  if (rulePack?.mania?.E && (flags.E || num(scores.E) >= th)) {
    items.push(`${rulePack.mania.E.label}：${rulePack.mania.E.hint}`);
  }
  if (!items.length) return null;
  return { title: "提醒（躁狂相關）", lines: items };
}

// ---- 主處理 ----
export default async function handler(req, res) {
  try {
    // 1) 載規則
    const pack = await loadRules(req);
    if (!pack?.ok) {
      return res.status(500).json({ ok:false, error:"RULES_LOAD_FAIL", detail: pack?.error });
    }
    const { traits, summary, persona } = pack;

    // 2) 取輸入
    const payload = await readJson(req);
    const scores  = normalizeScores(payload);
    const view    = parseView(payload);
    const mania   = parseMania(payload);

    const name   = String(payload.name ?? "").trim();
    const gender = String(payload.gender ?? "").trim();
    const age    = payload.age ?? "";
    const date   = payload.date ?? ""; // 有給就顯示；沒給不強制

    // 3) 組段落（依 view）
    const blocks = [];
    // 基本資料（若有）
    const baseLines = [];
    if (name)   baseLines.push(`姓名：${name}`);
    if (gender) baseLines.push(`性別：${gender}`);
    if (age)    baseLines.push(`年齡：${age}`);
    if (date)   baseLines.push(`日期：${date}`);
    if (baseLines.length) blocks.push({ title:"基本資料", lines: [baseLines.join("｜")] });

    if (view === 1 || view === 4) blocks.push(renderSingles(traits, scores));
    if (view === 2 || view === 4) blocks.push(renderSummary(summary, traits, scores));
    if (view === 3 || view === 4) blocks.push(renderPersona(persona, scores));
    const maniaBlock = renderMania(pack, scores, mania);
    if (view === 4 && maniaBlock) blocks.push(maniaBlock);

    if (!blocks.length) {
      blocks.push({ title: "結果", lines: ["（沒有可顯示的內容）"] });
    }

    // 4) 版面輸出：每段落空一行、A~J 每點之間空一行
    //    - messages：[{type:"text", text:"..."}]（給 LINE 直接丟）
    //    - text：把所有段落合併成一個長字串（備援）
    const messageTexts = blocks.flatMap(blockToTexts);
    const messages = messageTexts.map((t) => ({ type: "text", text: t }));

    // 合併為一個長字串（保留空一行）
    const fullText = messageTexts.join("\n\n");

    return res.status(200).json({
      ok: true,
      messages,   // 你的 line-webhook 可直接 push 這個
      blocks,     // 若要做更漂亮的排版 GUI 可用這個結構
      text: fullText,
      meta: { source: pack.meta || {} }
    });
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({ ok:false, error:"ANALYZE_RUNTIME_ERROR", detail: err?.message || String(err) });
  }
}
