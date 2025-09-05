// /api/rules-test.js
// 目的：把 POST 轉發到正式的 /api/analyze，保留 GET 供瀏覽器自測用。

const DEFAULT_BASE =
  (process.env.PUBLIC_BASE_URL || 'https://line-oca-bot.vercel.app').replace(/\/+$/, '');

/**
 * Vercel Node.js API 路由（ESM）
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // 仍保留原本用瀏覽器打開時的簡單檢查
      return res.status(200).json({
        ok: true,
        message: 'rules-test proxy is alive',
        note: 'POST to this endpoint will be proxied to /api/analyze',
        base: DEFAULT_BASE,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    // 將收到的 body 直接轉發到正式的分析端點
    const upstream = await fetch(`${DEFAULT_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    // 若上游不是 2xx，回傳錯誤資訊
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        ok: false,
        error: `Analyze API ${upstream.status}`,
        detail: text?.slice?.(0, 1000) ?? text,
      });
    }

    // 直接把分析結果回給呼叫端（你的 LINE webhook）
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'rules-test proxy failed',
      detail: err?.stack || String(err),
    });
  }
}
