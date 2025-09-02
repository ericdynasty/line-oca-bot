// api/line-webhook.js
// 自動歡迎 + 逐步聊天填表（含 B/E 躁狂）+ 簽章驗證 + 送 submit-oca

const crypto = require("crypto");

// 環境變數
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://line-oca-bot.vercel.app";

// ------- 簡易 session（以 userId 暫存） -------
const sessions = new Map();

// ------- LINE Reply -------
async function replyMessage(replyToken, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("Reply API error:", resp.status, t);
  }
}

// ------- 簽章驗證 -------
function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
  return hmac === headerSignature;
}

// ------- 啟動流程（歡迎詞） -------
async function beginFlow(userId, replyToken) {
  sessions.set(userId, {
    step: "name",
    data: {
      scores: {},
      maniaB: false,
      maniaE: false,
    },
  });

  const welcome =
    "您好，我是Eric的OCA助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。\n" +
    "請輸入填表人姓名：";

  await replyMessage(replyToken, { type: "text", text: welcome });
}

// ------- 驗證工具 -------
const isYes = (t) => /^(有|yes|y)$/i.test(t);
const isNo  = (t) => /^(無|no|n)$/i.test(t);

function parseScore(s) {
  const n = Number(String(s).trim());
  if (!Number.isFinite(n)) return null;
  if (n < -100 || n > 100) return null;
  return Math.round(n);
}

// ------- 送交分析 API（submit-oca） -------
async function submitToApi(payload) {
  const url = `${BASE_URL}/api/submit-oca`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`submit-oca error ${resp.status}: ${t}`);
  }
  return resp.json().catch(() => ({}));
}

// ------- 問答流程 -------
const LETTERS = ["A","B","C","D","E","F","G","H","I","J"];
const NAME_MAP = {
  A:"A點", B:"B點", C:"C點", D:"D點", E:"E點",
  F:"F點", G:"G點", H:"H點", I:"I點", J:"J點"
};

function askScorePrompt(L) {
  return `請輸入${L}（-100～100）的分數。`
    .replace(`${L}`, `${NAME_MAP[L]}`);
}

async function handleText(userId, replyToken, text) {
  const s = sessions.get(userId);

  // 隨時可取消
  if (/^取消$/i.test(text)) {
    sessions.delete(userId);
    await replyMessage(replyToken, { type: "text", text: "已取消，隨時輸入任何文字即可重新開始填寫。" });
    return;
  }

  // 沒有 session 就自動開始（不必輸入「填表」）
  if (!s) {
    await beginFlow(userId, replyToken);
    return;
  }

  const D = s.data;

  switch (s.step) {
    case "name": {
      const name = text.trim();
      if (!name) {
        await replyMessage(replyToken, { type: "text", text: "姓名不可空白，請輸入填表人姓名：" });
        return;
      }
      D.name = name;
      s.step = "gender";
      await replyMessage(replyToken, { type: "text", text: "性別請選：男 / 女 / 其他（直接輸入其一）" });
      break;
    }

    case "gender": {
      const g = text.trim();
      if (!g) {
        await replyMessage(replyToken, { type: "text", text: "請輸入：男 / 女 / 其他" });
        return;
      }
      D.gender = g;
      s.step = "age";
      await replyMessage(replyToken, { type: "text", text: "年齡（必填，需 ≥14）" });
      break;
    }

    case "age": {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 14) {
        await replyMessage(replyToken, { type: "text", text: "年齡需為數字且 ≥14，請重新輸入：" });
        return;
      }
      D.age = n;
      s.step = "date";
      await replyMessage(replyToken, { type: "text", text: "日期（YYYY/MM/DD），或輸入「今天」" });
      break;
    }

    case "date": {
      const t = text.trim();
      D.date = /^今天$/.test(t)
        ? new Date().toISOString().slice(0,10).replace(/-/g,"/")
        : t;
      s.step = "maniaB";
      await replyMessage(replyToken, { type: "text", text: "躁狂（B 情緒）是否出現？請輸入「有」或「無」" });
      break;
    }

    case "maniaB": {
      const t = text.trim();
      if (!isYes(t) && !isNo(t)) {
        await replyMessage(replyToken, { type: "text", text: "請輸入「有」或「無」" });
        return;
      }
      D.maniaB = isYes(t);
      s.step = "maniaE";
      await replyMessage(replyToken, { type: "text", text: "躁狂（E 支援）是否出現？請輸入「有」或「無」" });
      break;
    }

    case "maniaE": {
      const t = text.trim();
      if (!isYes(t) && !isNo(t)) {
        await replyMessage(replyToken, { type: "text", text: "請輸入「有」或「無」" });
        return;
      }
      D.maniaE = isYes(t);
      s.step = "score_A";
      await replyMessage(replyToken, { type: "text", text: askScorePrompt("A") });
      break;
    }

    // A~J 逐點
    default: {
      // 分數步驟名稱如 score_A、score_B...
      if (s.step.startsWith("score_")) {
        const L = s.step.split("_")[1]; // A..J
        const val = parseScore(text);
        if (val === null) {
          await replyMessage(replyToken, { type: "text", text: `分數需為 -100～100 的整數，請重新輸入${NAME_MAP[L]}：` });
          return;
        }
        D.scores[L] = val;

        // 下一個
        const idx = LETTERS.indexOf(L);
        if (idx < LETTERS.length - 1) {
          const nextL = LETTERS[idx + 1];
          s.step = `score_${nextL}`;
          await replyMessage(replyToken, { type: "text", text: askScorePrompt(nextL) });
          return;
        }

        // 問觀看內容
        s.step = "wants";
        await replyMessage(replyToken, {
          type: "text",
          text:
            "想看的內容（可擇一—或最後選「全部」）：\n" +
            "• 單點（輸入：單點）\n" +
            "• 綜合（輸入：綜合）\n" +
            "• 側寫（輸入：側寫）\n" +
            "• 全部（輸入：全部）",
        });
        return;
      }

      if (s.step === "wants") {
        const want = text.trim();
        const wants = {
          single: /單點|全部/.test(want),
          combo:  /綜合|全部/.test(want),
          persona:/側寫|全部/.test(want),
        };
        if (!wants.single && !wants.combo && !wants.persona) {
          await replyMessage(replyToken, { type: "text", text: "請輸入：單點 / 綜合 / 側寫 / 全部" });
          return;
        }

        // 送交分析
        await replyMessage(replyToken, { type: "text", text: "分析處理中，請稍候..." });

        try {
          await submitToApi({
            userId,
            name: D.name,
            gender: D.gender,
            age: D.age,
            date: D.date,
            mania: D.maniaB || D.maniaE, // 綜合旗標仍保留
            maniaB: D.maniaB,
            maniaE: D.maniaE,
            scores: D.scores,
            wants,
          });
        } catch (e) {
          console.error(e);
          await replyMessage(replyToken, { type: "text", text: "分析送出失敗，請稍後再試或改用「填表」。" });
        }

        sessions.delete(userId);
        return;
      }

      // 其他未知狀態，重啟
      await beginFlow(userId, replyToken);
    }
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const sig = req.headers["x-line-signature"];
    if (!verifySignature(sig, rawBody)) return res.status(403).send("Bad signature");

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      const userId = ev.source?.userId;

      // 1) 使用者把官方帳號加入好友時，主動送出歡迎詞（不用輸入任何字）
      if (ev.type === "follow" && userId) {
        await beginFlow(userId, ev.replyToken);
        continue;
      }

      // 2) 一般訊息：若沒有 session 也自動開始
      if (ev.type === "message" && ev.message?.type === "text" && userId) {
        const txt = (ev.message.text || "").trim();

        // 保留指令：手動開始 or LIFF 模式
        if (/^填表|聊天填表$/i.test(txt)) {
          await beginFlow(userId, ev.replyToken);
          continue;
        }

        await handleText(userId, ev.replyToken, txt);
        continue;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server Error");
  }
};
