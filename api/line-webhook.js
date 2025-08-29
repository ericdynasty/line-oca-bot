// api/line-webhook.js
// 只用聊天逐步填寫；姓名→性別→年齡(>=14)→日期→躁狂(B)→躁狂(E)→A~J→想看的內容→呼叫 /api/submit-oca
const crypto = require('crypto');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 比以前更穩定：優先 PUBLIC_BASE_URL，其次 VERCEL_URL，最後你的正式網域
const BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://line-oca-bot.vercel.app');

const LETTERS = "ABCDEFGHIJ".split("");
const NAMES = {
  A: "A 自我", B: "B 情緒", C: "C 任務", D: "D 關係", E: "E 支援",
  F: "F 壓力", G: "G 目標", H: "H 執行", I: "I 自律", J: "J 活力",
};

// --- 輕量 session（serverless 會回收，重啟後請用「填表」再啟動） ---
const SESS = new Map();
// step: name | gender | age | date | maniaB | maniaE | scores | want

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

// 允許「A:10, B:-20, ...」或「A10 B-20」等快速輸入分數
function seemsScoreText(text) {
  const m = text.match(/[A-Jａ-ｊＡ-Ｊ]\s*[:：]?\s*-?\d+/gi);
  return m && m.length >= 3;
}

async function startWizard(userId, replyToken) {
  SESS.set(userId, { step: 'name', data: { scores:{}, wants:{} }, currentIdx: 0 });
  await replyMessage(replyToken, [{
    type: 'text',
    text: '好的，開始逐步填寫。任何時間可輸入「取消」。\n\n請輸入姓名：'
  }]);
}
async function askGender(replyToken) {
  await replyMessage(replyToken, [{
    type: 'text',
    text: '性別請選：',
    quickReply: { items: [
      { type:'action', action:{ type:'message', label:'男', text:'男' } },
      { type:'action', action:{ type:'message', label:'女', text:'女' } },
      { type:'action', action:{ type:'message', label:'其他', text:'其他' } },
    ]}
  }]);
}
async function askAge(replyToken) {
  await replyMessage(replyToken, [{ type:'text', text:'年齡（必填，需 ≥14）：' }]);
}
async function askDate(replyToken) {
  await replyMessage(replyToken, [{
    type:'text',
    text:'日期（YYYY/MM/DD），或輸入「今天」。',
    quickReply:{ items:[
      { type:'action', action:{ type:'message', label:'今天', text:'今天' } },
      { type:'action', action:{ type:'message', label:'略過', text:'略過' } },
    ]}
  }]);
}
// 躁狂（B）
async function askManiaB(replyToken) {
  await replyMessage(replyToken, [{
    type:'text',
    text:'躁狂（B 情緒）是否存在？',
    quickReply:{ items:[
      { type:'action', action:{ type:'message', label:'有', text:'有' } },
      { type:'action', action:{ type:'message', label:'無', text:'無' } },
    ]}
  }]);
}
// 躁狂（E）
async function askManiaE(replyToken) {
  await replyMessage(replyToken, [{
    type:'text',
    text:'躁狂（E 點）是否存在？',
    quickReply:{ items:[
      { type:'action', action:{ type:'message', label:'有', text:'有' } },
      { type:'action', action:{ type:'message', label:'無', text:'無' } },
    ]}
  }]);
}
// ★ 這裡改文案：請輸入「X點（-100～100）的分數。」（X = A~J）
async function askScore(replyToken, letter) {
  await replyMessage(replyToken, [{
    type:'text',
    text:`請輸入 ${letter} 點（-100～100）的分數。`,
    quickReply:{ items:[
      { type:'action', action:{ type:'message', label:'-50', text:'-50' } },
      { type:'action', action:{ type:'message', label:'-25', text:'-25' } },
      { type:'action', action:{ type:'message', label:'0',   text:'0'   } },
      { type:'action', action:{ type:'message', label:'+25', text:'25'  } },
      { type:'action', action:{ type:'message', label:'+50', text:'50'  } },
    ]}
  }]);
}
async function askWants(replyToken) {
  await replyMessage(replyToken, [{
    type:'text',
    text:'想看的內容（可擇一或最後選「全部」）：',
    quickReply:{ items:[
      { type:'action', action:{ type:'message', label:'A~J 單點',   text:'A~J 單點'   } },
      { type:'action', action:{ type:'message', label:'綜合 + 痛點', text:'綜合 + 痛點' } },
      { type:'action', action:{ type:'message', label:'人物側寫',   text:'人物側寫'   } },
      { type:'action', action:{ type:'message', label:'全部',       text:'全部'       } },
    ]}
  }]);
}

// 加入逾時保護（12 秒），避免永遠卡在「分析處理中」
async function submitToApi(payload) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);

  try {
    const resp = await fetch(`${BASE_URL}/api/submit-oca`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    const text = await resp.text().catch(()=> '');
    return { ok: resp.ok, status: resp.status, text };
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) return res.status(403).send('Bad signature');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];

    for (const ev of events) {
      if (!ev.source?.userId) continue;
      const userId = ev.source.userId;

      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();

        // 取消
        if (/^取消$/.test(text)) {
          SESS.delete(userId);
          await replyMessage(ev.replyToken, [{ type:'text', text:'已取消。若要重新開始，輸入「填表」。' }]);
          continue;
        }

        // 啟動
        if (/填表|表單|填寫|聊天填表/.test(text)) {
          await startWizard(userId, ev.replyToken);
          continue;
        }

        const st = SESS.get(userId);
        if (st) {
          const d = st.data;

          if (st.step === 'name') {
            if (!text || text.length > 30) {
              await replyMessage(ev.replyToken, [{ type:'text', text:'請輸入有效的姓名（30字內）：' }]);
              continue;
            }
            d.name = text;
            st.step = 'gender'; await askGender(ev.replyToken); continue;
          }

          if (st.step === 'gender') {
            if (!/^(男|女|其他)$/.test(text)) { await askGender(ev.replyToken); continue; }
            d.gender = text;
            st.step = 'age'; await askAge(ev.replyToken); continue;
          }

          if (st.step === 'age') {
            const n = Number(text);
            if (!Number.isFinite(n) || n < 14 || n > 110) {
              await replyMessage(ev.replyToken, [{ type:'text', text:'年齡需是數字且 ≥14，請重新輸入：' }]);
              continue;
            }
            d.age = n;
            st.step = 'date'; await askDate(ev.replyToken); continue;
          }

          if (st.step === 'date') {
            if (text === '略過') d.date = '';
            else if (text === '今天') d.date = getTodayStr();
            else {
              if (!/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(text)) {
                await replyMessage(ev.replyToken, [{ type:'text', text:'格式需像 2025/08/29（YYYY/MM/DD），或輸入「今天」。' }]);
                continue;
              }
              d.date = text.replaceAll('-', '/');
            }
            st.step = 'maniaB'; await askManiaB(ev.replyToken); continue;
          }

          if (st.step === 'maniaB') {
            if (!/^(有|無)$/.test(text)) { await askManiaB(ev.replyToken); continue; }
            d.maniaB = text === '有';
            st.step = 'maniaE'; await askManiaE(ev.replyToken); continue;
          }

          if (st.step === 'maniaE') {
            if (!/^(有|無)$/.test(text)) { await askManiaE(ev.replyToken); continue; }
            d.maniaE = text === '有';
            st.step = 'scores'; st.currentIdx = 0;
            await askScore(ev.replyToken, LETTERS[st.currentIdx]); continue;
          }

          if (st.step === 'scores') {
            const v = Number(text);
            if (!Number.isFinite(v) || v < -100 || v > 100) {
              await replyMessage(ev.replyToken, [{ type:'text', text:'分數需是 -100 ~ 100 的整數，請重輸：' }]);
              continue;
            }
            const letter = LETTERS[st.currentIdx];
            d.scores[letter] = Math.trunc(v);
            st.currentIdx++;
            if (st.currentIdx < LETTERS.length) {
              await askScore(ev.replyToken, LETTERS[st.currentIdx]); continue;
            } else {
              st.step = 'want'; await askWants(ev.replyToken); continue;
            }
          }

          if (st.step === 'want') {
            if (/^(全部|全都|ALL)$/i.test(text)) {
              d.wants = { single:true, combo:true, persona:true };
            } else {
              if (/A~J\s*單點/.test(text)) d.wants.single = true;
              if (/綜合\s*\+\s*痛點/.test(text)) d.wants.combo = true;
              if (/人物側寫/.test(text)) d.wants.persona = true;
              if (!d.wants.single && !d.wants.combo && !d.wants.persona) {
                await askWants(ev.replyToken); continue;
              }
            }

            await replyMessage(ev.replyToken, [{ type:'text', text:'分析處理中，請稍候…' }]);

            const payload = {
              userId,
              name: d.name || '',
              gender: d.gender || '',
              age: d.age,
              date: d.date || '',
              maniaB: !!d.maniaB,
              maniaE: !!d.maniaE,
              scores: d.scores,
              wants: d.wants,
            };

            try {
              const r = await submitToApi(payload);
              if (r.ok) {
                await replyMessage(ev.replyToken, [{ type:'text', text:'分析已送出 ✅，請稍等片刻查看結果。' }]);
              } else {
                console.error('submit-oca error:', r.status, r.text);
                await replyMessage(ev.replyToken, [{ type:'text',
                  text:`分析送出失敗（${r.status}）。請稍後再試，或輸入「填表」重新開始。` }]);
              }
            } catch (e) {
              console.error(e);
              await replyMessage(ev.replyToken, [{ type:'text',
                text:'分析送出失敗，請稍後再試或改用「填表」。' }]);
            } finally {
              SESS.delete(userId);
            }
            continue;
          }
        }

        // 非精靈：保留舊的文字 A~J 分數
        if (seemsScoreText(text)) {
          await replyMessage(ev.replyToken, [
            { type:'text', text:'我已收到分數，稍後會回覆分析結果（或輸入「填表」用聊天填寫會更完整）。' }
          ]);
          continue;
        }

        await replyMessage(ev.replyToken, [{
          type:'text',
          text:'嗨！輸入「填表」即可用聊天方式逐步填寫（含姓名、性別、年齡、日期、躁狂B/E、A~J 分數）；或直接用文字輸入 A~J（例如 A:10, B:-20, ...）。'
        }]);
      }
    }

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
