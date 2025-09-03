// api/rules-test.js
// 測試規則檔是否能被讀到（對外路徑 /api/rules-test）

const { loadRulesSafe } = require('./_oca_rules');

module.exports = async (req, res) => {
  const ret = loadRulesSafe();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(ret);
};

// 強制使用 Node.js runtime（因為我們要用 fs）
module.exports.config = { runtime: 'nodejs20.x' };
