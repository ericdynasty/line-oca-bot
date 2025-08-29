// api/line-webhook.js
// 純聊天式填表 + Reply→Push 備援 + 簽章驗證

const crypto = require('crypto');

// 環境變數
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ====== Reply → Push 備援 ======
const tokenToUser = new Map(); // replyToken -> userId

async function pushMessage(userId, messages) {
  try {
    const resp = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: userId, messages }),
    });
    if (!resp.ok) {
      console.error('Push API error:', resp.status, await resp.text().catch(()=> ''));
    }
  } catch (e) {
    console.error('Push API exception:', e);
  }
}

async function replyMessage(replyToken, messages) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (resp.ok) return true;

    const txt = await resp.text().catch(()=> '');
    console.error('Reply API error:', resp.status, txt);

    // Reply token 失效 → fallback 用 push
    if (resp.status === 400 && /Invalid reply token/i.test(txt)) {
      const userId = tokenToUser.get(replyToken);
      if (userId) {
        await pushMessage(userId, messages);
        return false;
      }
    }
    return false;
  } catch (e) {
    console.error('Reply API exception:', e);
    return false;
  }
}

// ====== 簽章驗證 ======
function verifySignature(headerSignature, body) {
  if (!CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hmac === headerSignature;
}

// ====== 會話狀態（記憶體，重啟或無聊雲可能會清空，足夠 PoC/小規模）======
const SESS = new Map(); // userId -> session

const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES = {
  A: 'A 自我',
  B: 'B 情緒',
  C: 'C 任務',
  D: 'D 關係',
  E: 'E 支援',
  F: 'F 壓力',
  G: 'G 目標',
  H: 'H 執行',
  I: 'I 自律',
  J: 'J 活力',
};

// 今天字串
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

// 數字驗證
function parseScore(s) {
  const n = Number((s || '').toString().trim());
  if (!Number.isFinite(n)) return null;
  if (n < -100 || n > 100) return null;
  return Math.round(n);
}

// 啟動聊天填表
async function startChatFlow(userId, replyToken) {
  SESS.set(userId, {
    step: 'name',           // name -> gender -> age -> date -> maniaB -> maniaE -> scores -> wants
    idx: 0,
    data: {
      name: '',
      gender: '',           // 男/女/其他
      age: null,
      date: '',
      maniaB: false,        // 躁狂（B）
      maniaE: false,        // 躁狂（E）
      scores: {},           // A~J
      wants: { single: true, combo: true, persona: true }, // 預設全部
    },
  });

  await replyMessage(replyToken, [
    { type: 'text', text: '好的，開始逐步填寫。任何時間可輸入「取消」。' },
    { type: 'text', text: '請輸入姓名：' },
  ]);
}

// 處理聊天流程每一步
async function handleChatFlow(ev, text, userId) {
  const s = SESS.get(userId);
  if (!s) return false; // 沒在聊天流程中

  const replyToken = ev.replyToken;

  // 取消
  if (/^取消$/i.test(text)) {
    SESS.delete(userId);
    await replyMessage(replyToken, [{ type: 'text', text: '已為你取消，若要重新開始請輸入「聊天填表」。' }]);
    return true;
  }

  const d = s.data;

  // 依 step 走
  switch (s.step) {
    case 'name': {
      const name = text.trim();
      if (!name) {
        await replyMessage(replyToken, [{ type: 'text', text: '姓名不可空白，請重新輸入姓名：' }]);
        return true;
      }
      d.name = name;
      s.step = 'gender';
      await replyMessage(replyToken, [{ type: 'text', text: '性別請選：男 / 女 / 其他（直接輸入其一）' }]);
      return true;
    }

    case 'gender': {
      const g = text.trim();
      if (!/(男|女|其他|male|female|other)/i.test(g)) {
        await replyMessage(replyToken, [{ type: 'text', text: '請輸入「男」「女」或「其他」。' }]);
        return true;
      }
      d.gender = /男|male/i.test(g) ? '男' : /女|female/i.test(g) ? '女' : '其他';
      s.step = 'age';
      await replyMessage(replyToken, [{ type: 'text', text: '年齡（必填，需 ≥14）：' }]);
      return true;
    }

    case 'age': {
      const n = Number(text.trim());
      if (!Number.isInteger(n) || n < 14) {
        await replyMessage(replyToken, [{ type: 'text', text: '年齡需為整數且 ≥14，請重新輸入：' }]);
        return true;
      }
      d.age = n;
      s.step = 'date';
      await replyMessage(replyToken, [{ type: 'text', text: '日期（YYYY/MM/DD），或輸入「今天」。' }]);
      return true;
    }

    case 'date': {
      const t = text.trim();
      let date = t;
      if (/今天/.test(t)) date = todayStr();
      // 簡單檢查 YYYY/MM/DD
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date)) {
        await replyMessage(replyToken, [{ type: 'text', text: '日期格式需為 YYYY/MM/DD，或輸入「今天」。請重新輸入：' }]);
        return true;
      }
      d.date = date;
      s.step = 'maniaB';
      await replyMessage(replyToken, [{ type: 'text', text: '躁狂（B）是否勾選？（是/否）' }]);
      return true;
    }

    case 'maniaB': {
      const t = text.trim();
      if (!/^(是|有|y|勾|否|無|n)$/i.test(t)) {
        await replyMessage(replyToken, [{ type: 'text', text: '請輸入「是」或「否」。躁狂（B）是否勾選？' }]);
        return true;
      }
      d.maniaB = /^(是|有|y|勾)$/i.test(t);
      s.step = 'maniaE';
      await replyMessage(replyToken, [{ type: 'text', text: '躁狂（E）是否勾選？（是/否）' }]);
      return true;
    }

    case 'maniaE': {
      const t = text.trim();
      if (!/^(是|有|y|勾|否|無|n)$/i.test(t)) {
        await replyMessage(replyToken, [{ type: 'text', text: '請輸入「是」或「否」。躁狂（E）是否勾選？' }]);
        return true;
      }
      d.maniaE = /^(是|有|y|勾)$/i.test(t);
      s.step = 'scores';
      s.idx = 0;
      await replyMessage(replyToken, [
        { type: 'text', text: `請輸入${LETTERS[s.idx]}點（-100～100）的分數：` },
      ]);
      return true;
    }

    case 'scores': {
      const L = LETTERS[s.idx];
      const n = parseScore(text);
      if (n === null) {
        await replyMessage(replyToken, [{ type: 'text', text: `分數需為 -100~100 的整數，請重新輸入 ${L} 點的分數：` }]);
        return true;
      }
      d.scores[L] = n;

      s.idx += 1;
      if (s.idx < LETTERS.length) {
        const nextL = LETTERS[s.idx];
        await replyMessage(replyToken, [{ type: 'text', text: `請輸入${nextL}點（-100～100）的分數：` }]);
        return true;
      }

      // A~J 完成 → 問想看的內容
      s.step = 'wants';
      await replyMessage(replyToken, [{
        type: 'text',
        text: '想看的內容（可輸入「單點」「綜合」「人物」，或輸入「全部」）：'
      }]);
      return true;
    }

    case 'wants': {
      const t = text.trim();
      const all = /全部|all/i.test(t);
      d.wants = {
        single: all || /單點|A~J|單點解析|single/i.test(t),
        combo:  all || /綜合|痛點|combo/i.test(t),
        persona:all || /人物|側寫|persona/i.test(t),
      };
      // 若三個都沒命中，預設全部
      if (!d.wants.single && !d.wants.combo && !d.wants.persona) {
        d.wants = { single: true, combo: true, persona: true };
      }

      // 送出分析（呼叫 submit-oca）
      const payload = {
        userId,
        name: d.name,
        gender: d.gender,
        age: d.age,
        date: d.date,
        mania: !!(d.maniaB || d.maniaE), // 綜合標記
        maniaB: !!d.maniaB,
        maniaE: !!d.maniaE,
        scores: d.scores,
        wants: d.wants,
      };

      const base =
        process.env.PUBLIC_BASE_URL ||
        (ev?.source?.type ? `https://${ev.destination ? 'line-oca-bot.vercel.app' : ev.requestContext?.domainName || ev.headers?.host || ''}` : '') ||
        `https://${ev?.headers?.host || 'line-oca-bot.vercel.app'}`;

      // 先回覆「分析處理中…」
      await replyMessage(ev.replyToken, [{ type: 'text', text: '分析處理中，請稍候…' }]);

      try {
        const url = `${(process.env.PUBLIC_BASE_URL || `https://${ev?.headers?.host || 'line-oca-bot.vercel.app'}`)}/api/submit-oca`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          console.error('submit-oca error:', resp.status, await resp.text().catch(()=> ''));
          await pushMessage(userId, [{ type: 'text', text: '分析送出失敗，請稍後再試或改用「填表」。' }]);
        }
      } catch (e) {
        console.error('submit-oca exception:', e);
        await pushMessage(userId, [{ type: 'text', text: '分析送出失敗，請稍後再試或改用「填表」。' }]);
      }

      // 結束本次會話
      SESS.delete(userId);
      return true;
    }

    default:
      return false;
  }
}

// ====== 主入口 ======
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
      // 建立 replyToken -> userId 的對應（給 fallback 用）
      if (ev.replyToken && ev.source?.userId) {
        tokenToUser.set(ev.replyToken, ev.source.userId);
      }

      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();
        const userId = ev.source?.userId;
        if (!userId) continue;

        // 若正在聊天流程，優先走流程
        if (SESS.has(userId)) {
          const handled = await handleChatFlow(ev, text, userId);
          if (handled) continue;
        }

        // 關鍵字啟動聊天式填表
        if (/(聊天填表|開始填寫|開始填表|填表)/i.test(text)) {
          await startChatFlow(userId, ev.replyToken);
          continue;
        }

        // 一般說明
        await replyMessage(ev.replyToken, [
          { type: 'text', text: '嗨！輸入「聊天填表」可逐步填寫資料；若要表單模式，請輸入「填表」。' },
        ]);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server Error');
  }
};
