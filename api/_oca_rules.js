// api/_oca_rules.js — 讀取 /data/oca_rules.json（ESM）
// 先嘗試讀檔案；失敗就改用 HTTP 讀靜態資源，避免 Serverless 路徑差異。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function readViaFs() {
  const candidates = [
    path.join(process.cwd(), 'data', 'oca_rules.json'),
    path.join(__dirname, '..', 'data', 'oca_rules.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = await readFile(file, 'utf8');
      return { ok: true, rules: JSON.parse(raw), meta: { source: `file:${file}` } };
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: 'FS_READ_FAIL' };
}

async function readViaHttp(req) {
  try {
    const host  = (req?.headers?.['x-forwarded-host'] || req?.headers?.host || process.env.VERCEL_URL || '').toString();
    const proto = (req?.headers?.['x-forwarded-proto'] || 'https').toString();
    if (!host) throw new Error('no host');
    const base = /^https?:\/\//.test(host) ? host : `${proto}://${host}`;
    const url  = `${base}/data/oca_rules.json`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rules = await resp.json();
    return { ok: true, rules, meta: { source: 'http', url } };
  } catch (err) {
    return { ok: false, error: `HTTP_READ_FAIL: ${err?.message || err}` };
  }
}

export async function loadRules(req) {
  const a = await readViaFs();
  if (a.ok) return a;
  const b = await readViaHttp(req);
  if (b.ok) return b;
  return { ok: false, error: `${a.error} & ${b.error}` };
}

export default { loadRules };
