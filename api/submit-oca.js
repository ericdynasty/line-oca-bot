// api/submit-oca.js
// v2: 虛線分隔 + 教材句庫(可自行貼入) + fetch polyfill + 全面防呆

// ---- fetch polyfill (for Node 16/older) ----
const fetchFn = (...args) =>
  (typeof fetch === 'function'
    ? fetch(...args)
    : import('node-fetch').then(m => m.default(...args)));

// ---- 基本常數 ----
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

// 你可以把教材的 A1~J4 句子直接貼到下面這個物件：
// 對應表：A1→vlow，A2→low，A3→mid，A4→high，A5→vhigh（B~J 同理）
// 下面僅示範少量占位文字，請用教材內容覆蓋。
// 例：PHRASE_BOOK.A.vlow = "（教材 A1 句子）";
const PHRASE_BOOK = {
  A: {
    vlow: "（教材 A1）偏低且影響重，需特別留意。",
    low : "（教材 A2）略偏低，偶有受影響。",
    mid : "（教材 A3）中性，較平衡。",
    high: "（教材 A4）略偏高，傾向較明顯。",
    vhigh:"（教材 A5）偏高且影響重，驅動力大。"
  },
  B: {
    vlow: "（教材 B1）",
    low : "（教材 B2）",
    mid : "（教材 B3）",
    high: "（教材 B4）",
    vhigh:"（教材 B5）"
  },
  C: { vlow:"（教材 C1）", low:"（教材 C2）", mid:"（教材 C3）", high:"（教材 C4）", vhigh:"（教材 C5）" },
  D: { vlow:"（教材 D1）", low:"（教材 D2）", mid:"（教材 D3）", high:"（教材 D4）", vhigh:"（教材 D5）" },
  E: { vlow:"（教材 E1）", low:"（教材 E2）", mid:"（教材 E3）", high:"（教材 E4）", vhigh:"（教材 E5）" },
  F: { vlow:"（教材 F1）", low:"（教材 F2）", mid:"（教材 F3）", high:"（教材 F4）", vhigh:"（教材 F5）" },
  G: { vlow:"（教材 G1）", low:"（教材 G2）", mid:"（教材 G3）", high:"（教材 G4）", vhigh:"（教材 G5）" },
  H: { vlow:"（教材 H1）", low:"（教材 H2）", mid:"（教材 H3）", high:"（教材 H4）", vhigh:"（教材 H5）" },
  I: { vlow:"（教材 I1）", low:"（教材 I2）", mid:"（教材 I3）", high:"（教材 I4）", vhigh:"（教材 I5）" },
  J: { vlow:"（教材 J1）", low:"（教材 J2）", mid:"（教材 J3）", high:"（教材 J4）", vhigh:"（教材 J5）" },
};

// ---- 小工具 ----
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

// 等級名稱（供顯示）
function bandName(n) {
  const v = num(n, 0);
  if (v >= 41)  return "高(重)";
  if (v >= 11)  return "高(輕)";
  if (v <= -41) return "低(重)";
  if (v <= -11) return "低(輕)";
  return "中性";
}

// 等級 key（查教材句庫）
function bandKey(n) {
  const v = num(n, 0);
  if (v >= 41)  return "vhigh";
  if (v >= 11)  return "high";
  if (v <= -41) return "vlow";
  if (v <= -11) return "low";
  return "mid";
}

// 若教材未填，退回簡易描述
function fallbackHint(n) {
  const v = num(n, 0);
  if (v >= 41)  return "偏強勢、驅動力大";
  if (v >= 11)  return "略偏高、傾向較明顯";
  if (v <= -41) return "不足感明顯、需特別留意";
  if (v <= -11) return "略偏低、偶爾受影響";
  return "較平衡、影響小";
}

// 取教材句子
function phraseFromBook(letter, n) {
  try {
    const book = PHRASE_BOOK[letter];
    const key = bandKey(n);
    const s = book && book[key];
    if (s && typeof s === "string" && s.trim()) return s.trim();
  } catch (_) {}
  // 沒填教材 → 使用 fallback
  return fallbackHint(n);
}

// ---- LINE push ----
async function pushMessage(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) {
    console.error("[submit-oca] Missing LINE_CHANNEL_ACCESS_TOKEN");
    return; // 不 throw
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

    const maniaB = !!body.maniaB; // 躁狂(B)
    const maniaE = !!body.maniaE; // 躁狂(E)
    const scores = normalizeScores(body.scores || {});
    const wants = Object.assign(
      { single: true, combo: true, persona: true },
      body.wants || {}
    );

    if (!userId) {
      console.error("[submit-oca] Missing userId in body");
      return res.status(200).json({ ok: false, msg: "missing userId" });
    }
    if (age < 14) {
      await pushMessage(userId, [
        { type: "text", text: "年齡需 ≥ 14 才能進行分析，請再確認年齡喔。" }
      ]);
      return res.status(200).json({ ok: false, msg: "age < 14" });
    }

    // ---- 訊息組裝 ----
    const hello = {
      type: "text",
      text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）`
    };

    // 虛線樣式（可自行調整長度/符號）
    const DASH = " ───── ";

    // A~J 單點（分數 ───── 等級 ───── 教材句子）
    const singleText =
      "【A~J 單點】\n" +
      LETTERS.map(L => {
        const v   = scores[L];
        const lvl = bandName(v);
        const txt = phraseFromBook(L, v); // << 用教材
        return `${NAMES[L]}：${v}${DASH}${lvl}${DASH}${txt}`;
      }).join("\n");

    const singleMsg = { type: "text", text: singleText.slice(0, 5000) };

    // 綜合（維持既有邏輯）
    const tops = Object.entries(scores)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3);
    const topText = tops
      .map(([L, v]) => `${NAMES[L]}：${v}（${bandName(v)}）`)
      .join("、");

    const comboMsg = {
      type: "text",
      text:
        `【綜合重點】\n最需要留意/最有影響的面向：${topText || "無特別突出"}。\n` +
        `躁狂（B 情緒）：${maniaB ? "有" : "無"}；躁狂（E 點）：${maniaE ? "有" : "無"}；日期：${date || "未填"}。`
        .slice(0, 5000)
    };

    // 人物側寫（簡版，如果你有教材側寫也可改成句庫）
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

    const out = [hello];
    if (wants.single)  out.push(singleMsg);
    if (wants.combo)   out.push(comboMsg);
    if (wants.persona) out.push(personaMsg);

    await pushMessage(userId, out);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("[submit-oca] Fatal:", err);
    try {
      const b = (req && req.body) ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';
      console.error("[submit-oca] Body snapshot:", b);
    } catch(_) {}
    return res.status(200).json({ ok: false, msg: "server error" });
  }
};
