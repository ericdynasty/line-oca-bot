// api/_oca_rules.js
// 安全載入規則檔（永不丟例外）

const fs = require('fs');
const path = require('path');

function loadRulesSafe() {
  const file = path.join(process.cwd(), 'data', 'oca_rules.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      const json = JSON.parse(raw); // 這裡若 JSON 不合法會丟錯，但我們會抓住
      return {
        ok: true,
        meta: {
          source: `file:${file}`,
          bytes: Buffer.byteLength(raw, 'utf8'),
          keys: Array.isArray(json) ? [] : Object.keys(json).slice(0, 20),
        },
        rules: json, // 先全量回給你檢查，之後要精簡再說
      };
    } catch (parseErr) {
      return {
        ok: false,
        reason: 'parse_error',
        meta: {
          source: `file:${file}`,
          bytes: Buffer.byteLength(raw, 'utf8'),
        },
        error: String(parseErr && (parseErr.stack || parseErr.message || parseErr)),
        preview: raw.slice(0, 400), // 讓你快速看到開頭內容
      };
    }
  } catch (ioErr) {
    return {
      ok: false,
      reason: 'fs_read_error',
      meta: { source: `file:${file}` },
      error: String(ioErr && (ioErr.stack || ioErr.message || ioErr)),
    };
  }
}

module.exports = { loadRulesSafe };
