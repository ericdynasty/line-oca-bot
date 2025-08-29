// api/submit-oca.js
// 支援：A) LIFF 表單（replyToken 回覆）  B) 聊天式填寫（push 到 userId/lineUserId）
// 內建極簡規則，不讀外部 JSON

const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 自我",
  B: "B 情緒",
  C: "C 任務",
  D: "D 關係",
  E: "E 支援",
  F: "F 壓力",
  G: "G 目標",
  H: "H 執行",
  I: "I 自律",
  J: "J 活力",
};

function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    // 允許 top-level 或 scores 物件都有 A~J
    const raw = input?.[L];
    const v = Number(raw);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// 分數→等級+提示（極簡、示意）
function bandDesc(n) {
  if (n >= 41) return ["高(重)", "偏強勢、驅動力大"];
  if (n >= 11) return ["高(輕)", "略偏高、傾向較明顯"];
  if (n <= -41) return ["低(重)", "不足感明顯、需特別留意"];
  if (n <= -11) return ["低(輕)", "略偏低、偶爾受影響"];
  return ["中性", "較平衡、影響小"];
}

// 挑出絕對值最大的 k 個
function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

// --- LINE 發訊工具 ---
async function replyMessage(replyToken, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!resp.ok) {
    console.error("Reply API error:", resp.status, await resp.text().catch(() => ""));
  }
}

async function pushMessage(to, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!resp.ok) {
    console.error("Push API error:", resp.status, await resp.text().catch(() => ""));
  }
}

// 產出要回的訊息（陣列）
function buildMessages({ name, gender, age, date, mania, scores, wants }) {
  const singleLines = [];
  for (const L of LETTERS) {
    const n = scores[L];
    const [lvl, hint] = bandDesc(n);
    singleLines.push(`${NAMES[L]}：${n}（${lvl}）— ${hint}`);
  }

  const tops = topLetters(scores, 3);
  const topText = tops
    .map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`)
    .join("、");

  const combined =
    `【綜合重點】\n最需要留意／最有影響的面向：${topText || "無特別突出"}。\n` +
    `躁狂傾向：${mania ? "有" : "無"}；日期：${date || "未填"}。`;

  let persona = "【人物側寫】\n";
  if (tops.length >= 2) {
    const [L1, v1] = tops[0];
    const [L2, v2] = tops[1];
    const dir1 = v1 >= 0 ? "偏高" : "偏低";
    const dir2 = v2 >= 0 ? "偏高" : "偏低";
    persona += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${dir1 === "偏高" ? "主動" : "保守"}、${dir2 === "偏高" ? "外放" : "內斂"}」傾向（示意）。`;
  } else {
    persona += "整體表現較均衡。";
  }

  const wantSingle = wants?.single ?? true;
  // 容錯：combo / summary 任一為 true 就出綜合
  const wantCombined = (wants?.combo ?? wants?.summary ?? true);
  const wantPersona = wants?.persona ?? true;

  const replyChunks = [];
  replyChunks.push({
    type: "text",
    text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）`,
  });

  if (wantSingle) {
    const txt = "【A~J 單點】\n" + singleLines.join("\n");
    replyChunks.push({ type: "text", text: txt.slice(0, 5000) });
  }
  if (wantCombined) {
    replyChunks.push({ type: "text", text: combined.slice(0, 5000) });
  }
  if (wantPersona) {
    replyChunks.push({ type: "text", text: persona.slice(0, 5000) });
  }
  return replyChunks;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // 兼容：有些平台可能傳字串
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // 目的地：LIFF 會帶 replyToken；聊天式帶 userId / lineUserId
    const replyToken = body.replyToken || null;
    const toUserId = body.userId || body.lineUserId || null;
    if (!replyToken && !toUserId) {
      return res.status(400).json({ ok: false, msg: "缺少 replyToken 或 userId/lineUserId" });
    }

    // 基本欄位
    const name   = body.name || "";
    const gender = body.gender || "";
    const ageNum = Number(body.age);
    const date   = body.date || "";
    const mania  = body.mania === true || body.mania === "true" || body.mania === 1 || body.mania === "1";

    if (!Number.isFinite(ageNum) || ageNum < 14) {
      return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });
    }

    // 分數來源：body.scores 或 top-level 的 A~J
    const scores = normalizeScores(body.scores && typeof body.scores === 'object' ? body.scores : body);

    const wants = body.wants && typeof body.wants === 'object' ? body.wants : undefined;

    const messages = buildMessages({
      name, gender, age: ageNum, date, mania, scores, wants
    });

    if (replyToken) {
      await replyMessage(replyToken, messages);
    } else {
      await pushMessage(toUserId, messages);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
