// 簡單檢查 data/oca_rules.json 是否能被讀到，並回傳一些摘要資訊
const fs = require('fs').promises;
const path = require('path');

module.exports = async (req, res) => {
  try {
    const file = path.join(process.cwd(), 'data', 'oca_rules.json'); // => /vercel/path0/data/oca_rules.json
    const raw = await fs.readFile(file, 'utf8');
    const rules = JSON.parse(raw);

    // 這裡嘗試推測常見的結構，方便你確認內容是否正確載入
    const topKeys = Object.keys(rules || {});
    const single = rules.single || rules.SINGLE || rules.a_to_j || {};
    const combo = rules.combo || rules.COMBO || {};
    const persona = rules.persona || rules.PERSONA || {};

    // 取一點「樣本」給你確認（不論實際結構，只要有 A 就示意帶回）
    const sampleA =
      (single.A) ||
      (single.a) ||
      (rules.A) ||
      null;

    return res.status(200).json({
      ok: true,
      // 秀出相對路徑（去掉執行目錄，便於閱讀）
      readFrom: file.replace(process.cwd(), ''),
      // 顶層 key 與各區塊數量，幫你快速 sanity-check
      topLevelKeys: topKeys,
      count: {
        single: (single && typeof single === 'object') ? Object.keys(single).length : 0,
        combo: (combo && typeof combo === 'object') ? Object.keys(combo).length : 0,
        persona: (persona && typeof persona === 'object') ? Object.keys(persona).length : 0,
      },
      // 範例：單點 A 的規則（若存在就帶回一小段）
      sample: { A: sampleA },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      // 只保留第一行 stack，避免太長
      where: (e.stack || '').split('\n')[0],
    });
  }
};
