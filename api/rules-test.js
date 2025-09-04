// api/rules-test.js  (ESM 版本)

import { loadRulesSafe } from './_oca_rules.js';

export default function handler(req, res) {
  const data = loadRulesSafe();
  res.status(data.ok ? 200 : 500).json(data);
}
