// api/_oca_rules.js
// 使用 ESM 讀取 /data/oca_rules.json，安全包一層不讓函式崩潰

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadRulesSafe() {
  // __dirname 是 /api，往上一層到專案根，再進 data/oca_rules.json
  const file = path.join(__dirname, '..', 'data', 'oca_rules.json');

  try {
    const raw = await fs.readFile(file, 'utf8');
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
        error: String(err?.stack || err),
      },
    };
  }
}

export default { loadRulesSafe };
