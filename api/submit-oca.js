// api/submit-oca.js
// Hardened version: fetch polyfill + full guards + never-throw response

// ---- fetch polyfill (for Node 16/older) ----
const fetchFn = (...args) =>
  (typeof fetch === 'function'
    ? fetch(...args)
    : import('node-fetch').then(m => m.default(...args)));

// ---- constants ----
const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 穩定",
  B: "B 價值",
  C: "C 變化",
  D: "D 果敢",
  E: "E 活躍",
  F: "F 樂觀",
  G: "G 責任",
  H: "H 評估力",
  I: "I 欣賞能力",
  J: "J 滿意能力",
};

// ---- helpers ----
const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const safeScore = v => clamp(num(v, 0), -100, 100);

function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    out[L] = safeScore(input && input[L]);
  }
  return out;
}

// 等級+提示（簡短、穩定不會 throw）
function bandDesc(n) {
  const v = num(n, 0);
  if (v >= 41)  return ["高(重)", "偏強勢、驅動力大"];
  if (v >= 11)  return ["高(輕)", "略偏高、傾向較明顯"];
  if (v <= -41) return ["低(重)", "不足感明顯、需特別留意"];
  if (v <= -11) return ["低(輕)", "略偏低、偶爾受影響"];
  return ["中性", "較平衡、影響小"];
}

function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

// ---- LINE push ----
async function pushMessage(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) {
    console.error("[submit-oca] Missing LINE_CHANNEL_ACCESS_TOKEN");
    return; // 不 throw，避免 500
  }
  const resp = await fetchFn("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("[submit-oca] Push API error:", resp.status, t);
  }
}

// ---- handler ----
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // 兼容某些情況 req.body 不是 object
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const userId = body.userId || "";
    const name   = (body.name || "").toString().slice(0, 40);
    const gender = (body.gender || "").toString().slice(0, 10);
    const age    = num(body.age, 0);
    const date   = (body.date || "").toString().slice(0, 20);

    // 兩個躁狂勾選
    const maniaB = !!body.maniaB;
    const maniaE = !!body.maniaE;

    // 分數
    const scores = normalizeScores(body.scores || {});
    // 願望
    const wants = Object.assign(
      { single: true, combo: true, persona: true },
      body.wants || {}
    );

    // 最少要有 userId 才能推播，不足就快速回 200 並寫 log
    if (!userId) {
      console.error("[submit-oca] Missing userId in body");
      return res.status(200).json({ ok: false, msg: "missing userId" });
    }
    if (age < 14) {
      // 規則要求 14+，回覆友善訊息
      await pushMessage(userId, [
        { type: "text", text: "年齡需 ≥ 14 才能進行分析，請再確認年齡喔。" }
      ]);
      return res.status(200).json({ ok: false, msg: "age < 14" });
    }

    // --- 產出訊息（簡短） ---
    // 1) 打招呼
    const first = {
      type: "text",
      text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）`
    };

    // 2) A~J 單點（用｜分隔，較好讀）
    const singles = LETTERS.map(L => {
      const v = scores[L];
      const [lvl, hint] = bandDesc(v);
      return `${NAMES[L]}：${v} ｜ ${lvl} ｜ ${hint}`;
    }).join("\n");

    const singleMsg = { type: "text", text: `【A~J 單點】\n${singles}`.slice(0, 5000) };

    // 3) 綜合重點（前三名絕對值）
    const tops = topLetters(scores, 3);
    const topText = tops.map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`).join("、");
    const comboMsg = {
      type: "text",
      text: `【綜合重點】\n最需留意／最有影響的面向：${topText || "無特別突出"}。\n躁狂（B 情緒）：${maniaB ? "有" : "無"}；躁狂（E 點）：${maniaE ? "有" : "無"}；日期：${date || "未填"}。`.slice(0, 5000)
    };

    // 4) 人物側寫（超簡）
    let personaText = "【人物側寫】\n";
    if (tops.length >= 2) {
      const [L1, v1] = tops[0];
      const [L2, v2] = tops[1];
      const dir1 = v1 >= 0 ? "偏高" : "偏低";
      const dir2 = v2 >= 0 ? "偏高" : "偏低";
      personaText += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${dir1 === "偏高" ? "主動" : "保守"}、${dir2 === "偏高" ? "外放" : "內斂"}」傾向（示意）。`;
    } else {
      personaText += "整體表現較均衡。";
    }
    const personaMsg = { type: "text", text: personaText.slice(0, 5000) };

    // 組裝（最多 5 則）
    const out = [first];
    if (wants.single)  out.push(singleMsg);
    if (wants.combo)   out.push(comboMsg);
    if (wants.persona) out.push(personaMsg);

    await pushMessage(userId, out);
    return res.status(200).json({ ok: true });

  } catch (err) {
    // 不讓 500 回到 LINE；回 200 並記 log
    console.error("[submit-oca] Fatal:", err);
    try {
      const b = (req && req.body) ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';
      console.error("[submit-oca] Body snapshot:", b);
    } catch(_) {}
    return res.status(200).json({ ok: false, msg: "server error" });
  }
};
