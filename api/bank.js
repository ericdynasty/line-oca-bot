// api/bank.js
// 檢查：echoRules / selftest / 自訂 scores，全部加上保護

const { loadRulesSafe } = require('./_oca_rules');

const LETTERS = 'ABCDEFGHIJ'.split('');

// 解析 query.scores（例如 A:12,B:-8,...）
function parseScoresText(s) {
  const out = {};
  LETTERS.forEach(l => (out[l] = 0));
  if (!s || typeof s !== 'string') return out;

  const re = /([A-J])\s*[:：]\s*(-?\d+)/gi;
  let m;
  while ((m = re.exec(s))) {
    const L = m[1].toUpperCase();
    const n = Number(m[2]);
    if (Number.isFinite(n)) out[L] = n;
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const { ok, rules, meta } = loadRulesSafe();

    // 1) 只想看規則來源與載入狀態
    if (req.query.echoRules) {
      return res.status(200).json({
        ok,
        meta,
        hasRules: !!rules,
        note: ok
          ? '規則載入成功（但這裡不直接回傳全文）'
          : '規則載入失敗，請看 meta.error',
      });
    }

    // 2) 自動帶一組測試分數
    if (req.query.selftest) {
      const self = { A: 10, B: -15, C: -30, D: 20, E: 35, F: 45, G: 5, H: 0, I: -25, J: 8 };
      return res.status(200).json({
        ok: true,
        meta,
        scores: self,
        tip: '用 ?scores=A:10,B:-15,... 可以丟自訂分數',
      });
    }

    // 3) 丟自訂分數（?scores=...）
    const scores = parseScoresText(req.query.scores);

    // 若規則沒載入成功，先回錯誤，不要崩潰
    if (!ok || !rules) {
      return res.status(500).json({
        ok: false,
        error: 'FAILED_TO_LOAD_RULES',
        meta,
        hint: '請先修正 data/oca_rules.json 為合法 JSON，或確認 vercel.json 有 includeFiles',
      });
    }

    // 你後續的「分析邏輯」會用到 rules 與 scores
    // 這裡先把兩者安全回傳，確認輸入/讀檔都 OK
    return res.status(200).json({
      ok: true,
      meta,
      scores,
      // 只曝露規則的版本資訊，不回全文避免太長（真的要看全文可在 echoRules 之後另開）
      rulesInfo: {
        topLevelKeys: Object.keys(rules || {}),
        // 視你的 JSON 結構調整要透露什麼
      },
      tip: '目前只是檢查輸入/讀檔是否正常；分析邏輯會在 submit-oca.js 或其他 API 內執行。',
    });
  } catch (err) {
    console.error('[bank] fatal error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL',
      detail: err && (err.stack || err.message || String(err)),
    });
  }
};
