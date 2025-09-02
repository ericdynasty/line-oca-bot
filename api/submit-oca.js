// api/submit-oca.js
// 使用教材句庫 + 單點直線分隔輸出 + 推播給使用者

const LETTERS = "ABCDEFGHIJ".split("");

// ※ 這裡的名稱對應你的教材（依你最近截圖）：
// A 穩定、B 欣快、C 堅定、D 確定、E 活躍、F 積極、G 責任、H 評估能力、I 欣賞能力、J 溝通能力
const NAMES = {
  A: "A 穩定",
  B: "B 欣快",
  C: "C 堅定",
  D: "D 確定",
  E: "E 活躍",
  F: "F 積極",
  G: "G 責任",
  H: "H 評估能力",
  I: "I 欣賞能力",
  J: "J 溝通能力",
};

/**
 * 教材句庫（示意版）
 * 👉 把你「教材版的 A1~J4 / 高低層級」句子，直接替換到每一個陣列中即可。
 * 五個層級對應：highHeavy / highLight / mid / lowLight / lowHeavy
 * 建議每個層級至少放 2~4 句，系統會挑第一句（或你可改用隨機/輪播）。
 */
const BANK = {
  A: {
    highHeavy: ["穩定度很高，步調強勢，對環境要求一致。"],
    highLight: ["穩定度偏高，做事節奏固定，較不喜臨時變動。"],
    mid:       ["穩定度中性，能依情況調整節奏。"],
    lowLight:  ["穩定度略低，節奏易受外界影響，偶有起伏。"],
    lowHeavy:  ["穩定度不足，節奏不易維持，需特別留意持續性。"],
  },
  B: {
    highHeavy: ["欣快感強，情緒能量高，感染力明顯。"],
    highLight: ["欣快感偏高，情緒外放，互動熱絡。"],
    mid:       ["情緒表現中性，能自我調節。"],
    lowLight:  ["欣快感略低，外顯情緒較克制。"],
    lowHeavy:  ["欣快感不足，容易感受低落，需特別關注情緒穩定。"],
  },
  C: {
    highHeavy: ["堅定度很高，立場強，推進力大。"],
    highLight: ["堅定度偏高，表達清楚，方向明確。"],
    mid:       ["堅定度中性，能兼顧主見與彈性。"],
    lowLight:  ["堅定度略低，易受他人影響。"],
    lowHeavy:  ["堅定度不足，主動性不易維持，需特別留意。"],
  },
  D: {
    highHeavy: ["確定度很高，偏向果斷，行動節奏快。"],
    highLight: ["確定度偏高，決策明確，較少猶豫。"],
    mid:       ["確定度中性，能斟酌情況再決定。"],
    lowLight:  ["確定度略低，容易反覆權衡。"],
    lowHeavy:  ["確定度不足，易遲疑卡住，需要外部明確性。"],
  },
  E: {
    highHeavy: ["活躍度很高，驅動性強，行動擴散快。"],
    highLight: ["活躍度偏高，主動參與，動能穩。"],
    mid:       ["活躍度中性，動靜能拿捏。"],
    lowLight:  ["活躍度略低，啟動較慢。"],
    lowHeavy:  ["活躍度不足，行動意願偏弱，需明確刺激。"],
  },
  F: {
    highHeavy: ["積極度很高，壓力承接多，易把事攬在身上。"],
    highLight: ["積極度偏高，投入感強，願意多承擔。"],
    mid:       ["積極度中性，負荷度尚可。"],
    lowLight:  ["積極度略低，對額外任務慎重。"],
    lowHeavy:  ["積極度不足，負荷意願低，需分工支持。"],
  },
  G: {
    highHeavy: ["責任感很高，承諾強，對目標相當執著。"],
    highLight: ["責任感偏高，重視交付，能自我要求。"],
    mid:       ["責任感中性，能依情境調整。"],
    lowLight:  ["責任感略低，需要外在提醒。"],
    lowHeavy:  ["責任感不足，對承諾與規範敏感度低。"],
  },
  H: {
    highHeavy: ["評估能力很強，分析縝密，但可能放慢節奏。"],
    highLight: ["評估能力偏高，能看見關鍵要素。"],
    mid:       ["評估能力中性，能兼顧判斷與行動。"],
    lowLight:  ["評估能力略低，偏向直覺式決策。"],
    lowHeavy:  ["評估能力不足，易忽略風險，需他人輔助。"],
  },
  I: {
    highHeavy: ["欣賞能力很強，擅長肯定與整合資源。"],
    highLight: ["欣賞能力偏高，看見亮點並促成合作。"],
    mid:       ["欣賞能力中性，能依情況調整互動強度。"],
    lowLight:  ["欣賞能力略低，外顯回饋較少。"],
    lowHeavy:  ["欣賞能力不足，關係資本不易累積，需留意。"],
  },
  J: {
    highHeavy: ["溝通能力很強，表達擴散快，帶動性高。"],
    highLight: ["溝通能力偏高，能清楚傳達重點。"],
    mid:       ["溝通能力中性，依場合調整方式。"],
    lowLight:  ["溝通能力略低，表達較保守。"],
    lowHeavy:  ["溝通能力不足，意見不易被看見，需結構化支援。"],
  },
};

// 依分數取層級與標籤
function bandOf(n) {
  if (n >= 41) return { key: "highHeavy", label: "高(重)" };
  if (n >= 11) return { key: "highLight", label: "高(輕)" };
  if (n <= -41) return { key: "lowHeavy", label: "低(重)" };
  if (n <= -11) return { key: "lowLight", label: "低(輕)" };
  return { key: "mid", label: "中性" };
}

function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    const v = Number(input?.[L]);
    out[L] = Number.isFinite(v) ? Math.round(v) : 0;
  }
  return out;
}

// 取單點句庫
function pickLine(L, score) {
  const band = bandOf(score);
  const arr = BANK[L]?.[band.key] || [];
  const text = arr[0] || "（句庫待補：請把教材內容貼到 BANK 中）";
  return { label: band.label, text };
}

// 取前三大影響（絕對值）
function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

// 推播
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
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { userId, name, gender, age, date, mania, maniaB, maniaE, scores: raw, wants } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });

    const scores = normalizeScores(raw);

    // ==== 單點：直線分隔（名稱｜分數｜等級｜短評） ====
    const singleLines = [];
    for (const L of LETTERS) {
      const n = scores[L];
      const { label, text } = pickLine(L, n);
      // 使用全形直線「｜」分隔，手機上可讀性好
      singleLines.push(`${NAMES[L]}｜${n}｜${label}｜${text}`);
    }
    const singleText = "【A～J 單點】\n" + singleLines.join("\n");

    // ==== 綜合重點：前三影響 + 躁狂狀態 ====
    const tops = topLetters(scores, 3);
    const topText = tops.map(([L, v]) => `${NAMES[L]}：${v}（${bandOf(v).label}）`).join("、");
    const combo =
      `【綜合重點】\n` +
      `最需要留意／最有影響的面向：${topText || "無明顯突出"}。\n` +
      `躁狂（B 情緒）：${maniaB ? "有" : "無"}；躁狂（E 點）：${maniaE ? "有" : "無"}。\n` +
      `日 期：${date || "未填" }。`;

    // ==== 人物側寫（以前二名方向做口語化示意；可換成教材段落） ====
    let persona = "【人物側寫】\n";
    if (tops.length >= 2) {
      const [L1, v1] = tops[0];
      const [L2, v2] = tops[1];
      const dir1 = v1 >= 0 ? "偏高" : "偏低";
      const dir2 = v2 >= 0 ? "偏高" : "偏低";
      // 口語化示意，可再替換為教材固定段落
      persona += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${dir1 === "偏高" ? "主動" : "保守"}、${dir2 === "偏高" ? "外放" : "內斂"}」傾向（示意）。`;
    } else {
      persona += "整體表現較均衡。";
    }

    // ==== 組裝與推播（依勾選 wants） ====
    const chunks = [];
    chunks.push({ type: "text", text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）` });

    const W = wants || { single: true, combo: true, persona: true };
    if (W.single)  chunks.push({ type: "text", text: singleText.slice(0, 5000) });
    if (W.combo)   chunks.push({ type: "text", text: combo.slice(0, 5000) });
    if (W.persona) chunks.push({ type: "text", text: persona.slice(0, 5000) });

    await pushMessage(userId, chunks);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
