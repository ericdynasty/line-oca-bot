// api/line-webhook.js
// 自動歡迎 + 逐步聊天填表 + 診斷指令（我的ID / 推我 / 分析測試 / 健康檢查）+ reply→push 備援

const crypto = require("crypto");

// ===== 環境變數 =====
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://line-oca-bot.vercel.app");

// ===== Reply→Push 備援 =====
const tokenToUser = new Map(); // replyToken -> userId

async function pushMessage(userId, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: userId, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("Push API error:", resp.status, t);
  }
}

async function replyMessage(replyToken, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  });

  if (resp.ok) return true;

  const txt = await resp.text().catch(() => "");
  console.error("Reply API error:", resp.status, txt);

  // 失效就用 push 補送
  if (resp.status === 400 && /Invalid reply token/i.test(txt)) {
    const userId = tokenToUser.get(replyToken);
    if (userId) await pushMessage(userId, messages);
  }
  return false;
}

// ===== 簽章驗證 =====
function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
  return hmac === headerSignature;
}

// ====== 簡易聊天流程（與你現有的一樣：姓名→性別→年齡→日期→躁狂B/E→A~J→想看什麼→送出） ======
const sessions = new Map();
const LETTERS = ["A","B","C","D","E","F","G","H","I","J"];
const NAME_MAP = {A:"A點",B:"B點",C:"C點",D:"D點",E:"E點",F:"F點",G:"G點",H:"H點",I:"I點",J:"J點"};

function askScorePrompt(L){ return `請輸入${NAME_MAP[L]}（-100～100）的分數。`; }
const isYes = t => /^(有|yes|y|是)$/i.test(t);
const isNo  = t => /^(無|no|n|否)$/i.test(t);
function parseScore(s){ const n=Number(String(s).trim()); return (Number.isFinite(n)&&n>=-100&&n<=100)?Math.round(n):null; }
function todayStr(){ const d=new Date(); const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}`; }

async function beginFlow(userId, replyToken){
  sessions.set(userId, { step:"name", idx:0, data:{ scores:{}, maniaB:false, maniaE:false }});
  const welcome = "您好，我是Eric的OCA助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。\n請輸入填表人姓名：";
  await replyMessage(replyToken, { type:"text", text: welcome });
}

async function submitToApi(payload){
  const url = `${BASE_URL}/api/submit-oca`;
  const resp = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text().catch(()=> "");
  return { ok: resp.ok, status: resp.status, text };
}

// ===== 診斷指令 =====
async function handleDiagnostics(ev, text){
  const userId = ev.source?.userId;
  if (!userId) return false;

  // 1) 我的ID
  if (/^(我的id|id)$/i.test(text)) {
    await replyMessage(ev.replyToken, { type:"text", text:`你的 userId：\n${userId}` });
    return true;
  }

  // 2) 推我（用 Push API 測 token & 好友狀態）
  if (/^推我$/i.test(text)) {
    await replyMessage(ev.replyToken, { type:"text", text:"已送出 push 測試，若你沒收到，代表 token 或好友狀態有問題。" });
    await pushMessage(userId, { type:"text", text:"Push 測試成功（看得到就代表 token OK、且你是機器人好友）。" });
    return true;
  }

  // 3) 分析測試（幫你送一筆標準 payload 到 /api/submit-oca）
  if (/^分析測試$/i.test(text)) {
    await replyMessage(ev.replyToken, { type:"text", text:"分析處理中…" });
    const payload = {
      userId,
      name: "測試",
      gender: "其他",
      age: 20,
      date: todayStr(),
      maniaB: false,
      maniaE: false,
      scores: { A: 10, B: 30, C: -20, D: 5, E: 40, F: -10, G: 0, H: 15, I: -25, J: 5 },
      wants: { single:true, combo:true, persona:true }
    };
    const r = await submitToApi(payload);
    if (r.ok) {
      await replyMessage(ev.replyToken, { type:"text", text:"分析測試：已送出 ✅，請查看剛剛的推播訊息（最多 3 則）。" });
    } else {
      await replyMessage(ev.replyToken, { type:"text", text:`分析測試：送出失敗（${r.status}）\n${(r.text||"").slice(0,200)}` });
    }
    return true;
  }

  // 4) 健康檢查（顯示目前偵測到的設定）
  if (/^(健康檢查|health)$/i.test(text)) {
    const lines = [
      "【健康檢查】",
      `BASE_URL：${BASE_URL}`,
      `有設 LINE_CHANNEL_ACCESS_TOKEN：${CHANNEL_ACCESS_TOKEN ? "是" : "否"}`,
      `有設 LINE_CHANNEL_SECRET：${CHANNEL_SECRET ? "是" : "否"}`,
      "建議：若「推我」沒收到訊息，多半是 token 或好友狀態。"
    ];
    await replyMessage(ev.replyToken, { type:"text", text: lines.join("\n") });
    return true;
  }

  return false;
}

// ===== 主要處理：聊天流程 & 指令 =====
async function handleChat(ev, text){
  const userId = ev.source?.userId;
  if (!userId) return;

  // 診斷指令先處理
  const handled = await handleDiagnostics(ev, text);
  if (handled) return;

  // 聊天填表流程
  let s = sessions.get(userId);
  if (!s) {
    await beginFlow(userId, ev.replyToken);
    return;
  }
  const D = s.data;

  if (/^取消$/i.test(text)) {
    sessions.delete(userId);
    await replyMessage(ev.replyToken, { type:"text", text:"已取消，輸入任何文字可重新開始。" });
    return;
  }

  switch (s.step) {
    case "name": {
      const name = text.trim();
      if (!name) { await replyMessage(ev.replyToken, {type:"text", text:"姓名不可空白，請輸入姓名："}); return; }
      D.name = name; s.step="gender";
      await replyMessage(ev.replyToken, { type:"text", text:"性別請選：男 / 女 / 其他（直接輸入其一）" });
      return;
    }
    case "gender": {
      if (!/(男|女|其他)/.test(text)) { await replyMessage(ev.replyToken, {type:"text", text:"請輸入：男 / 女 / 其他"}); return; }
      D.gender = text.trim(); s.step="age";
      await replyMessage(ev.replyToken, { type:"text", text:"年齡（必填，需 ≥14）" });
      return;
    }
    case "age": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 14) { await replyMessage(ev.replyToken, {type:"text", text:"年齡需為整數且 ≥14，請重新輸入："}); return; }
      D.age = n; s.step="date";
      await replyMessage(ev.replyToken, { type:"text", text:"日期（YYYY/MM/DD），或輸入「今天」" });
      return;
    }
    case "date": {
      const t = text.trim();
      D.date = /^今天$/.test(t) ? todayStr() : t;
      s.step="maniaB";
      await replyMessage(ev.replyToken, { type:"text", text:"躁狂（B 情緒）是否出現？請輸入「有」或「無」" });
      return;
    }
    case "maniaB": {
      if (!(isYes(text)||isNo(text))) { await replyMessage(ev.replyToken, {type:"text", text:"請輸入「有」或「無」"}); return; }
      D.maniaB = isYes(text); s.step="maniaE";
      await replyMessage(ev.replyToken, { type:"text", text:"躁狂（E 支援）是否出現？請輸入「有」或「無」" });
      return;
    }
    case "maniaE": {
      if (!(isYes(text)||isNo(text))) { await replyMessage(ev.replyToken, {type:"text", text:"請輸入「有」或「無」"}); return; }
      D.maniaE = isYes(text); s.step="score_A";
      await replyMessage(ev.replyToken, { type:"text", text: askScorePrompt("A") });
      return;
    }
    default: {
      if (s.step.startsWith("score_")) {
        const L = s.step.split("_")[1];
        const v = parseScore(text);
        if (v === null) { await replyMessage(ev.replyToken, {type:"text", text:`分數需為 -100～100 的整數，請重新輸入${NAME_MAP[L]}：`}); return; }
        D.scores[L] = v;
        const idx = LETTERS.indexOf(L);
        if (idx < LETTERS.length - 1) {
          const nextL = LETTERS[idx+1];
          s.step = `score_${nextL}`;
          await replyMessage(ev.replyToken, { type:"text", text: askScorePrompt(nextL) });
          return;
        }
        // A~J 完成 → 直接送出（精簡：預設全開）
        await replyMessage(ev.replyToken, { type:"text", text:"分析處理中，請稍候…" });
        const payload = {
          userId,
          name: D.name, gender: D.gender, age: D.age, date: D.date,
          maniaB: D.maniaB, maniaE: D.maniaE,
          scores: D.scores,
          wants: { single:true, combo:true, persona:true }
        };
        const r = await submitToApi(payload);
        if (r.ok) {
          await replyMessage(ev.replyToken, { type:"text", text:"分析已送出 ✅，請查看推播結果（最多 3 則）。" });
        } else {
          await replyMessage(ev.replyToken, { type:"text", text:`分析送出失敗（${r.status}）\n${(r.text||"").slice(0,200)}` });
        }
        sessions.delete(userId);
        return;
      }
      // 其他未知狀態 → 重新開始
      await beginFlow(userId, ev.replyToken);
    }
  }
}

// ===== 入口 =====
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const sig = req.headers["x-line-signature"];
    if (!verifySignature(sig, rawBody)) return res.status(403).send("Bad signature");

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      // 建立 replyToken → userId 對應（回覆失效時做 push 備援）
      if (ev.replyToken && ev.source?.userId) tokenToUser.set(ev.replyToken, ev.source.userId);

      if (ev.type === "follow" && ev.source?.userId) {
        await beginFlow(ev.source.userId, ev.replyToken);
        continue;
      }

      if (ev.type === "message" && ev.message?.type === "text" && ev.source?.userId) {
        const text = (ev.message.text || "").trim();
        await handleChat(ev, text);
      }
    }
    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server Error");
  }
};
