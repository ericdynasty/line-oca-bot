// api/line-webhook.js  (ESM; Node 18+/22 on Vercel)
import crypto from "node:crypto";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const BASE =
  (process.env.PUBLIC_BASE_URL || "https://line-oca-bot.vercel.app").replace(
    /\/+$/,
    ""
  );

async function replyText(replyToken, text) {
  const url = "https://api.line.me/v2/bot/message/reply";
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: String(text).slice(0, 5000) }],
    }),
  });
}
async function replyMessages(replyToken, messages) {
  const url = "https://api.line.me/v2/bot/message/reply";
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}
async function pushText(userId, text) {
  const url = "https://api.line.me/v2/bot/message/push";
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: String(text).slice(0, 5000) }],
    }),
  });
}
function signIsValid(body, signature) {
  const hmac = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return hmac === signature;
}
function qr(items) {
  return {
    items: items.map(([label, text]) => ({
      type: "action",
      action: { type: "message", label, text },
    })),
  };
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
const AJ_KEYS = Object.keys(AJ_LABELS);
const FLOW = new Map();
function startState() {
  return {
    step: "name",
    name: "",
    gender: "",
    age: 0,
    maniaB: null,
    maniaE: null,
    scores: {},
    want: 4,
  };
}
function parseIntStrict(s) {
  if (typeof s !== "string") return NaN;
  if (!/^-?\d+$/.test(s.trim())) return NaN;
  return parseInt(s.trim(), 10);
}

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
    const first = msgs.slice(0, 5);
    if (first.length) {
      await replyMessages(lineReplyToken, first);
    } else {
      await replyText(lineReplyToken, "（沒有可顯示的內容）");
    }
    for (const m of msgs.slice(5)) {
      await pushText(userId, m.text);
    }
  } catch (err) {
    await replyText(
      lineReplyToken,
      `分析發生錯誤：${err?.message || String(err)}`
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // 讀 raw body + 驗簽
  const rawBody = await req.arrayBuffer();
  const bodyText = Buffer.from(rawBody).toString("utf8");
  if (!signIsValid(bodyText, req.headers["x-line-signature"])) {
    return res.status(401).send("Bad signature");
  }

  // ★★★ 重點：LINE 後台「驗證」會送 body='test'，不是 JSON
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // 驗證 ping：直接回 200，讓你能把 Webhook 打開
    return res.status(200).send("OK");
  }

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  for (const evt of events) {
    if (evt.type !== "message" || evt.message?.type !== "text") continue;

    const userId = evt.source?.userId;
    const replyToken = evt.replyToken;
    const text = (evt.message.text || "").trim();

    // 指令
    if (["取消", "重新開始"].includes(text)) {
      FLOW.delete(userId);
      await replyText(replyToken, "已取消/重新開始。輸入「填表」可再次開始。");
      continue;
    }
    if (text === "填表") {
      const s = startState();
      FLOW.set(userId, s);
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

    const state = FLOW.get(userId) || null;
    if (!state) {
      await replyText(replyToken, '輸入「填表」即可開始。');
      continue;
    }

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
    if (state.step === "gender") {
      let g = text;
      if (text === "1") g = "男";
      else if (text === "2") g = "女";
      else if (text === "3") g = "其他";
      if (!["男", "女", "其他"].includes(g)) {
        await replyText(replyToken, "請輸入 1（男）/ 2（女）/ 3（其他）。");
        continue;
      }
      state.gender = g;
      state.step = "age";
      await replyText(replyToken, "請輸入年齡（整數；例如 25）：");
      continue;
    }
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
    if (state.step === "maniaE") {
      if (!["1", "2"].includes(text)) {
        await replyText(replyToken, "請輸入 1（有）或 2（無）。");
        continue;
      }
      state.maniaE = text === "1";
      state.step = "score_A";
      await replyText(replyToken, `請輸入 A（${AJ_LABELS.A}）分數（-100 ~ 100）：`);
      continue;
    }
    if (state.step?.startsWith("score_")) {
      const key = state.step.split("_")[1];
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
    if (state.step === "want") {
      const v = parseIntStrict(text);
      if (![1, 2, 3, 4].includes(v)) {
        await replyText(replyToken, "請輸入 1、2、3 或 4。");
        continue;
      }
      state.want = v;
      state.step = "done";

      const payload = {
        name: state.name,
        gender: state.gender,
        age: state.age,
        mania: { B: !!state.maniaB, E: !!state.maniaE },
        scores: state.scores,
        view: state.want,
      };
      await replyText(replyToken, "分析處理中，請稍候...");
      await callAnalyzeAndReply(replyToken, userId, payload);

      FLOW.delete(userId);
      continue;
    }

    await replyText(replyToken, "請依指示輸入或輸入「取消」「重新開始」。");
  }

  return res.status(200).json({ ok: true });
}
