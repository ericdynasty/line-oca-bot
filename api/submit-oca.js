// api/submit-oca.js  — 極簡輸出版（最多 3 則）
const rules = require('./oca_rules.json');

const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 穩定",  B: "B 情緒",  C: "C 鎮定",  D: "D 確定力",  E: "E 活躍",
  F: "F 積極",  G: "G 責任",  H: "H 評估",  I: "I 同理",  J: "J 溝通"
};

// 分區（教材）
function blockOf(n) {
  if (n >= 70) return 1;
  if (n >= 20) return 2;
  if (n >= -39) return 3;
  return 4;
}

// 只取第一子句，保留原意但精簡
function firstClause(txt = "") {
  const m = String(txt).split(/[，。；]/)[0] || "";
  return m.trim();
}

function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    const v = Number(input?.[L]);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function topByAbs(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

// 症狀群（教材精選，最多 3 條）
function linesGroups(scores) {
  const out = [];
  const b = k => blockOf(scores[k]);
  // 症狀群 B（常見）
  if (b('A') === 1 && [3,4].includes(b('C')))
    out.push("A1×C3/4：外表想穩定但內在緊張。");
  if (b('B') === 1 && [3,4].includes(b('C')))
    out.push("B1×C3/4：快樂不穩、易被擾動。");
  if (b('E') === 1 && [3,4].includes(b('F')))
    out.push("E1×F3/4：想做很多但在人前退縮。");
  if (b('F') === 1 && [3,4].includes(b('G')))
    out.push("F1×G3/4：能幹但不負責，易引風險。");
  if (b('H') === 1 && [3,4].includes(b('I')))
    out.push("H1×I3/4：表面公平、心裡挑剔。");

  // 症狀群 C（相對模式）
  if ([scores.A,scores.B,scores.C].every(v => [3,4].includes(blockOf(v))) &&
      [scores.A,scores.B,scores.C].some(v => blockOf(v)===4)) {
    out.push("A/B/C 低：神經過敏、注意力易被拉走。");
  }
  if (blockOf(scores.A)===4 && [1,2].includes(blockOf(scores.E)))
    out.push("A 低＋E 高：活躍但缺中心，易瞎忙。");
  if ([1,2].includes(blockOf(scores.B)) && [3,4].includes(blockOf(scores.D)))
    out.push("B 高＋D 低：躁狂傾向，確定力不足。");
  if ([1,2].includes(blockOf(scores.I)) && [3,4].includes(blockOf(scores.J)))
    out.push("I 高＋J 低：討好型，對外過度敏感。");

  // 症狀群 D（相對高低）
  if (scores.C === Math.max(...Object.values(scores)))
    out.push("C 相對高：自我克制偏多。");
  if (scores.E > scores.F)
    out.push("E > F：常把自己推進超出能力的事。");
  if (scores.F > scores.E)
    out.push("F > E：能力在手，但未真正用出來。");

  return out.slice(0, 3);  // 最多 3 條，精簡
}

// 推播（僅 1 批，因為我們只送 3 則）
async function push(to, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(()=> "");
    console.error("Push API error:", resp.status, t);
  }
}

// 單點列表（每行內用直線分隔；每行之間細分隔線）
function buildSingleBlock(scores, maniaB, maniaE) {
  const rows = [];
  for (const L of LETTERS) {
    const n = scores[L];
    const blk = blockOf(n);
    if (L === 'B' && maniaB && rules?.mania?.B) {
      rows.push(`${NAMES[L]}｜${n}｜B* ─ ${firstClause(rules.mania.B)}`);
    } else if (L === 'E' && maniaE && rules?.mania?.E) {
      rows.push(`${NAMES[L]}｜${n}｜E* ─ ${firstClause(rules.mania.E)}`);
    } else {
      const txt = rules?.single?.[L]?.[String(blk)] || "";
      rows.push(`${NAMES[L]}｜${n}｜${L}${blk} ─ ${firstClause(txt)}`);
    }
  }
  return "【A~J 單點】\n" + rows.map(s => `――――――――――――――――\n${s}`).join("\n");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN)
      return res.status(500).json({ ok:false, msg:"缺少 LINE_CHANNEL_ACCESS_TOKEN" });

    const {
      userId, name, gender, age, date,
      scores: raw,
      maniaB = false, maniaE = false
    } = req.body || {};

    if (!userId || !/^U[0-9a-f]{32}$/i.test(userId))
      return res.status(400).json({ ok:false, msg:"userId 不正確" });
    if (!age || Number(age) < 14)
      return res.status(400).json({ ok:false, msg:"年齡需 ≥ 14" });

    const scores = normalizeScores(raw);

    // (1) 標頭
    const header = {
      type: "text",
      text: `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）`
    };

    // (2) A~J 單點（精簡第一子句 + 直線分隔）
    const singleText = buildSingleBlock(scores, !!maniaB, !!maniaE);
    const singleMsg = { type: "text", text: singleText.slice(0, 4900) };

    // (3) 綜合重點 + 人物側寫（都精簡）
    const tops = topByAbs(scores, 3)
      .map(([L, v]) => `${NAMES[L]}：${v}（${L}${blockOf(v)}）`)
      .join("、");

    const groups = linesGroups(scores).join("／") || "（無）";

    const t2 = topByAbs(scores, 2);
    const dir = n => (n >= 0 ? "偏高" : "偏低");
    const persona =
      t2.length >= 2
        ? `${NAMES[t2[0][0]]}${dir(t2[0][1])}、${NAMES[t2[1][0]]}${dir(t2[1][1])}；整體「${dir(t2[0][1])==="偏高"?"主動":"保守"}・${dir(t2[1][1])==="偏高"?"外放":"內斂"}」傾向。`
        : `整體較均衡。`;

    const comboMsg = {
      type: "text",
      text:
        `【綜合重點】\n重點面向：${tops || "無特別突出"}。\n` +
        `症狀群：${groups}\n` +
        `躁狂（B）：${maniaB ? "有" : "無"}；躁狂（E）：${maniaE ? "有" : "無"}；日期：${date || "未填"}。\n\n` +
        `【人物側寫】\n${persona}`
    };

    // 最多 3 則
    await push(userId, [header, singleMsg, comboMsg]);

    // 回應表單/聊天端
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
