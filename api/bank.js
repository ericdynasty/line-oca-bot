// api/bank.js
// 診斷 / 自測路由：
// GET /api/bank?echoRules=1    -> 告訴你目前使用的規則（來源路徑 & 前幾條 bands）
// GET /api/bank?selftest=1     -> 用內建 demo 分數跑一次（看結果格式）
// GET /api/bank?scores=A:10,B:-20,...  -> 自定分數快速檢查
//
// 回傳 JSON，方便你在瀏覽器或 Postman 直接看。

const {
  LETTERS,
  loadRules,
  formatSingles,
  formatCombined,
  formatPersona,
} = require('./_oca_rules');

function parseScoresQuery(q) {
  // 允許 "A:10,B:-20,C:5" 或 "A10 B-20 C5"
  const scores = {};
  if (!q) return scores;
  const parts = q.split(/[, ]+/).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^([A-J])[:：]?(-?\d{1,3})$/i);
    if (m) {
      const L = m[1].toUpperCase();
      scores[L] = Number(m[2]);
    }
  }
  return scores;
}

module.exports = async (req, res) => {
  try {
    const rules = loadRules();

    if (req.query.echoRules) {
      // 只展示部分內容，避免太長
      const preview = {};
      for (const L of LETTERS) {
        preview[L] = (rules.bands?.[L] || []).slice(0, 2); // 各點前兩條 band 當預覽
      }
      return res.status(200).json({
        ok: true,
        meta: rules._meta || {},
        preview,
      });
    }

    let scores = {};
    if (req.query.selftest) {
      // 一組固定 demo 分數
      scores = { A: 12, B: -8, C: -35, D: 22, E: 41, F: 51, G: 16, H: 2, I: -33, J: -12 };
    } else if (req.query.scores) {
      scores = parseScoresQuery(req.query.scores);
    }

    if (!Object.keys(scores).length) {
      return res.status(200).json({
        ok: true,
        howTo: {
          echoRules: '/api/bank?echoRules=1',
          selftest: '/api/bank?selftest=1',
          customScores: '/api/bank?scores=A:10,B:-20,C:5,D:0,E:41,F:51,G:16,H:2,I:-33,J:-12',
        },
      });
    }

    const singles = formatSingles(scores, rules);
    const combined = formatCombined(scores, rules, { maniaB: false, maniaE: false, date: '' });
    const persona = formatPersona(scores, rules);

    return res.status(200).json({
      ok: true,
      meta: rules._meta || {},
      inputScores: scores,
      singles,
      combined,
      persona,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
};
