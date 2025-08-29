// /api/line-webhook.js
// 驗簽 + 兩種啟動方式：1)「填表」→ 開 LIFF；2)「聊天填表 / 逐步 / 問答」→ 逐步問答
// 備註：session 先用記憶體 Map，若要穩定請換成 DB / Redis / Vercel KV。

const crypto = require('crypto');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID || ''; // 例如 2000xxxxxx-xxxxx
const LIFF_LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

// -------(A) LINE 回覆工具 -------
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
    const t = await resp.text().catch(()=>'' );
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

// -------(B) 簡易文字分數偵測(保留舊體驗) -------
function seemsScoreText(text) {
  const m = text.match(/[A-Jａ-ｊＡ-Ｊ]\s*[:：]?\s*-?\d+/gi);
  return m && m.length >= 3;
}

// -------(C) 聊天式逐步流程：session 與步驟 -------
// 注意：這個 Map 只在執行容器活著時存在；正式用請換 DB / KV。
const sessions = new Map();
const WIZARD_TTL_MS = (Number(process.env.WIZARD_TTL_MIN) || 15) * 60 * 1000;

// 提問清單（依序）：姓名、性別、年齡、日期、躁狂、A~J 十點、要看內容
const LETTERS = ['A','B','C','D','E','F','G','H','I','J'];
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}/${m}/${dd}`;
}
const steps = [
  { key:'name',   ask:() => ({
      type:'text', text:'請輸入姓名（必填）',
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => (v && v.trim().length>0) ? {ok:true} : {ok:false, msg:'姓名不可空白，請重新輸入。'}
  },
  { key:'gender', ask:() => ({
      type:'text', text:'性別請選：',
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'男',text:'男'}},
        {type:'action',action:{type:'message',label:'女',text:'女'}},
        {type:'action',action:{type:'message',label:'其他',text:'其他'}},
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => (/^(男|女|其他)$/).test(v) ? {ok:true} : {ok:false, msg:'請點選「男 / 女 / 其他」。'}
  },
  { key:'age',    ask:() => ({
      type:'text', text:'年齡（必填，需 ≥14）',
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'14',text:'14'}},
        {type:'action',action:{type:'message',label:'18',text:'18'}},
        {type:'action',action:{type:'message',label:'25',text:'25'}},
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => {
      const n = Number(String(v).trim());
      if (!Number.isFinite(n)) return {ok:false,msg:'請輸入數字年齡。'};
      if (n<14) return {ok:false,msg:'年齡需 ≥14。請重新輸入。'};
      if (n>110) return {ok:false,msg:'年齡太大，請重新輸入。'};
      return {ok:true, value:n};
    }
  },
  { key:'date',   ask:() => ({
      type:'text', text:'日期（YYYY/MM/DD），或點「今天」。',
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'今天',text:todayStr()}},
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => {
      const s = String(v).trim().replaceAll('-','/');
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return {ok:false,msg:'日期格式請用 YYYY/MM/DD。'};
      return {ok:true, value:s};
    }
  },
  { key:'mania',  ask:() => ({
      type:'text', text:'是否有「躁狂（B 情緒）」？',
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'有',text:'有'}},
        {type:'action',action:{type:'message',label:'無',text:'無'}},
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => (/^(有|無)$/).test(v) ? {ok:true, value:(v==='有')} : {ok:false,msg:'請選「有」或「無」。'}
  },
  // A~J 十個點
  ...LETTERS.map(letter => ({
    key:`score_${letter}`,
    ask:() => ({
      type:'text',
      text:`請輸入 ${letter} 分數（-100 ~ 100），也可點下方快捷鍵：`,
      quickReply:{items:[
        {type:'action',action:{type:'message',label:'-50',text:'-50'}},
        {type:'action',action:{type:'message',label:'-25',text:'-25'}},
        {type:'action',action:{type:'message',label:'0',text:'0'}},
        {type:'action',action:{type:'message',label:'+25',text:'+25'}},
        {type:'action',action:{type:'message',label:'+50',text:'+50'}},
        {type:'action',action:{type:'message',label:'取消',text:'取消'}}
      ]}
    }),
    validate: v => {
      const n = Number(String(v).replace('+','').trim());
      if (!Number.isFinite(n)) return {ok:false,msg:'請輸入 -100 ~ 100 的數字。'};
      if (n<-100 || n>100) return {ok:false,msg:'超出範圍（-100~100），請重輸。'};
      return {ok:true, value:n};
    }
  }))
];

// 啟動/取消/下一步 的文字
const START_WIZARD_RE = /(聊天填表|逐步|問答)/i;
const CANCEL_RE = /^取消$/i;

// 建立 / 取得 / 更新 session
function getSession(userId) {
  const now = Date.now();
  let s = sessions.get(userId);
  if (!s || s.expiresAt < now) {
    s = { stepIndex: 0, data: {}, expiresAt: now + WIZARD_TTL_MS };
    sessions.set(userId, s);
  } else {
    s.expiresAt = now + WIZARD_TTL_MS; // refresh TTL
  }
  return s;
}
function clearSession(userId){ sessions.delete(userId); }

async function askCurrentStep(userId, replyToken) {
  const s = getSession(userId);
  const st = steps[s.stepIndex];
  await replyMessage(replyToken, [ st.ask() ]);
}

function collectScoresFromSession(s){
  const scores = {};
  for (const L of LETTERS){
    scores[L] = Number(s.data[`score_${L}`] ?? 0);
  }
  return scores;
}

// -------(D) 主入口 -------
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    // 1) 驗簽
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(sig, rawBody)) return res.status(403).send('Bad signature');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const events = body.events || [];
    const host = req.headers['host'];
    const baseURL = `https://${host}`;

    for (const ev of events) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

      const text = (ev.message.text || '').trim();
      const userId = ev.source?.userId;
      const replyToken = ev.replyToken;

      // (1) 使用者想取消聊天填寫
      if (CANCEL_RE.test(text)) {
        clearSession(userId);
        await replyMessage(replyToken, [{ type:'text', text:'已取消。需要時輸入「聊天填表」或「填表」。'}]);
        continue;
      }

      // (2) 使用者要求「聊天式」填寫：啟動對談流程
      if (START_WIZARD_RE.test(text)) {
        const s = getSession(userId);
        s.stepIndex = 0;
        s.data = {};
        await replyMessage(replyToken, [{ type:'text', text:'好的，開始逐步填寫。任何時間可輸入「取消」。'}]);
        await askCurrentStep(userId, replyToken);
        continue;
      }

      // (3) 如果 session 存在，表示我們正在「逐步填寫」模式
      const s = sessions.get(userId);
      if (s) {
        const st = steps[s.stepIndex];
        if (!st) { clearSession(userId); continue; }

        // 驗證答案
        const v = st.validate(text);
        if (!v.ok) {
          await replyMessage(replyToken, [{ type:'text', text: v.msg }]);
          await askCurrentStep(userId, replyToken);
          continue;
        }

        s.data[st.key] = v.value ?? text;

        // 進到下一步
        s.stepIndex += 1;

        if (s.stepIndex < steps.length) {
          await askCurrentStep(userId, replyToken);
        } else {
          // 所有題目完成 → 送到 /api/submit-oca
          const payload = {
            name: s.data.name,
            gender: s.data.gender,
            age: s.data.age,
            date: s.data.date,
            mania: !!s.data.mania,
            scores: collectScoresFromSession(s),
            wants: { // 全部都看
              single: true,
              summary: true,
              persona: true
            }
          };

          try {
            const r = await fetch(`${baseURL}/api/submit-oca`, {
              method:'POST',
              headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify(payload)
            });
            if (!r.ok) {
              const t = await r.text().catch(()=>'' );
              console.error('/api/submit-oca error:', r.status, t);
              await replyMessage(replyToken, [{ type:'text', text:'分析送出失敗，請稍後再試或改用「填表」。'}]);
            }
            // /api/submit-oca 會自行回傳分析訊息給使用者（你目前的程式邏輯）
          } catch (e) {
            console.error(e);
            await replyMessage(replyToken, [{ type:'text', text:'伺服器忙線，請稍後再試或改用「填表」。'}]);
          }
          clearSession(userId);
        }
        continue;
      }

      // (4) 關鍵字：填表 / 表單 / 填寫 → 回 LIFF 連結
      if (/填表|表單|填寫/i.test(text)) {
        if (LIFF_LINK) {
          await replyMessage(replyToken, [
            {
              type: 'template',
              altText: '開啟 OCA 填表',
              template: {
                type: 'buttons',
                text: '請點「開啟表單」填寫 A~J 與基本資料。\n若想直接在聊天室逐步填寫，輸入「聊天填表」。',
                actions: [ { type:'uri', label:'開啟表單', uri: LIFF_LINK } ]
              }
            }
          ]);
        } else {
          await replyMessage(replyToken, [
            { type:'text', text:'尚未設定 LIFF_ID，請先在 Vercel 設定 LIFF_ID 後重新部署。' }
          ]);
        }
        continue;
      }

      // (5) 舊的手打分數（A:10, B:-20...）
      if (seemsScoreText(text)) {
        await replyMessage(replyToken, [
          { type:'text', text:'我已收到分數，稍後會回覆分析結果（或輸入「聊天填表」在聊天室逐步填寫）。' }
        ]);
        continue;
      }

      // (6) 引導
      await replyMessage(replyToken, [
        { type:'text',
          text:'嗨！要開始分析請輸入：「填表」（打開表單）或「聊天填表」（在聊天室逐步完成）。\n也可直接輸入 A~J 分數（例如 A:10, B:-20, ...）。' }
      ]);
    }

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
