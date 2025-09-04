// api/_oca_rules.js
// 安全載入教材規則：先嘗試讀檔，失敗就改走 HTTP 讀取 /data/oca_rules.json

const fs = require('fs');
const path = require('path');

function readViaFs() {
  try {
    const p = path.join(process.cwd(), 'data', 'oca_rules.json');
    const raw = fs.readFileSync(p, 'utf8');
    return { ok: true, data: JSON.parse(raw), source: 'fs' };
  } catch (err) {
    return { ok: false, err };
  }
}

async function readViaHttp(host) {
  try {
    const base =
      process.env.PUBLIC_BASE_URL ||
      (host ? `https://${host}` : '');

    if (!base) throw new Error('no base url to fetch /data/oca_rules.json');

    const url = `${base}/data/oca_rules.json`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} when GET ${url}`);
    const data = await resp.json();
    return { ok: true, data, source: 'http', url };
  } catch (err) {
    return { ok: false, err };
  }
}

async function loadRulesSafe(host) {
  const fsRes = readViaFs();
  if (fsRes.ok) {
    return { ok: true, rules: fsRes.data, meta: { source: fsRes.source } };
  }
  const httpRes = await readViaHttp(host);
  if (httpRes.ok) {
    return { ok: true, rules: httpRes.data, meta: { source: httpRes.source, url: httpRes.url } };
  }
  return {
    ok: false,
    rules: null,
    meta: {
      fsError: String(fsRes.err && (fsRes.err.message || fsRes.err)),
      httpError: String(httpRes.err && (httpRes.err.message || httpRes.err)),
    },
  };
}

module.exports = { loadRulesSafe };
