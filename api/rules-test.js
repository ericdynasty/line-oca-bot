// api/rules-test.js
// 用來測試規則檔是否讀得到（GET /api/rules-test）

import { loadRulesSafe } from './_oca_rules.js';

export default async function handler(req, res) {
  try {
    const result = await loadRulesSafe();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err?.stack || err),
    });
  }
}
