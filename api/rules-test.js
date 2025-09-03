// api/rules-test.js
// 確認 /api 路由與讀檔沒問題的最小測試

const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const file = path.join(process.cwd(), 'data', 'oca_rules.json');
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: true,
      countKeys: Object.keys(json || {}).length,
      previewKeys: Object.keys(json || {}).slice(0, 5),
      source: 'file:' + file
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      err: String(e)
    });
  }
};
