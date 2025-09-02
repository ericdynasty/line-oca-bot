// api/submit-oca.js
// 依教材分區（1~4）+ 單點句庫 + 躁狂(B/E) +（可選）症狀群片語，並以易讀格式回傳
const rules = require('./oca_rules.json');

const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 穩定",  B: "B 情緒",  C: "C 鎮定",  D: "D 確定力",  E: "E 活躍",
  F: "F 積極",  G: "G 責任",  H: "H 評估",  I: "I 同理",  J: "J 溝通"
};

// 依教材分區：1=高、2=略高、3=中性、4=低（區間見教材）
function blockOf(n) {
  if (n >= 70) return 1;
  if (n >= 20) return 2;
  if (n >= -39) return 3;
  return 4;
}

// 將 body.scores 不存在的點補 0
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

function lineSingle(scores, useManiaB, useManiaE) {
  const lines = [];
  for (const L of LETTERS) {
    const n = scores[L];
    const blk = blockOf(n);
    // 躁狂覆蓋（只有 B/E ）
    if (L === 'B' && useManiaB && rules.mania.B) {
      lines.push(`${NAMES[L]}｜${n}｜B* 躁狂 ── ${rules.mania.B}`);
      continue;
    }
    if (L === 'E' && useManiaE && rules.mania.E) {
      lines.push(`${NAMES[L]}｜${n}｜E* 躁狂 ── ${rules.mania.E}`);
      continue;
    }
    const txt = rules.single[L][String(blk)] || '';
    lines.push(`${NAMES[L]}｜${n}｜${L}${blk} ── ${txt}`);
  }
  return lines;
}

// 依教材步驟：先看高低點，再挑相符的片語（這裡放精選常見的症狀群）
// groupsB 是「相互衝突/兩點組合」；groupsC/D 是教材的相對型描述
function lineGroups(scores) {
  const out = [];

  // ===== 症狀群 B（常見精選）=====
  // A1 + C3/4
  if (blockOf(scores.A) === 1 && [3,4].includes(blockOf(scores.C))) {
    out.push("A1×C3/4：外表想穩定，但緊張與注意力分散在作祟（隱性不穩）。");
  }
  // B1 + C3/4
  if (blockOf(scores.B) === 1 && [3,4].includes(blockOf(scores.C))) {
    out.push("B1×C3/4：緊張降低了實際的愉快感，快樂不穩、容易被擾動。");
  }
  // E1 + F3/4
  if (blockOf(scores.E) === 1 && [3,4].includes(blockOf(scores.F))) {
    out.push("E1×F3/4：很想做、很忙，但在人群前容易退縮或羞怯，超出能力範圍。");
  }
  // F1 + G3/4
  if (blockOf(scores.F) === 1 && [3,4].includes(blockOf(scores.G))) {
    out.push("F1×G3/4：能幹但不負責，易把現況歸咎他人，帶來風險與麻煩。");
  }
  // H1 + I3/4
  if (blockOf(scores.H) === 1 && [3,4].includes(blockOf(scores.I))) {
    out.push("H1×I3/4：表面公平、心裡挑剔；缺乏同理會讓評估失真。");
  }

  // ===== 症狀群 C（相對模式；精選）=====
  // A,B,C 皆低（3~4）→ 神經過敏/陷在過去
  if ([scores.A,scores.B,scores.C].every(v => [3,4].includes(blockOf(v))) &&
      [scores.A,scores.B,scores.C].some(v => blockOf(v)===4)) {
    out.push("A/B/C 低：神經過敏、常被過去的失落拉住注意力。");
  }
  // A 低 + E 高 → 瞎忙
  if (blockOf(scores.A)===4 && [1,2].includes(blockOf(scores.E))) {
    out.push("A 低＋E 高：活躍但缺乏中心，容易瞎忙。");
  }
  // B 高 + D 低 → 躁狂傾向（會傻笑）
  if ([1,2].includes(blockOf(scores.B)) && [3,4].includes(blockOf(scores.D))) {
    out.push("B 高＋D 低：躁狂傾向（快樂外放但確定力不足）。");
  }
  // I 高 + J 低 → 討好型
  if ([1,2].includes(blockOf(scores.I)) && [3,4].includes(blockOf(scores.J))) {
    out.push("I 高＋J 低：討好型，對外在意見過度敏感。");
  }

  // ===== 症狀群 D（相對高低；精選）=====
  // C 相對高 → 嚴格養成的克制
  if (scores.C === Math.max(...Object.values(scores))) {
    out.push("C 相對高：易自我克制（多源自嚴格的成長環境）。");
  }
  // E 比 F 高 → 常做超出舒適/能力範圍
  if (scores.E > scores.F) {
    out.push("E > F：常把自己推進超出舒適與能力的工作。");
  }
  // F 比 E 高 → 未盡全力
  if (scores.F > scores.E) {
    out.push("F > E：手上能力足，但未真正把能量用出來。");
  }

  return out;
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
    console.error("Push API error:", resp.status, await resp.text().catch(()=>""));
  }
}

function chunkStrings(arr, maxLen = 4800) {
  const chunks = [];
  let buf = "";
  for (const line of arr) {
    const add = (buf ? "\n" : "") + line;
    if ((buf + add).length > maxLen) {
      if (buf) chunks.push(buf);
      buf = line;
    } else {
      buf += add;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { userId, name, gender, age, date, scores: raw, wants,
            maniaB = false, maniaE = false } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!age || Number(age) < 14) return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });

    const scores = normalizeScores(raw);

    // ==== 單點 ====
    const singleLines = lineSingle(scores, !!maniaB, !!maniaE);
    // 中間加細分隔線，視覺更好讀
    const singleText = [
      "【A~J 單點】",
      ...singleLines.map(s => "─".repeat(36) + "\n" + s)
    ];

    // ==== 症狀群 ====
    const groupLines = lineGroups(scores);
    const groupText = groupLines.length
      ? ["【症狀群（符合者）】", ...groupLines]
      : [];

    // ==== 綜合重點 ====
    const tops = topByAbs(scores, 3)
      .map(([L, v]) => `${NAMES[L]}：${v}（${L}${blockOf(v)}）`);
    const combo = [
      "【綜合重點】",
      `最有影響的面向：${tops.join("、")}。`,
      `躁狂（B）：${maniaB ? "有" : "無"}；躁狂（E）：${maniaE ? "有" : "無"}；日期：${date || "未填" }。`
    ];

    // ==== 人物側寫（極簡）====
    const [L1, v1] = topByAbs(scores, 2)[0] || [];
    const [L2, v2] = topByAbs(scores, 2)[1] || [];
    const dir = (n)=> (n>=0 ? "偏高" : "偏低");
    const persona = [
      "【人物側寫】",
      (L1 ? `${NAMES[L1]}${dir(v1)}、${NAMES[L2]}${dir(v2)}；整體呈現「${dir(v1)==="偏高"?"主動":"保守"}、${dir(v2)==="偏高"?"外放":"內斂"}」傾向（示意）。` : "整體較均衡。")
    ];

    // ==== 推播 ====
    const packs = [
      `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${age}，性別：${gender || "未填"}）`,
      ...chunkStrings(singleText),
      ...chunkStrings(groupText),
      ...chunkStrings(combo),
      ...chunkStrings(persona),
    ].map(text => ({ type: "text", text }));

    await pushMessage(userId, packs);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
