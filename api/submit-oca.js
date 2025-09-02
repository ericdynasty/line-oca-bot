// api/submit-oca.js
// 將分數與基本資料送進來，推播完整分析給使用者。
// 依教材：單點 A~J（可讀性排版）＋「症狀群 A~D」關聯解讀（由 _oca_rules.js 規則引擎產出）＋人物側寫。
// 需要環境變數：LINE_CHANNEL_ACCESS_TOKEN

// ---------- 文字標籤（依你目前使用的中文欄位） ----------
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

// ---------- 規則引擎（症狀群 A~D） ----------
const { applyOcaRules } = require("./_oca_rules");

// ---------- Node18 在 Vercel 已有 fetch，如在本地舊環境需 polyfill ----------
const fetchFn =
  typeof fetch === "function"
    ? fetch
    : (...args) => import("node-fetch").then((m) => m.default(...args));

// ---------- 工具 ----------
function normalizeScores(input) {
  const out = {};
  for (const L of LETTERS) {
    const raw = input?.[L];
    const v = Number(raw);
    out[L] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// 回傳「帶方向的等級」與極簡提示（單點顯示用：與教材語意一致但口語化精簡）
function bandDesc(n) {
  if (n >= 41) return ["高(重)", "偏強勢、驅動大"];
  if (n >= 11) return ["高(輕)", "略偏高、傾向明顯"];
  if (n <= -41) return ["低(重)", "不足明顯、需留意"];
  if (n <= -11) return ["低(輕)", "略偏低、偶爾受影響"];
  return ["中性", "較平衡、影響小"];
}

// 取絕對值最大的 K 點（用在「綜合重點」）
function topLetters(scores, k = 3) {
  return Object.entries(scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
}

async function pushMessage(to, messages) {
  const resp = await fetchFn("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!resp.ok) {
    console.error("Push API error:", resp.status, await resp.text().catch(() => ""));
  }
}

// 解析 wants：支援 {single, combo, persona}、或陣列 ['single','combo']、或數字 [1,2]、或 'all'
function parseWants(wants) {
  if (!wants) return { single: true, combo: true, persona: true };
  if (wants === "all") return { single: true, combo: true, persona: true };

  // 物件布林
  if (typeof wants === "object" && !Array.isArray(wants)) {
    const s = !!wants.single, c = !!wants.combo, p = !!wants.persona;
    return { single: s || (!c && !p), combo: c || (!s && !p), persona: p || (!s && !c) };
  }

  // 陣列或字串
  const set = new Set(
    (Array.isArray(wants) ? wants : [wants]).map((x) =>
      String(x).toLowerCase().trim()
    )
  );
  const flag = {
    single: set.has("1") || set.has("single") || set.has("a~j") || set.has("a-j"),
    combo: set.has("2") || set.has("combo") || set.has("綜合"),
    persona: set.has("3") || set.has("persona") || set.has("側寫"),
  };
  if (!flag.single && !flag.combo && !flag.persona) return { single: true, combo: true, persona: true };
  return flag;
}

// 安全切訊息
function chunkText(str, limit = 4900) {
  const out = [];
  let s = String(str || "");
  while (s.length > limit) {
    out.push(s.slice(0, limit));
    s = s.slice(limit);
  }
  out.push(s);
  return out;
}

// ---------- HTTP Handler ----------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
      return res.status(500).json({ ok: false, msg: "Server config error" });
    }

    // 支援 raw 或 JSON
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    // 參數
    const userId = body.userId || body.to;
    const name = (body.name || "").trim();
    const gender = body.gender || body.sex || "";
    const ageNum = Number(body.age);
    const date = body.date || body.when || "";
    const maniaB = !!body.maniaB; // 躁狂：B 情緒
    const maniaE = !!body.maniaE; // 躁狂：E 點
    const wants = parseWants(body.wants);
    const rawScores = body.scores || body; // 允許直接傳 A~J 在根層

    if (!userId) return res.status(400).json({ ok: false, msg: "缺少 userId" });
    if (!Number.isFinite(ageNum) || ageNum < 14) {
      return res.status(400).json({ ok: false, msg: "年齡需 ≥ 14" });
    }

    const scores = normalizeScores(rawScores);

    // --------- (一) A~J 單點（排版：每點間空一行） ---------
    const singleLines = [];
    for (const L of LETTERS) {
      const n = scores[L];
      const [lvl, hint] = bandDesc(n);
      // 兩行：主行＋輔行，中間留空行會由 join("\n\n") 產生
      const main = `${NAMES[L]}：${n} ｜ ${lvl}`;
      const sub = `— ${hint}`;
      singleLines.push(`${main}\n${sub}`);
    }
    const singleText = `【A~J 單點】\n` + singleLines.join(`\n\n`);

    // --------- (二) 綜合重點（含教材式「症狀群」關聯解讀） ---------
    const tops = topLetters(scores, 3);
    const topText = tops
      .map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`)
      .join("、");

    const maniaMsgs = [];
    if (maniaB) maniaMsgs.push("躁狂（B 情緒）：有");
    else maniaMsgs.push("躁狂（B 情緒）：無");
    if (maniaE) maniaMsgs.push("躁狂（E 點）：有");
    else maniaMsgs.push("躁狂（E 點）：無");

    // 命中規則（症狀群 A~D）
    const ruleHits = applyOcaRules(scores, { max: 6 }); // 最多 6 條避免過長
    const combined =
      `【綜合重點】\n最需要留意／最有影響的面向：${topText || "無特別突出"}。` +
      `\n${maniaMsgs.join("；")}。` +
      (ruleHits.length ? `\n關聯觀察（教材：症狀群）：\n- ${ruleHits.join("\n- ")}` : "") +
      `\n日期：${date || "未填"}`;

    // --------- (三) 人物側寫（簡短） ---------
    let persona = "【人物側寫】\n";
    if (tops.length >= 2) {
      const [L1, v1] = tops[0];
      const [L2, v2] = tops[1];
      const dir1 = v1 >= 0 ? "偏高" : "偏低";
      const dir2 = v2 >= 0 ? "偏高" : "偏低";
      persona += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${
        dir1 === "偏高" ? "主動" : "保守"
      }、${dir2 === "偏高" ? "外放" : "內敛"}」傾向（示意）。`;
    } else {
      persona += "整體表現較均衡。";
    }

    // --------- 推播（自動切段避免 5000 字限制） ---------
    const chunks = [];

    // 開頭問候
    const hello = `Hi ${name || ""}！已收到你的 OCA 分數。\n（年齡：${ageNum}，性別：${gender || "未填"}）`;
    chunks.push(...chunkText(hello));

    if (wants.single) chunks.push(...chunkText(singleText));
    if (wants.combo) chunks.push(...chunkText(combined));
    if (wants.persona) chunks.push(...chunkText(persona));

    // 組成 LINE 訊息陣列並送出
    const messages = chunks.map((t) => ({ type: "text", text: t }));
    await pushMessage(userId, messages);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[submit-oca] error:", e);
    return res.status(500).send("Server Error");
  }
};
