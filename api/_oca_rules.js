// api/_oca_rules.js
// 讀取 /data/oca_rules.json，支援快取；先走本機檔案讀取，失敗再回退到 HTTP 讀取
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 簡單記憶體快取（同一個 Serverless 容器內生效）
let CACHE = { rules: null, mtime: 0 };

async function readFromFile() {
  const file = path.join(process.cwd(), 'data', 'oca_rules.json');
  // 有些環境 bundle 後路徑改變，用 __dirname 再備援一次
  const alt  = path.join(__dirname, '..', 'data', 'oca_rules.json');
  for (const f of [file, alt]) {
    try {
      const raw = await fs.readFile(f, 'utf8');
      return { ok: true, rules: JSON.parse(raw), meta: { source: `file:${f}`, size: Buffer.byteLength(raw, 'utf8') } };
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: 'FILE_READ_FAIL' };
}

async function readFromHttp(req) {
  try {
    const host = req?.headers?.host || process.env.PUBLIC_BASE_URL?.replace(/^https?:\/\//, '');
    if (!host) throw new Error('No host to HTTP fetch rules');
    const url = `https://${host}/data/oca_rules.json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rules = await resp.json();
    return { ok: true, rules, meta: { source: `http:${url}` } };
  } catch (err) {
    return { ok: false, error: `HTTP_READ_FAIL: ${err.message}` };
  }
}

/**
 * 載入教材規則
 * @param {IncomingMessage} req - 可不傳；傳入可做 HTTP 備援讀取
 * @param {object} opts - { noCache?: boolean }
 */
export async function loadRules(req, opts = {}) {
  try {
    // 有快取且不強制跳過就用快取
    if (CACHE.rules && !opts.noCache) {
      return { ok: true, rules: CACHE.rules, meta: { source: 'cache', mtime: CACHE.mtime } };
    }

    // 先試讀檔案
    let r = await readFromFile();
    if (!r.ok) {
      // 讀檔失敗再用 HTTP
      r = await readFromHttp(req);
      if (!r.ok) return { ok: false, error: r.error };
    }

    CACHE.rules = r.rules;
    CACHE.mtime = Date.now();
    return { ok: true, rules: r.rules, meta: r.meta };
  } catch (err) {
    return { ok: false, error: err?.stack || String(err) };
  }
}
