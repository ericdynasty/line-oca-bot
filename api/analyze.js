// api/analyze.js (ESM) — 直接覆蓋版
// 讀取教材規則、輸出單點/綜合/人物側寫/躁狂提示
import { loadRules, pickRange } from "./_oca_rules.js";

// 固定順序與名稱（與教材一致）
const ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
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

// --- 讀取請求 body（POST/GET 都盡量相容）---
async function readJson(req) {
  try {
    const bufs = [];
    for await (const c of req) bufs.push(c);
    const raw = Buffer.concat(bufs).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function num(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

// 把輸入轉成固定 scores 物件（A~J 都有數值）
function normalizeScores(payload = {}) {
  const out = {};
  const src = payload?.scores || payload; // 兼容：直接傳 A~J 或包在 scores 裡
  for (const k of ORDER) out[k] = num(src?.[k], 0);
  return out;
}

// 解析「想看的內容」：1=單點、2=綜合、3=人物、4=全部（默認 4）
function parseView(payload = {}) {
  const v = num(payload?.view ?? payload?.mode ?? payload?.want, 4);
  return [1, 2, 3, 4].includes(v) ? v : 4;
}

// 解析躁狂：允許 { mania: { B:1/true, E:0/false } } 或直接 { B_mania:1, E_mania:0 }
function parseMania(payload = {}) {
  const m = payload?.mania || {};
  const b = (m.B ?? payload?.B_mania ?? 0);
  const e = (m.E ?? payload?.E_mania ?? 0);
  const toBool = (x) => (x === true || x === "1" || x === 1);
  return { B: toBool(b), E: toBool(e) };
}

// 單點解讀（A~J）
function renderSinglePoints(traits, scores) {
  const lines = [];
  for (const k of ORDER) {
    const name  = traits?.[k]?.name || TRAIT_NAMES[k] || k;
    const score = num(scores[k], 0);
    const rng   = pickRange(traits, k, score);
    if (!rng) {
      lines.push(`${k} ${name}：${score}｜（無對應區間）`);
      continue;
    }
    const tag  = `${rng.label || ""}`.trim();
    const ref  = rng.ref ? `（教材 ${rng.ref}）` : "";
    const desc = rng.desc ? `｜${rng.desc}` : "";
    lines.push(`${k} ${name}：${score}｜${tag}${desc} ${ref}`.trim());
  }
  return { title: "A～J 單點", lines };
}

// 綜合重點（依 weights 加權，取 top N，顯示教材說明）
function renderSummary(summary, traits, scores) {
  const weights = summary?.weights || {};
  const topN    = Math.max(1, num(summary?.top, 3));

  const arr = ORDER.map((k) => {
    const w   = num(weights[k], 1);
    const s   = num(scores[k], 0);
    const mag = Math.abs(s) * Math.abs(w); // 以絕對值強度排序
    const rng = pickRange(traits, k, s);
    const tag = rng?.label ? rng.label : "";
    const ref = rng?.ref ? `（教材 ${rng.ref}）` : "";
    const desc= rng?.desc ? `｜${rng.desc}` : "";
    const name= traits?.[k]?.name || TRAIT_NAMES[k] || k;
    const text= `${k} ${name}：${s}｜${tag}${desc} ${ref}`.trim();
    return { k, w, s, mag, text };
  }).sort((a, b) => b.mag - a.mag);

  const picked = arr.slice(0, topN);
  const lines  = [
    `影響力 Top${topN}（權重與分數綜合）：`,
    ...picked.map((x, i) => `${i + 1}. ${x.text}`),
  ];
  return { title: "綜合重點", lines };
}

// 安全求值 persona.when（僅允許 A~J、數字、比較與邏輯運算）
function evalWhen(expr, scores) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  // 嚴格白名單：字母 A~J、數字、空白、()、比較與邏輯符號、加減乘除與小數點
  const safe = /^[\sA-J0-9()<>=!&|+\-*/.]+$/u.test(expr);
  if (!safe) return false;
  try {
    const fn = new Function(...ORDER, `return (${expr});`);
    const args = ORDER.map((k) => num(scores[k], 0));
    const out = fn(...args);
    return !!out;
  } catch {
    return false;
  }
}

// 人物側寫（符合條件就列出文字）
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

// 躁狂提示：若有被勾選或分數高於門檻（預設 >= 60），顯示教材提示
function renderMania(rules, scores, maniaFlags) {
  const lines = [];
  const th = 60; // 自動門檻（可依需求調整或改成從 JSON 讀）

  if (rules?.mania?.B && (maniaFlags.B || num(scores.B) >= th)) {
    lines.push(`${rules.mania.B.label}：${rules.mania.B.hint}`);
  }
  if (rules?.mania?.E && (maniaFlags.E || num(scores.E) >= th)) {
    lines.push(`${rules.mania.E.label}：${rules.mania.E.hint}`);
  }
  if (!lines.length) return null;
  return { title: "提醒（躁狂相關）", lines };
}

// 文字備援：若 caller 不處理 blocks，就用 text 顯示
function blocksToText(blocks) {
  return blocks
    .map(b => [b.title, ...b.lines].join("\n"))
    .join("\n\n");
}

// === API Handler ===
export default async function handler(req, res) {
  try {
    // 1) 載入教材規則
    const rulePack = await loadRules(req);
    if (!rulePack?.ok) {
      return res.status(500).json({
        ok: false,
        error: "RULES_LOAD_FAIL",
        detail: rulePack?.error || "unknown"
      });
    }

    // 2) 讀取使用者輸入
    const payload = req.method === "POST" ? await readJson(req) : Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const scores  = normalizeScores(payload);
    const view    = parseView(payload);
    const mania   = parseMania(payload);

    const { traits, summary, persona } = rulePack;

    // 3) 組裝 blocks
    const blocks = [];
    // 單點：1 或 4
    if (view === 1 || view === 4) {
      blocks.push(renderSinglePoints(traits, scores));
    }
    // 綜合：2 或 4
    if (view === 2 || view === 4) {
      blocks.push(renderSummary(summary, traits, scores));
    }
    // 人物：3 或 4
    if (view === 3 || view === 4) {
      blocks.push(renderPersona(persona, scores));
    }
    // 躁狂提示：只有在 4（全部）時一併顯示，或你想在 1~3 也顯示可放開
    const maniaBlock = renderMania(rulePack, scores, mania);
    if (view === 4 && maniaBlock) blocks.push(maniaBlock);

    // 若 blocks 為空（理論上不會發生），做基本備援
    if (!blocks.length) {
      blocks.push({ title: "結果", lines: ["（沒有可顯示的內容）"] });
    }

    const text = blocksToText(blocks);

    return res.status(200).json({
      ok: true,
      blocks,
      text,
      meta: { source: rulePack?.meta || {} }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "ANALYZE_RUNTIME_ERROR",
      detail: err?.message || String(err)
    });
  }
}
