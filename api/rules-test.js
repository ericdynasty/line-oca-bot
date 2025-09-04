// api/rules-test.js
// 確認規則檔可被讀到，回傳精簡摘要（來源與幾個 key）

const { loadRulesSafe } = require('./_oca_rules');

module.exports = async (req, res) => {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const r = await loadRulesSafe(host);

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        msg: 'Failed to load oca_rules.json',
        meta: r.meta,
      });
    }

    const rules = r.rules || {};
    const keys = Object.keys(rules);
    // 給個很小的摘要，避免把整包規則吐出來
    res.status(200).json({
      ok: true,
      source: r.meta.source,     // 'fs' 或 'http'
      url: r.meta.url || undefined,
      topKeys: keys.slice(0, 10),
      bandsKeys: rules.bands ? Object.keys(rules.bands).slice(0, 10) : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && (e.message || e)) });
  }
};
