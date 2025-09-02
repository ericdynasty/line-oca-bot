// api/submit-oca.js
// 使用教材句庫（api/bank.js）+ 單點直線分隔輸出 + 推播

const BANK = require('./bank');      // ← 教材句庫在這
const LETTERS = "ABCDEFGHIJ".split("");

// 名稱對應教材用語
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

// 依分數判層級
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

function pickLine(L, score) {
  const band = bandOf(score);
  const arr = BANK[L]?.[band.key] || [];
  // 取第一句；想要隨機可改：arr[Math.floor(Math.random()*arr.length)]
  const text = arr[0] || "（教材句庫待補）";
  return { label: band.label, text };
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

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { userId, name, gender, age, date, maniaB, maniaE, scores: raw, wants } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });

    const scores = normalizeScores(raw);

    // ===== 單點：直線分隔（名稱｜分數｜層級｜教材短評） =====
    const lines = [];
    for (const L of LETTERS) {
      const n = scores[L];
      const { label, text } = pickLine(L, n);
      lines.push(`${NAMES[L]}｜${n}｜${label}｜${text}`);
    }
    const singleText = "【A～J 單點】\n" + lines.join("\n");

    // ===== 綜合重點：前三影響 + 躁狂 =====
    const tops = topLetters(scores, 3);
    const topText = tops.map(([L, v]) => `${NAMES[L]}：${v}（${bandOf(v).label}）`).join("、");
    const combo =
      `【綜合重點】\n` +
      `最需留意／最有影響的面向：${topText || "無明顯突出"}。\n` +
      `躁狂（B 情緒）：${maniaB ? "有" : "無"}；躁狂（E 點）：${maniaE ? "有" : "無"}。\n` +
      `日 期：${date || "未填"}。`;

    // ===== 人物側寫（可之後也換教材段落） =====
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
