// api/line-webhook.js
// ESM 版本，保證回 200，不讓 LINE 顯示 500。含完整對話流程。

import { Client } from "@line/bot-sdk";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

// ---- 簡易 session（記憶體）----
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: "idle",
      data: {
        name: "",
        gender: "", // 男/女/其他
        age: "",
        scores: { A:null,B:null,C:null,D:null,E:null,F:null,G:null,H:null,I:null,J:null },
        maniaB: null, // 1 有 / 2 無
        maniaE: null, // 1 有 / 2 無
      },
      lastMsgTs: 0,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.delete(userId);
}

// ---- 共用 UI ----
function qr(items) {
  return {
    items: items.map(([label, text]) => ({
      type: "action",
      action: { type: "message", label, text },
    })),
  };
}

function askWelcome() {
  return [
    { type: "text", text: "您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。" },
    {
      type: "text",
      text: "請輸入填表人姓名：",
      quickReply: qr([["取消","取消"],["重新開始","重新開始"]]),
    },
  ];
}

function askGender() {
  return {
    type: "text",
    text: "性別請選擇（或輸入 1/2/3）：\n1. 男\n2. 女\n3. 其他",
    quickReply: qr([["1","1"],["2","2"],["3","3"],["取消","取消"]]),
  };
}

function askAge() {
  return {
    type: "text",
    text: "請輸入年齡（整數，例：22）：",
    quickReply: qr([["取消","取消"],["重新開始","重新開始"]]),
  };
}

function askScore(letter) {
  const nameMap = {
    A:"穩定性", B:"愉快", C:"鎮定", D:"確定力", E:"活躍",
    F:"積極", G:"負責", H:"評估能力", I:"欣賞能力", J:"溝通能力"
  };
  return {
    type: "text",
    text: `請輸入 ${letter}（${nameMap[letter]}）分數（-100～100）：`,
    quickReply: qr([["取消","取消"],["重新開始","重新開始"]]),
  };
}

function askMania(which) {
  const label = which === "B" ? "躁狂（B 情緒）" : "躁狂（E 點）";
  return {
    type: "text",
    text: `${label} 是否偏高？\n1. 有\n2. 無`,
    quickReply: qr([["1","1"],["2","2"],["取消","取消"],["重新開始","重新開始"]]),
  };
}

function askReportMenu() {
  return {
    type: "text",
    text: "想看的內容（請選 1～4；4＝全部）：\n1. A～J 單點\n2. 綜合重點\n3. 人物側寫\n4. 全部\n\n請輸入您想要的選項（1～4）。",
    quickReply: qr([["1","1"],["2","2"],["3","3"],["4","4"]]),
  };
}

// ---- 流程控制 ----
const scoreOrder = ["A","B","C","D","E","F","G","H","I","J"];

function nextUnfilled(scores) {
  for (const k of scoreOrder) if (scores[k] === null) return k;
  return null;
}

function isInt(n) {
  return Number.isInteger(n);
}
function toIntSafe(s) {
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

// ---- 主處理 ----
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(200).send("OK");
      return;
    }

    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [];

    const baseURL = `https://${req.headers.host}`;

    await Promise.all(
      events.map(async (ev) => {
        try {
          if (ev.type !== "message" || ev.message.type !== "text") return;
          const userId = ev.source?.userId || "anon";
          const text = (ev.message.text || "").trim();
          const ses = getSession(userId);

          // 防抖：同一毫秒/重送忽略（LINE 可能重送）
          const ts = ev.timestamp || Date.now();
          if (ts === ses.lastMsgTs) return;
          ses.lastMsgTs = ts;

          // 通用指令
          if (text === "取消") {
            resetSession(userId);
            await client.replyMessage(ev.replyToken, {
              type: "text",
              text: "已取消。若要重新開始，請輸入「填表」。",
              quickReply: qr([["填表","填表"]]),
            });
            return;
          }
          if (text === "重新開始") {
            sessions.set(userId, getSession(userId)); // 確保存在
            const s = getSession(userId);
            s.step = "askName";
            s.data = {
              name: "",
              gender: "",
              age: "",
              scores: { A:null,B:null,C:null,D:null,E:null,F:null,G:null,H:null,I:null,J:null },
              maniaB: null,
              maniaE: null,
            };
            await client.replyMessage(ev.replyToken, askWelcome());
            return;
          }
          if (text === "填表") {
            const s = getSession(userId);
            s.step = "askName";
            s.data = {
              name: "",
              gender: "",
              age: "",
              scores: { A:null,B:null,C:null,D:null,E:null,F:null,G:null,H:null,I:null,J:null },
              maniaB: null,
              maniaE: null,
            };
            await client.replyMessage(ev.replyToken, askWelcome());
            return;
          }

          // 對話狀態機
          switch (ses.step) {
            case "idle": {
              // 非流程訊息，給個提示
              await client.replyMessage(ev.replyToken, {
                type: "text",
                text: "在這裡可輸入「填表」開始填資料，或輸入「重新開始 / 取消」。",
                quickReply: qr([["填表","填表"],["重新開始","重新開始"],["取消","取消"]]),
              });
              break;
            }

            case "askName": {
              if (!text) {
                await client.replyMessage(ev.replyToken, {
                  type:"text",
                  text:"請輸入姓名（不可為空）。",
                });
                return;
              }
              ses.data.name = text;
              ses.step = "askGender";
              await client.replyMessage(ev.replyToken, askGender());
              return;
            }

            case "askGender": {
              let g = "";
              if (text === "1" || text === "男") g = "男";
              else if (text === "2" || text === "女") g = "女";
              else if (text === "3" || text === "其他") g = "其他";
              if (!g) {
                await client.replyMessage(ev.replyToken, askGender());
                return;
              }
              ses.data.gender = g;
              ses.step = "askAge";
              await client.replyMessage(ev.replyToken, askAge());
              return;
            }

            case "askAge": {
              const n = toIntSafe(text);
              if (!isInt(n) || n < 1 || n > 120) {
                await client.replyMessage(ev.replyToken, {
                  type:"text",
                  text:"年齡格式不正確，請輸入 1~120 的整數。",
                });
                return;
              }
              ses.data.age = n;
              ses.step = "askScores";
              const first = nextUnfilled(ses.data.scores);
              await client.replyMessage(ev.replyToken, askScore(first));
              return;
            }

            case "askScores": {
              const k = nextUnfilled(ses.data.scores);
              if (!k) {
                // 都填完了
                ses.step = "askManiaB";
                await client.replyMessage(ev.replyToken, askMania("B"));
                return;
              }
              const n = toIntSafe(text);
              if (!isInt(n) || n < -100 || n > 100) {
                await client.replyMessage(ev.replyToken, {
                  type:"text",
                  text:"分數格式不正確，請輸入 -100～100 的整數。",
                });
                return;
              }
              ses.data.scores[k] = n;
              const nextK = nextUnfilled(ses.data.scores);
              if (nextK) {
                await client.replyMessage(ev.replyToken, askScore(nextK));
              } else {
                ses.step = "askManiaB";
                await client.replyMessage(ev.replyToken, askMania("B"));
              }
              return;
            }

            case "askManiaB": {
              if (text !== "1" && text !== "2") {
                await client.replyMessage(ev.replyToken, askMania("B"));
                return;
              }
              ses.data.maniaB = Number(text);
              ses.step = "askManiaE";
              await client.replyMessage(ev.replyToken, askMania("E"));
              return;
            }

            case "askManiaE": {
              if (text !== "1" && text !== "2") {
                await client.replyMessage(ev.replyToken, askMania("E"));
                return;
              }
              ses.data.maniaE = Number(text);
              ses.step = "askReport";
              await client.replyMessage(ev.replyToken, askReportMenu());
              return;
            }

            case "askReport": {
              if (!["1","2","3","4"].includes(text)) {
                await client.replyMessage(ev.replyToken, askReportMenu());
                return;
              }

              // 呼叫 /api/analyze 產生報告
              const payload = {
                name: ses.data.name,
                gender: ses.data.gender,
                age: ses.data.age,
                scores: ses.data.scores,
                maniaB: ses.data.maniaB,
                maniaE: ses.data.maniaE,
                want: Number(text), // 1~4
              };

              // 回覆「分析中」
              await client.replyMessage(ev.replyToken, { type:"text", text:"分析處理中，請稍候..." });

              try {
                const r = await fetch(`${baseURL}/api/analyze`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload),
                });
                const data = await r.json().catch(() => ({}));

                if (Array.isArray(data?.messages) && data.messages.length > 0) {
                  // /api/analyze 若直接回 Line 訊息陣列
                  await client.pushMessage(userId, data.messages);
                } else if (typeof data?.text === "string") {
                  await client.pushMessage(userId, { type:"text", text: data.text });
                } else {
                  await client.pushMessage(userId, { type:"text", text:"分析完成，但沒有可顯示的內容（請檢查 /api/analyze 回傳）。" });
                }
              } catch (e) {
                console.error("analyze error:", e);
                await client.pushMessage(userId, { type:"text", text:"分析時發生錯誤，稍後再試或輸入「重新開始」。" });
              }

              // 結束本次流程
              resetSession(userId);
              return;
            }

            default: {
              // 非預期狀態，重置
              resetSession(userId);
              await client.replyMessage(ev.replyToken, {
                type:"text",
                text:"看起來流程不一致，已幫您重置。請輸入「填表」重新開始。",
                quickReply: qr([["填表","填表"]]),
              });
            }
          }
        } catch (innerErr) {
          console.error("handleEvent error:", innerErr);
          // 即使單筆出錯，也不要影響整體回 200
        }
      })
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook fatal:", err);
    // 永遠回 200，避免 LINE 看到 500
    res.status(200).json({ ok: false });
  }
}
