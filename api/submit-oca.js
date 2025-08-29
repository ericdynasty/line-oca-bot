// api/submit-oca.js
// 不讀外部 JSON；內建極簡規則 + 推播回覆
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
    const v = Number(input?.[L]);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// 依分數回傳「帶方向的等級」與簡短文字（極簡版，不代表教材正式句庫）
function bandDesc(n) {
  if (n >= 41) return ["高(重)", "偏強勢、驅動力大"];
  if (n >= 11) return ["高(輕)", "略偏高、傾向較明顯"];
  if (n <= -41) return ["低(重)", "不足感明顯、需特別留意"];
  if (n <= -11) return ["低(輕)", "略偏低、偶爾受影響"];
  return ["中性", "較平衡、影響小"];
}

// 最簡綜合：抓「絕對值」最大的 2~3 點，當成痛點/強項線索
function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
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

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const { userId, name, gender, age, date, mania, scores: raw, wants } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });

    // 分數容錯：沒填一律當 0（若你想嚴格必填，把這段換成檢查）
    const scores = normalizeScores(raw);

    // 產出單點（簡短）
    const singleLines = [];
    for (const L of LETTERS) {
      const n = scores[L];
      const [lvl, hint] = bandDesc(n);
      singleLines.push(`${NAMES[L]}：${n}（${lvl}）— ${hint}`);
    }

    // 簡易綜合與痛點：列出前三個絕對值大者
    const tops = topLetters(scores, 3);
    const topText = tops
      .map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`)
      .join("、");

    const combined =
      `【綜合重點】\n最需要留意／最有影響的面向：${topText || "無特別突出"}。\n` +
      `躁狂傾向：${mania ? "有" : "無"}；日期：${date || "未填"}。`;

    // 超簡人物側寫：用前兩名做口語化描述（僅示意）
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

    // 組裝回覆內容（避免過長，切成多段）
    const replyChunks = [];
    replyChunks.push({ type: "text", text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）` });

    if (!wants || wants.single) {
      const txt = "【A~J 單點】\n" + singleLines.join("\n");
      replyChunks.push({ type: "text", text: txt.slice(0, 5000) });
    }
    if (!wants || wants.combo) {
      replyChunks.push({ type: "text", text: combined.slice(0, 5000) });
    }
    if (!wants || wants.persona) {
      replyChunks.push({ type: "text", text: persona.slice(0, 5000) });
    }

    // 推播給使用者
    await pushMessage(userId, replyChunks);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
