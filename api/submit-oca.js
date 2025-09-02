// api/submit-oca.js
// 教材版：分區門檻 & A1~J4 句庫（口語化精簡），含躁狂與少量「症狀群」示意規則

const LETTERS = "ABCDEFGHIJ".split("");

// 你目前用的點名（依你最新截圖）
const NAMES = {
  A: "穩定",
  B: "價值",
  C: "變化",
  D: "果敢",
  E: "活躍",
  F: "樂觀",
  G: "責任",
  H: "評估力",
  I: "欣賞能力",
  J: "滿意能力",
};

// —— 教材分區門檻（四區） ——
// 1: +70~+100, 2: +20~+69, 3: -39~+19, 4: -100~-40
function scoreToBlock(n) {
  if (n >= 70) return 1;
  if (n >= 20) return 2;
  if (n >= -39) return 3;
  return 4;
}

const BLOCK_TAG = {1: "高(重)", 2: "高(輕)", 3: "中性", 4: "低(輕/重)"};

// —— 教材句庫（口語化精簡）——
// 說明保持教材重點，不照抄長句，以易讀短句呈現；括號標示(A1..J4)便於對照教材卡。
const TEXT = {
  A: {
    1: "專注穩、判斷好、主見明。(A1)",
    2: "大致穩，偶被情緒影響。(A2)",
    3: "注意力易散、決定不穩。(A3)",
    4: "不穩、難專注，易受情緒牽動。(A4)"
  },
  B: {
    1: "樂觀真誠、情緒明亮。(B1)",
    2: "整體心情偏正向。(B2)",
    3: "易受影響、心情起伏。(B3)",
    4: "不滿足、興趣感降低。(B4)"
  },
  C: {
    1: "靈活變通、能切換。(C1)",
    2: "大致能調整變化。(C2)",
    3: "適應力一般、偶卡住。(C3)",
    4: "緊張僵硬、難調整。(C4)"
  },
  D: {
    1: "果斷勇於承擔。(D1)",
    2: "多能面對、敢處理。(D2)",
    3: "面對一般、偶猶豫。(D3)",
    4: "逃避迴避、難面對。(D4)"
  },
  E: {
    1: "行動多且有效率。(E1)",
    2: "活躍偏高、動能夠。(E2)",
    3: "動能一般、偶失序。(E3)",
    4: "活力低、推不動。(E4)"
  },
  F: {
    1: "積極正向、信心穩。(F1)",
    2: "多半看好、有動力。(F2)",
    3: "較悲觀、動力易掉。(F3)",
    4: "負面感強、需提振。(F4)"
  },
  G: {
    1: "主動承擔、領導感。(G1)",
    2: "大致負責、願意扛。(G2)",
    3: "責任感一般。(G3)",
    4: "推責閃避、掌控弱。(G4)"
  },
  H: {
    1: "看事準、能公平衡量。(H1)",
    2: "多能評估，偶偏見。(H2)",
    3: "評估不穩、易受情緒。(H3)",
    4: "偏頗主觀、難客觀。(H4)"
  },
  I: {
    1: "欣賞力強、善肯定。(I1)",
    2: "多能欣賞、給資源。(I2)",
    3: "容易挑剔、少肯定。(I3)",
    4: "批判強、難包容。(I4)"
  },
  J: {
    1: "社交流暢、商務溝通佳。(J1)",
    2: "可溝通，但偶離群。(J2)",
    3: "離群感明顯、溝通受阻。(J3)",
    4: "嚴重離群、社交障礙。(J4)"
  }
};

// 躁狂（教材：僅 B、E 可能標示）
const MANIA = {
  B: "（B 躁狂）情緒過度高亢、誇大與失真，笑點偏怪、判斷易失準。",
  E: "（E 躁狂）動能過強、衝動忙亂，行動超出可負荷與能力範圍。"
};

// —— 少量「症狀群」示意規則（可再擴充）——
function groupHints(scores) {
  const s = scores;
  const hi = x => s[x] >= 20;     // 粗略「偏高」判斷（教材強調相對高低，這裡簡化）
  const lo = x => s[x] <= -11;    // 粗略「偏低」判斷

  const out = [];

  // A、B、C 低 -> 神經過敏/陷在失落（教材：症狀群C）
  if (lo('A') && lo('B') && lo('C')) {
    out.push("A、B、C 偏低：容易神經緊繃、陷在過往失落（示意，自教材症狀群C）。");
  }
  // A 高、H 低 → 完美主義（教材：症狀群C 範例）
  if (hi('A') && lo('H')) {
    out.push("A 高 + H 低：完美主義傾向，標準高、對人事要求嚴（示意）。");
  }
  // B 高、D 低 → 有躁狂困擾（教材：症狀群C 範例）
  if (hi('B') && lo('D')) {
    out.push("B 高 + D 低：可能有躁狂困擾（會傻笑），行為表現與實際不符（示意）。");
  }
  return out;
}

// —— 工具函式 —— 
function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    const v = Number(input?.[L]);
    out[L] = Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0;
  }
  return out;
}

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

// —— 主流程（供 /api/form 與「聊天填表」共同送來）——
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const {
      userId, name, gender, age, date,
      maniaB, maniaE,                // 讓前端在 B/E 勾選「躁狂」時填 true
      scores: rawScores,
      wants                           // {single:true, combo:true, persona:true} 可選
    } = req.body || {};

    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });

    const scores = normalizeScores(rawScores);

    // —— 單點輸出（每點中間空一行，易讀）——
    const singleLines = [];
    for (const L of LETTERS) {
      const val = scores[L];
      const blk = scoreToBlock(val);
      const tag = BLOCK_TAG[blk];
      const txt = TEXT[L][blk] || "";
      singleLines.push(`${L} ${NAMES[L]}：${val}｜${tag}\n${txt}`);
    }

    // —— 綜合重點：列出影響最大的 3 點 + 躁狂 + 日期 —— 
    const tops = topLetters(scores, 3);
    const topText = tops.map(([L, v]) => `${L}${NAMES[L]}：${v}`).join("、");
    const maniaMsgs = [];
    if (maniaB) maniaMsgs.push(MANIA.B);
    if (maniaE) maniaMsgs.push(MANIA.E);

    const comboHints = groupHints(scores);
    const combined =
      `【綜合重點】\n最需要留意／最有影響的面向：${topText || "無特別突出"}` +
      `${maniaMsgs.length ? `。\n${maniaMsgs.join("；")}` : "。"}` +
      `${comboHints.length ? `\n關聯觀察：\n- ${comboHints.join("\n- ")}` : ""}` +
      `\n日期：${date || "未填"}`;

    // —— 人物側寫（示意：取前兩名做方向詞）——
    let persona = "【人物側寫】\n";
    if (tops.length >= 2) {
      const [L1, v1] = tops[0];
      const [L2, v2] = tops[1];
      const d1 = v1 >= 20 ? "高" : (v1 <= -11 ? "低" : "中");
      const d2 = v2 >= 20 ? "高" : (v2 <= -11 ? "低" : "中");
      persona += `${L1}${NAMES[L1]}偏${d1}、${L2}${NAMES[L2]}偏${d2}；整體呈現「方案/標準與行動風格」上的可見傾向（示意）。`;
    } else {
      persona += "整體較均衡。";
    }

    // —— 依需求拼裝訊息 —— 
    const bubbles = [];
    bubbles.push({ type: "text", text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）` });

    if (!wants || wants.single) {
      const txt = "【A~J 單點】\n" + singleLines.join("\n\n");
      bubbles.push({ type: "text", text: txt.slice(0, 5000) });
    }
    if (!wants || wants.combo) {
      bubbles.push({ type: "text", text: combined.slice(0, 5000) });
    }
    if (!wants || wants.persona) {
      bubbles.push({ type: "text", text: persona.slice(0, 5000) });
    }

    await pushMessage(userId, bubbles);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
