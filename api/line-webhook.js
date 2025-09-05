// === 直接呼叫正式分析 API（POST /api/analyze）===
// 你可以把這個函式直接貼到 /api/line-webhook.js，取代原本呼叫 /api/rules-test 的那一段。

async function callAnalyzeAndReply(lineReplyToken, payload) {
  // 你專案的外部網址（沒設定就用 vercel 預設網域）
  const BASE =
    (process.env.PUBLIC_BASE_URL || 'https://line-oca-bot.vercel.app').replace(/\/+$/, '');

  try {
    // 1) 把資料 POST 給 /api/analyze
    const resp = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // 失敗時回一段錯誤訊息給使用者（避免卡住）
      await replyText(lineReplyToken, [
        '分析失敗，請稍後再試。',
        `(${resp.status}) ${text.slice(0, 200)}`
      ].join('\n'));
      return;
    }

    // 2) API 會回你已排版好的文字（或多段文字）
    const data = await resp.json();

    // 假設 /api/analyze 會回 { ok:true, messages: [ "段落1", "段落2", ... ] }
    // 若你的 analyze 回傳欄位不同，就把下面這行換成正確欄位即可。
    const out = Array.isArray(data.messages) ? data.messages : [String(data.result || data.text || '')];

    // 3) 逐段回覆到 LINE
    for (const chunk of out) {
      if (!chunk) continue;
      await replyText(lineReplyToken, chunk);
    }
  } catch (err) {
    await replyText(lineReplyToken, `分析發生錯誤：${err.message || String(err)}`);
  }
}

/**
 * 小工具：回覆純文字到 LINE（保留你原本專案裡的版本也可以）
 * 這裡假設你已經有 CHANNEL_ACCESS_TOKEN。
 */
async function replyText(replyToken, text) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}
