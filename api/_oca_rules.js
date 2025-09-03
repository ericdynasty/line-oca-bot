// api/_oca_rules.js
// 安全載入教材規則（不讓函式崩潰）

const fs = require('fs');
const path = require('path');

function loadRulesSafe() {
  const file = path.join(process.cwd(), 'data', 'oca_rules.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const rules = JSON.parse(raw);
    return {
      ok: true,
      rules,
      meta: {
        source: `file:${file}`,
        size: Buffer.byteLength(raw, 'utf8'),
      },
    };
  } catch (err) {
    return {
      ok: false,
      rules: null,
      meta: {
        source: `file:${file}`,
        error: err && (err.stack || err.message || String(err)),
      },
    };
  }
}

module.exports = { loadRulesSafe };
