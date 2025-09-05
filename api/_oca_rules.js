// api/_oca_rules.js — 讀取 /data/oca_rules.json（ESM）
// 支援：FS 與 HTTP 雙路徑、快取、基本驗證與正規化，回傳 { ok, traits, persona, summary, mania, meta }

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ORDER = ["A","B","C","D","E","F","G","H","I","J"];
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

// ---- 簡單記憶體快取（避免每次冷啟都打檔案/HTTP）----
let CACHE = { at: 0, data: null, src: "" };
const TTL_MS = 5 * 60 * 1000; // 5 分鐘

// ---- 檔案讀取（多個候選路徑，避免 Serverless 不同工作目錄）----
async function readViaFs() {
  const candidates = [
    path.join(process.cwd(), "data", "oca_rules.json"),
    path.join(__dirname, "..", "data", "oca_rules.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      return { ok: true, rules: JSON.parse(raw), meta: { source: `file:${file}` } };
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: "FS_READ_FAIL" };
}

// ---- HTTP 讀取（走 Vercel 靜態 /data/oca_rules.json）----
async function readViaHttp(req) {
  try {
    const host  = (req?.headers?.["x-forwarded-host"] || req?.headers?.host || process.env.VERCEL_URL || "").toString();
    const proto = (req?.headers?.["x-forwarded-proto"] || "https").toString();
    if (!host) throw new Error("no host");
    const base = /^https?:\/\//.test(host) ? host : `${proto}://${host}`;
    const url  = `${base}/data/oca_rules.json`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rules = await resp.json();
    return { ok: true, rules, meta: { source: "http", url } };
  } catch (err) {
    return { ok: false, error: `HTTP_READ_FAIL: ${err?.message || err}` };
  }
}

// ---- 工具：排序、過濾、夾限 ----
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n)));
function sortRanges(ranges = []) {
  return ranges
    .map(r => ({
      min: clamp(r.min, -100, 100),
      max: clamp(r.max, -100, 100),
      label: r.label || "",
      desc: r.desc || "",
      ref: r.ref || ""
    }))
    .filter(r => Number.isFinite(r.min) && Number.isFinite(r.max) && r.min <= r.max)
    .sort((a,b) => a.min - b.min);
}

// ---- 驗證與正規化：確保 A~J 齊全、名稱與區間存在 ----
function normalize(rules) {
  const out = {
    traits: {},
    persona: Array.isArray(rules?.persona?.rules) ? rules.persona : { rules: [] },
    summary: rules?.summary || { weights: {}, top: 3 },
    mania: rules?.mania || {}
  };

  for (const k of ORDER) {
    const src = rules?.traits?.[k] || {};
    const name = src.name || TRAIT_NAMES[k];
    const ranges = sortRanges(src.ranges);

    // 若作者漏寫 ranges，就給最基本 5 區段（避免中斷）
    const safeRanges = ranges.length ? ranges : sortRanges([
      { min: -100, max: -61, label: "低(重)", desc: "顯著偏低，建議多觀察與調整。" },
      { min: -60,  max: -21, label: "低(輕)", desc: "略偏低，偶有影響，需留意。" },
      { min: -20,  max:  20, label: "中性",   desc: "較平衡，影響小。" },
      { min:  21,  max:  60, label: "高(輕)", desc: "略偏高，傾向較明顯。" },
      { min:  61,  max: 100, label: "高(重)", desc: "顯著偏高，驅動力大。" },
    ]);

    out.traits[k] = { name, ranges: safeRanges };
  }

  return out;
}

// ---- 對外工具：依 trait 取得對應區間 ----
export function pickRange(traits, key, score) {
  const t = traits?.[key];
  if (!t) return null;
  const s = Number(score ?? 0);
  return t.ranges.find(r => s >= r.min && s <= r.max) || null;
}

// ---- 主要載入流程（含快取）----
export async function loadRules(req) {
  // 命中快取
  if (CACHE.data && Date.now() - CACHE.at < TTL_MS) {
    return CACHE.data;
  }

  // 優先檔案，再退 HTTP
  const a = await readViaFs();
  let base = a;
  if (!a.ok) {
    const b = await readViaHttp(req);
    base = b.ok ? b : { ok: false, error: `${a.error} & ${b.error}` };
  }
  if (!base.ok) return base;

  const normalized = normalize(base.rules);
  const data = {
    ok: true,
    traits: normalized.traits,
    persona: normalized.persona,
    summary: normalized.summary,
    mania: normalized.mania,
    meta: base.meta
  };

  CACHE = { at: Date.now(), data, src: base.meta?.source || "" };
  return data;
}

export default { loadRules, pickRange };
