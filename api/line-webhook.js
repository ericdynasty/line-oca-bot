// api/line-webhook.js
// 只用聊天逐步填寫；含「姓名」→ 性別 → 年齡(>=14) → 日期 → 躁狂（E點） → A~J 分數 → 想看的內容 → 呼叫 /api/submit-oca
// 並保留簽章驗證與簡單的文字分數 fallback

const crypto = require('crypto');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 自我",
  B: "B 情緒",
  C: "C 任務",
  D: "D 關係",
  E: "E 支援",
  F: "F 壓力",
  G: "G 目標",
  H: "H 執行",
  I: "I 自律",
  J: "J 活力",
};

// --- 簡單的 serverless 記憶體對話狀態（Vercel 可能會重啟，若遇到重啟則請重新輸入「填表」） ---
const SESS = new Map();
// SESS[userId] = { step: 'name' | 'gender' | 'age' | 'date' | 'mania' | 'scores' | 'want',
//                  data: { name, gender, age, date, mania, scores:{A..J}, wants:{single,combo,persona} },
//                  currentIdx: index of LETTERS }

function getTodayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
}

async function replyMessage(replyToken, messages) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ replyToken, messages })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(()=> '');
    console.error('Reply API error:', resp.status, t);
  }
}

function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hmac === headerSignature;
}

// 允許「A:10, B:-20, ...」或「A10 B-20」等快速輸入分數（保留舊體驗）
function seemsScoreText(text) {
  const m = text.match(/[A-Jａ-ｊＡ-Ｊ]\s*[:：]?\s*-?\d+/gi);
  return m && m.length >= 3;
}

// 啟動流程
async function startWizard(userId, replyToken) {
  SESS.set(userId, {
    step: 'name',
    data: { scores: {}, wants: {} },
    currentIdx: 0,
  });
  await replyMessage(replyToken, [{
    type: 'text',
    text: '好的，開始逐步填寫。任何時間可輸入「取消」。\n\n請輸入姓名：'
  }]);
}

// 問性別
async function askGender(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '性別請選：',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '男', text: '男' } },
        { type: 'action', action: { type: 'message', label: '女', text: '女' } },
        { type: 'action', action: { type: 'message', label: '其他', text: '其他' } },
      ]
    }
  }]);
}

// 問年齡
async function askAge(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '年齡（必填，需 ≥14）：'
  }]);
}

// 問日期
async function askDate(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '日期（YYYY/MM/DD），或輸入「今天」。',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '今天', text: '今天' } },
        { type: 'action', action: { type: 'message', label: '略過', text: '略過' } },
      ]
    }
  }]);
}

// 問躁狂（E點）有/無
async function askMania(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '躁狂（E點）是否存在？',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '有', text: '有' } },
        { type: 'action', action: { type: 'message', label: '無', text: '無' } },
      ]
    }
  }]);
}

// 問目前 LETTER 的分數
async function askScore(replyToken, letter) {
  const name = NAMES[letter] || letter;
  await replyMessage(replyToken, [{
    type: 'text',
    text: `請輸入 ${name}（-100 ~ 100）的分數：`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '-50', text: '-50' } },
        { type: 'action', action: { type: 'message', label: '-25', text: '-25' } },
        { type: 'action', action: { type: 'message', label: '0', text: '0' } },
        { type: 'action', action: { type: 'message', label: '+25', text: '25' } },
        { type: 'action', action: { type: 'message', label: '+50', text: '50' } },
      ]
    }
  }]);
}

// 問想看的分析內容
async function askWants(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '想看的內容（可擇一或最後選「全部」）：',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: 'A~J 單點', text: 'A~J 單點' } },
        { type: 'action', action: { type: 'message', label: '綜合 + 痛點', text: '綜合 + 痛點' } },
        { type: 'action', action: { type: 'message', label: '人物側寫', text: '人物側寫' } },
        { type: 'action', action: { type: 'message', label: '全部', text: '全部' } },
      ]
    }
  }]);
}

// 送去 /api/submit-oca
async function submitToApi(payload) {
  const resp = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/submit-oca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await resp.text().catch(()=> '');
  return { ok: resp.ok, status: resp.status, text };
}

// 主處理
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) {
      return res.status(403).send('Bad signature');
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      if (!ev.source?.userId) continue;
      const userId = ev.source.userId;

      // 僅處理文字訊息
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();

        // 取消
        if (/^取消$/.test(text)) {
          SESS.delete(userId);
          await replyMessage(ev.replyToken, [{ type: 'text', text: '已取消。若要重新開始，輸入「填表」。' }]);
          continue;
        }

        // 填表→啟動聊天精靈
        if (/填表|表單|填寫|聊天填表/.test(text)) {
          await startWizard(userId, ev.replyToken);
          continue;
        }

        // 進行中的精靈
        const st = SESS.get(userId);
        if (st) {
          const d = st.data;

          // step: name
          if (st.step === 'name') {
            if (!text || text.length > 30) {
              await replyMessage(ev.replyToken, [{ type: 'text', text: '請輸入有效的姓名（30字內）：' }]);
              continue;
            }
            d.name = text;
            st.step = 'gender';
            await askGender(ev.replyToken);
            continue;
          }

          // step: gender
          if (st.step === 'gender') {
            if (!/^(男|女|其他)$/.test(text)) {
              await askGender(ev.replyToken);
              continue;
            }
            d.gender = text;
            st.step = 'age';
            await askAge(ev.replyToken);
            continue;
          }

          // step: age
          if (st.step === 'age') {
            const n = Number(text);
            if (!Number.isFinite(n) || n < 14 || n > 110) {
              await replyMessage(ev.replyToken, [{ type: 'text', text: '年齡需是數字且 ≥14，請重新輸入：' }]);
              continue;
            }
            d.age = n;
            st.step = 'date';
            await askDate(ev.replyToken);
            continue;
          }

          // step: date
          if (st.step === 'date') {
            if (text === '略過') {
              d.date = '';
            } else if (text === '今天') {
              d.date = getTodayStr();
            } else {
              // 簡單檢查 YYYY/MM/DD
              if (!/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(text)) {
                await replyMessage(ev.replyToken, [{ type: 'text', text: '格式需像 2025/08/29（YYYY/MM/DD），或輸入「今天」。' }]);
                continue;
              }
              d.date = text.replaceAll('-', '/');
            }
            st.step = 'mania';
            await askMania(ev.replyToken);
            continue;
          }

          // step: mania（E點）
          if (st.step === 'mania') {
            if (!/^(有|無)$/.test(text)) {
              await askMania(ev.replyToken);
              continue;
            }
            d.mania = text === '有';
            st.step = 'scores';
            st.currentIdx = 0;
            await askScore(ev.replyToken, LETTERS[st.currentIdx]);
            continue;
          }

          // step: scores（逐一 A~J）
          if (st.step === 'scores') {
            const v = Number(text);
            if (!Number.isFinite(v) || v < -100 || v > 100) {
              await replyMessage(ev.replyToken, [{ type: 'text', text: '分數需是 -100 ~ 100 的整數，請重輸：' }]);
              continue;
            }
            const letter = LETTERS[st.currentIdx];
            d.scores[letter] = Math.trunc(v);

            st.currentIdx++;
            if (st.currentIdx < LETTERS.length) {
              await askScore(ev.replyToken, LETTERS[st.currentIdx]);
              continue;
            } else {
              st.step = 'want';
              await askWants(ev.replyToken);
              continue;
            }
          }

          // step: want（選擇輸出）
          if (st.step === 'want') {
            if (/^全部$/.test(text)) {
              d.wants = { single: true, combo: true, persona: true };
            } else {
              // 個別累積
              if (/A~J\s*單點/.test(text)) d.wants.single = true;
              if (/綜合\s*\+\s*痛點/.test(text)) d.wants.combo = true;
              if (/人物側寫/.test(text)) d.wants.persona = true;
              // 如果三個都沒選，就再問一次
              if (!d.wants.single && !d.wants.combo && !d.wants.persona) {
                await askWants(ev.replyToken);
                continue;
              }
            }

            // 送出到 /api/submit-oca
            await replyMessage(ev.replyToken, [{ type: 'text', text: '分析處理中，請稍候…' }]);

            const payload = {
              userId,
              name: d.name || '',
              gender: d.gender || '',
              age: d.age,
              date: d.date || '',
              mania: !!d.mania,
              scores: d.scores,
              wants: d.wants,
            };

            try {
              const r = await submitToApi(payload);
              if (r.ok) {
                await replyMessage(ev.replyToken, [{ type: 'text', text: '分析已送出 ✅，請稍等片刻查看結果。' }]);
              } else {
                console.error('submit-oca error:', r.status, r.text);
                await replyMessage(ev.replyToken, [{
                  type: 'text',
                  text: `分析送出失敗（${r.status}）。\n請稍後再試，或輸入「填表」重新開始。`
                }]);
              }
            } catch (e) {
              console.error(e);
              await replyMessage(ev.replyToken, [{
                type: 'text',
                text: '分析送出失敗，請稍後再試或改用「填表」。'
              }]);
            } finally {
              SESS.delete(userId);
            }
            continue;
          }
        }

        // 不是在精靈中：保留舊的文字 A~J 分數輸入
        if (seemsScoreText(text)) {
          await replyMessage(ev.replyToken, [
            { type: 'text', text: '我已收到分數，稍後會回覆分析結果（或輸入「填表」用聊天逐步填寫會更完整）。' }
          ]);
          continue;
        }

        // 說明
        await replyMessage(ev.replyToken, [{
          type: 'text',
          text: '嗨！輸入「填表」即可用聊天方式逐步填寫（含姓名、性別、年齡、日期、躁狂（E點）、A~J分數）；或直接用文字輸入 A~J（例如 A:10, B:-20, ...）。'
        }]);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
