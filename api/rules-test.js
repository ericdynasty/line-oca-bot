// api/rules-test.js
// 簡單測試端點：讀取 data/oca_rules.json 是否成功

const { loadRules } = require('./_oca_rules');

module.exports = async (req, res) => {
  try {
    const rules = await loadRules();
    // 統計一下每個章節有幾條規則，當成健康檢查
    const sectionNames = Object.keys(rules || {});
    const perSection = {};
    let total = 0;

    for (const k of sectionNames) {
      const arr = Array.isArray(rules[k]) ? rules[k] : [];
      perSection[k] = arr.length;
      total += arr.length;
    }

    res.status(200).json({
      ok: true,
      sections: sectionNames,
      counts: perSection,
      total,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack,
    });
  }
};
