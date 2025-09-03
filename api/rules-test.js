// api/rules-test.js
// 讀 data/oca_rules.json 的健康檢查；使用你目前的 loadRulesSafe

const { loadRulesSafe } = require('./_oca_rules');

module.exports = async (req, res) => {
  const out = loadRulesSafe(); // 同步讀檔（你目前的寫法）

  if (!out.ok) {
    return res.status(500).json(out); // 把錯誤也回給你看
  }

  const rules = out.rules || {};
  const sections = Object.keys(rules);
  const counts = {};
  let total = 0;

  for (const k of sections) {
    const arr = Array.isArray(rules[k]) ? rules[k] : [];
    counts[k] = arr.length;
    total += arr.length;
  }

  return res.status(200).json({
    ok: true,
    from: out.meta && out.meta.source,
    size: out.meta && out.meta.size,
    sections,
    counts,
    total
  });
};
