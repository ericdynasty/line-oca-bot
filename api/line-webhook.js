// api/line-webhook.js  (ESM; Node 18+/22 on Vercel)
import crypto from "node:crypto";

// ---------- 基本設定 ----------
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const BASE =
  (process.env.PUBLIC_BASE_URL || "https://line-oca-bot.vercel.app").replace(
    /\/+$/,
    ""
  );

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.warn(
    "[line-webhook] Missing env: LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN"
  );
}

// ---------- 小工具 ----------
async function replyText(replyToken, text) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = {
    replyToken,
    messages: [{ type: "text", text: String(text).slice(0, 5000) }],
  };
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

async function replyMessages(replyToken, messages) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = { replyToken, messages };
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

async function pushText(userId, text) {
  const url = "https://api.line.me/v2/bot/message/push";
  const body = {
    to: userId,
    messages: [{ type: "text", text: String(text).slice(0, 5000) }],
  };
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

function signIsValid(body, signature) {
  const hmac = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return hmac === signature;
}

const AJ_LABELS = {
  A: "穩定性",
  B: "愉快",
  C: "鎮定",
  D: "確定力",
  E: "活躍",
  F: "積極",
  G: "負責",
  H: "評估能力",
  I: "欣賞能力",
  J: "溝通能力",
};
const AJ_KEYS = Object.keys(AJ_LABELS); // ["A","B",...,"J"]

// 伺服器記憶體暫存（serverless 可能重啟遺失，但和你現有行為一致）
const FLOW = new Map(); // userId -> state

function startState() {
  return {
    step: "name", // name -> gender -> age -> maniaB -> maniaE -> A..J -> want -> done
    name: "",
    gender: "", // 男 / 女 / 其他
    age: 0,
    maniaB: null, // true/false
    maniaE: null, // true/false
    scores: {}, // {A: n, ... J: n}
    want: 4, // 1~4
  };
}

function parseIntStrict(s) {
  if (typeof s !== "string") return NaN;
  if (!/^-?\d+$/.test(s.trim())) return NaN;
  return parseInt(s.trim(), 10);
}

function qr(items) {
  // 快速回覆
  return {
    items: items.map(([label, text]) => ({
      type: "action",
      action: { type: "message", label, text },
    })),
  };
}

// ---------- 呼叫正式分析 API ----------
async function callAnalyzeAndReply(lineReplyToken, userId, payload) {
  try {
    const resp = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      await replyText(
        lineReplyToken,
        `分析失敗，請稍後再試。\n(${resp.status}) ${t.slice(0, 200)}`
      );
      return;
    }
    const data = await resp.json().catch(() => ({}));

    // 期待：{ ok:true, messages:[ "段落1", "段落2", ... ] }
    let msgs = [];
    if (Array.isArray(data.messages)) {
      msgs = data.messages.filter(Boolean).map((t) => ({
        type: "text",
        text: String(t).slice(0, 5000),
      }));
    } else {
      const guess = data.result || data.text || JSON.stringify(data);
      msgs = [{ type: "text", text: String(guess).slice(0, 5000) }];
    }

    // LINE reply 一次最多 5 則
    const first = msgs.slice(0, 5);
    if (first.length) {
      await replyMessages(lineReplyToken, first);
    } else {
      await replyText(lineReplyToken, "（沒有可顯示的內容）");
    }
    const remain = msgs.slice(5);
    for (const m of remain) {
      await pushText(userId, m.text);
    }
  } catch (err) {
    await replyText(
      lineReplyToken,
      `分析發生錯誤：${err?.message || String(err)}`
    );
  }
}

// ---------- 主處理 ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // 簽章驗證
  const rawBody = await req.arrayBuffer();
  const bodyText = Buffer.from(rawBody).toString("utf8");
  const okSig = signIsValid(bodyText, req.headers["x-line-signature"]);
  if (!okSig) {
    return res.status(401).send("Bad signature");
  }

  const body = JSON.parse(bodyText);
  const events = Array.isArray(body.events) ? body.events : [];

  for (const evt of events) {
    if (evt.type !== "message" || evt.message?.type !== "text") continue;

    const userId = evt.source?.userId;
    const text = (evt.message.text || "").trim();
    const replyToken = evt.replyToken;

    // 指令
    if (["取消", "重新開始"].includes(text)) {
      FLOW.delete(userId);
      await replyText(replyToken, "已取消/重新開始。輸入「填表」可再次開始。");
      continue;
    }
    if (text === "填表") {
      const s = startState();
      FLOW.set(userId, s);
      // 歡迎詞分兩則
      await replyMessages(replyToken, [
        { type: "text", text: "您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。" },
        {
          type: "text",
          text: "請輸入填表人姓名：",
          quickReply: qr([["取消", "取消"], ["重新開始", "重新開始"]]),
        },
      ]);
      continue;
    }

    // 流程
    const state = FLOW.get(userId) || null;
    if (!state) {
      // 非流程狀態，提示如何開始
      await replyText(replyToken, '輸入「填表」即可開始。');
      continue;
    }

    // === name ===
    if (state.step === "name") {
      state.name = text.slice(0, 50);
      state.step = "gender";
      await replyMessages(replyToken, [
        {
          type: "text",
          text: "性別請選擇（或輸入 1/2/3）：\n1. 男\n2. 女\n3. 其他",
          quickReply: qr([["1", "1"], ["2", "2"], ["3", "3"]]),
        },
      ]);
      continue;
    }

    // === gender ===
    if (state.step === "gender") {
      let g = text;
      if (text === "1") g = "男";
      else if (text === "2") g = "女";
      else if (text === "3") g = "其他";

      if (!["男", "女", "其他"].includes(g)) {
        await replyText(
          replyToken,
          "請輸入 1（男）/ 2（女）/ 3（其他）。"
        );
        continue;
      }
      state.gender = g;
      state.step = "age";
      await replyText(replyToken, "請輸入年齡（整數；例如 25）：");
      continue;
    }

    // === age ===
    if (state.step === "age") {
      const n = parseIntStrict(text);
      if (!Number.isFinite(n) || n <= 0 || n > 120) {
        await replyText(replyToken, "年齡格式不正確，請輸入 1~120 的整數。");
        continue;
      }
      state.age = n;
      state.step = "maniaB";
      await replyMessages(replyToken, [
        {
          type: "text",
          text: "躁狂（B 愉快）是否偏高？\n1. 有\n2. 無",
          quickReply: qr([["1", "1"], ["2", "2"]]),
        },
      ]);
      continue;
    }

    // === maniaB ===
    if (state.step === "maniaB") {
      if (!["1", "2"].includes(text)) {
        await replyText(replyToken, "請輸入 1（有）或 2（無）。");
        continue;
      }
      state.maniaB = text === "1";
      state.step = "maniaE";
      await replyMessages(replyToken, [
        {
          type: "text",
          text: "躁狂（E 點）是否偏高？\n1. 有\n2. 無",
          quickReply: qr([["1", "1"], ["2", "2"]]),
        },
      ]);
      continue;
    }

    // === maniaE ===
    if (state.step === "maniaE") {
      if (!["1", "2"].includes(text)) {
        await replyText(replyToken, "請輸入 1（有）或 2（無）。");
        continue;
      }
      state.maniaE = text === "1";
      state.step = "score_A";
      await replyText(
        replyToken,
        `請輸入 A（${AJ_LABELS.A}）分數（-100 ~ 100）：`
      );
      continue;
    }

    // === A~J 分數 ===
    if (state.step?.startsWith("score_")) {
      const key = state.step.split("_")[1]; // "A".."J"
      const n = parseIntStrict(text);
      if (!Number.isFinite(n) || n < -100 || n > 100) {
        await replyText(replyToken, "格式不對，請輸入 -100 ~ 100 的整數。");
        continue;
      }
      state.scores[key] = n;

      const idx = AJ_KEYS.indexOf(key);
      const nextIdx = idx + 1;
      if (nextIdx < AJ_KEYS.length) {
        const nextKey = AJ_KEYS[nextIdx];
        state.step = `score_${nextKey}`;
        await replyText(
          replyToken,
          `請輸入 ${nextKey}（${AJ_LABELS[nextKey]}）分數（-100 ~ 100）：`
        );
        continue;
      }

      // J 完成
      state.step = "want";
      await replyMessages(replyToken, [
        {
          type: "text",
          text:
            "想看的內容（請選 1~4；4 = 全部）：\n" +
            "1. A~J 單點\n2. 綜合重點\n3. 人物側寫\n4. 全部\n\n請輸入您想要的選項（1~4）。",
          quickReply: qr([
            ["1", "1"],
            ["2", "2"],
            ["3", "3"],
            ["4", "4"],
          ]),
        },
      ]);
      continue;
    }

    // === want ===
    if (state.step === "want") {
      const v = parseIntStrict(text);
      if (![1, 2, 3, 4].includes(v)) {
        await replyText(replyToken, "請輸入 1、2、3 或 4。");
        continue;
      }
      state.want = v;
      state.step = "done";

      // 整理 payload 丟 /api/analyze
      const payload = {
        name: state.name,
        gender: state.gender,
        age: state.age,
        mania: { B: !!state.maniaB, E: !!state.maniaE },
        scores: state.scores, // {A..J}
        view: state.want, // 1~4
      };

      await replyText(replyToken, "分析處理中，請稍候...");
      await callAnalyzeAndReply(replyToken, userId, payload);

      // 清掉流程
      FLOW.delete(userId);
      continue;
    }

    // 其他狀態 fallback
    await replyText(replyToken, "請依指示輸入或輸入「取消」「重新開始」。");
  }

  return res.status(200).json({ ok: true });
}
