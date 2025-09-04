// api/_oca_rules.js  (ESM 版本)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadRulesSafe() {
  const file = path.join(__dirname, '..', 'data', 'oca_rules.json');
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
        error: err?.stack || err?.message || String(err),
      },
    };
  }
}

export default loadRulesSafe;
