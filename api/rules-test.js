// api/rules-test.js
// 讀 data/oca_rules.json 並把詳細狀態回傳（即使出錯也只回 JSON，不會崩）

const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const file = path.join(process.cwd(), 'data', 'oca_rules.json');

  try {
    // 1) 讀檔
    let raw = '';
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      return res.status(200).json({
        ok: false,
        step: 'readFile',
        file,
        code: e.code || null,
        error: e.message || String(e)
      });
    }

    // 2) 解析 JSON
    let json = null;
    try {
      // 去掉可能的 BOM
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(200).json({
        ok: false,
        step: 'JSON.parse',
        error: e.message || String(e),
        headSample: raw.slice(0, 200) // 讓你看到前 200 字元，方便找怪字元
      });
    }

    // 3) 一些輔助資訊（不影響結果）
    const size = Buffer.byteLength(raw, 'utf8');
    const topKeys = Array.isArray(json)
      ? `array(length=${json.length})`
      : Object.keys(json).slice(0, 20);

    // 若你的規則是放在 json.rules 或直接平鋪，這裡都先做個安全判斷
    const letters = ['A','B','C','D','E','F','G','H','I','J'];
    const hasLetters =
      (json && typeof json === 'object') &&
      letters.every(k => (json[k] != null) || (json.rules && json.rules[k] != null));

    return res.status(200).json({
      ok: true,
      file,
      bytes: size,
      structure: topKeys,
      hasLetters
    });
  } catch (e) {
    // 保險：任何未預期錯誤都會以 JSON 回傳
    return res.status(200).json({
      ok: false,
      step: 'outer',
      error: e?.stack || String(e)
    });
  }
};
