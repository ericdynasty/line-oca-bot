import { loadRules } from './_oca_rules.js';

// 這裡先做最簡版：只示範規則載入成功
// 之後你要把真正的分析邏輯放回來也沒問題，規則請用 loadRules(req) 取得
export default async function handler(req, res) {
  try {
    const rules = await loadRules(req);
    res.status(200).json({ ok: true, message: 'rules loaded', keys: Object.keys(rules || {}) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
