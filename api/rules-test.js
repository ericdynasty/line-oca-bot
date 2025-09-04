// api/rules-test.js
// 簡易健康檢查端點：永不丟例外，直接輸出 JSON 結果

const { loadRulesSafe } = require('./_oca_rules');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const result = loadRulesSafe();
    // 無論成功/失敗都回 200，把細節交給 result.ok 判斷
    res.status(200).end(JSON.stringify(result, null, 2));
  } catch (e) {
    // 最外層保險絲
    res
      .status(200)
      .end(
        JSON.stringify(
          { ok: false, reason: 'top_level_catch', error: String(e && (e.stack || e.message || e)) },
          null,
          2
        )
      );
  }
};
