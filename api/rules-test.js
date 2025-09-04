import { loadRules } from './_oca_rules.js';

export default async function handler(req, res) {
  try {
    const rules = await loadRules(req);
    // 回傳一點摘要，確認讀檔真的成功
    res.status(200).json({
      ok: true,
      keys: Object.keys(rules || {}),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
