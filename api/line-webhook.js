// api/line-webhook.js — 聊天填表 + 教材規則單點輸出（ESM）
import crypto from 'node:crypto';
import { loadRules } from './_oca_rules.js';

const ACCESS_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

const SESS = new Map(); // userId -> { step, idx, data }

// —— 教材正式用語（你提供的定義）——
const LETTERS = 'ABCDEFGHIJ'.split('');
const NAMES = {
  A: 'A 穩定性',
  B: 'B 愉快',
  C: 'C 鎮定',
  D: 'D 確定力',
  E: 'E 活躍',
  F: 'F 積極',
  G: 'G 負責',
  H: 'H 評估能力',
  I: 'I 欣賞能力',
  J: 'J 溝通能力',
};

// ====== LINE helpers ======
async function replyMessage(replyToken, messages) {
  const chunks = Array.isArray(messages) ? messages : [messages];
  const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: chunks }),
  });
  if (!resp.ok) console.error('LINE reply error:', resp.status, await resp.text().catch(()=>'')); 
}
async function pushMessage(to, messages) {
  const chunks = Array.isArray(messages) ? messages : [messages];
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, messages: chunks }),
  });
  if (!resp.ok) console.error('LINE push error:', resp.status, await resp.text().catch(()=>'')); 
}
const qi     = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });
const withQR = (text, items)  => ({ type: 'text', text, quickReply: { items } });

// ====== 流程狀態 ======
function getSession(userId) {
  if (!SESS.has(userId)) SESS.set(userId, { step: 'idle', idx: 0, data: { scores: {} } });
  return SESS.get(userId);
}
function resetSession(userId) {
  SESS.set(userId, { step: 'idle', idx: 0, data: { scores: {} } });
}

// ====== 簡版分析（僅做綜合與側寫；單點改用教材規則）======
function bandDesc(n) {
  if (n >= 41) return ['高(重)', '偏強勢、驅動力大'];
  if (n >= 11) return ['高(輕)', '略偏高、傾向較明顯'];
  if (n <= -41) return ['低(重)', '不足感明顯、需特別留意'];
  if (n <= -11) return ['低(輕)', '略偏低、偶爾受影響'];
  return ['中性', '較平衡、影響小'];
}
function topLetters(scores, k = 3) {
  return Object.entries(scores).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, k);
}

// ====== 教材規則 → 單點輸出 ======
// 允許多種放法：rules.letters[L] 或 rules.bands[L] 或 rules[L]
function getLetterRule(rules, L) {
  return (rules?.letters && rules.letters[L]) ||
         (rules?.bands   && rules.bands[L])   ||
          rules?.[L] || null;
}
function pickBand(bands = [], n) {
  for (const b of bands) {
    const min = Number.isFinite(b.min) ? b.min : -100;
    const max = Number.isFinite(b.max) ? b.max :  100;
    if (n >= min && n <= max) return b;
  }
  return null;
}
function renderSingleByRules(scores, rules) {
  const out = [];
  for (const L of LETTERS) {
    const val = Number(scores[L] ?? 0);
    const rule = getLetterRule(rules, L);
    const label = rule?.name || NAMES[L];
    const band  = pickBand(rule?.bands || [], val);
    if (band) {
      const title = band.title ? `｜${band.title}` : '';
      const text  = band.text ? String(band.text).trim() : '';
      out.push(`${label}：${val}${title}\n${text}`);
    } else {
      const [lvl, hint] = bandDesc(val);
      out.push(`${label}：${val}｜${lvl}\n— ${hint}`);
    }
  }
  return `【A~J 單點】\n${out.join('\n\n')}`;
}
function renderSummaryAndPersona(payload) {
  const { name, gender, age, maniaB, maniaE, scores } = payload;
  const tops = topLetters(scores, 3);
  const topsText = tops.map(([L, v]) => `${NAMES[L]}：${v}（${bandDesc(v)[0]}）`).join('、');

  const combo =
    `【綜合重點】\n` +
    `最需要留意／最有影響的面向：${topsText || '無特別突出'}。\n` +
    `躁狂（B）：${maniaB ? '有' : '無'}；躁狂（E）：${maniaE ? '有' : '無'}；\n` +
    `姓名：${name || '未填'}；年齡：${age || '未填'}；性別：${gender || '未填'}。`;

  let persona = '【人物側寫】\n';
  if (tops.length >= 2) {
    const [L1, v1] = tops[0];
    const [L2, v2] = tops[1];
    const dir1 = v1 >= 0 ? '偏高' : '偏低';
    const dir2 = v2 >= 0 ? '偏高' : '偏低';
    persona += `${NAMES[L1]}${dir1}、${NAMES[L2]}${dir2}；整體呈現「${dir1 === '偏高' ? '主動' : '保守'}、${dir2 === '偏高' ? '外放' : '內斂'}」傾向（示意）。`;
  } else {
    persona += '整體表現較均衡。';
  }
  return { combo, persona };
}

// ====== 問句與解析 ======
function startFlow(userId) {
  const s = getSession(userId);
  s.step = 'name'; s.idx = 0; s.data = { scores: {} };
  return [
    { type: 'text', text: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。' },
    withQR('請輸入填表人姓名：', [qi('取消', '取消'), qi('重新開始', '重新開始')]),
  ];
}
const askGender = () => withQR('性別請選（或輸入 1/2/3）：\n1. 男  2. 女  3. 其他', [qi('1 男','1'), qi('2 女','2'), qi('3 其他','3')]);
const askAge    = () => withQR('請輸入年齡（14~120）：', [qi('取消','取消'), qi('重新開始','重新開始')]);
const askManiaB = () => withQR('躁狂 B（情緒）是否偏高？\n1. 無  2. 有', [qi('1 無','1'), qi('2 有','2')]);
const askManiaE = () => withQR('躁狂 E（活躍）是否偏高？\n1. 無  2. 有', [qi('1 無','1'), qi('2 有','2')]);
const askLetter = (L) => withQR(`請輸入 ${NAMES[L]}（-100～100）的分數：`, [qi('-50','-50'), qi('0','0'), qi('50','50')]);
const askResult = () => withQR('想看的內容（可多選，空白代表全部）：\n1. A~J 單點  2. 綜合重點  3. 人物側寫', [qi('1','1'), qi('2','2'), qi('3','3'), qi('全部','全部')]);

function parseGender(v) {
  const t=(v||'').trim(); if(t==='1'||/男/.test(t))return'男'; if(t==='2'||/女/.test(t))return'女'; if(t==='3'||/其/.test(t))return'其他'; return null;
}
function parseYesNo12(v) {
  const t=(v||'').trim(); if(t==='1'||/^無$/.test(t))return false; if(t==='2'||/^有$/.test(t))return true; return null;
}
function parseWants(v) {
  const t=(v||'').replaceAll('，',',').trim();
  if(!t||t==='全部')return{single:true,combo:true,persona:true};
  const a=t.split(',').map(x=>x.trim()); return{single:a.includes('1'),combo:a.includes('2'),persona:a.includes('3')};
}

// ====== 主 Handler ======
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(200).send('OK'); return; }

  // 簽章驗證（不過濾，只記警告，方便除錯）
  try {
    const raw = JSON.stringify(req.body||{});
    const sig = req.headers['x-line-signature'] || '';
    if (CHANNEL_SECRET) {
      const calc = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
      if (sig !== calc) console.warn('⚠️ signature mismatch (略過以利除錯)');
    }
  } catch {}

  const events = req.body?.events || [];
  for (const ev of events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

    const userId = ev.source?.userId;
    const text   = (ev.message?.text || '').trim();
    const s      = getSession(userId);

    // 全域指令
    if (/^取消$/.test(text)) {
      resetSession(userId);
      await replyMessage(ev.replyToken, withQR('已取消。要重新開始嗎？', [qi('填表','填表'), qi('重新開始','重新開始')]));
      continue;
    }
    if (/^(填表|聊天填表|開始|重新開始)$/.test(text)) {
      await replyMessage(ev.replyToken, startFlow(userId));
      continue;
    }

    // 狀態機
    if (s.step === 'idle') {
      await replyMessage(ev.replyToken, withQR('輸入「填表」即可開始聊天填表。', [qi('填表','填表'), qi('取消','取消')]));
      continue;
    }
    if (s.step === 'name') {
      s.data.name = text.slice(0,30); s.step='gender';
      await replyMessage(ev.replyToken, askGender()); continue;
    }
    if (s.step === 'gender') {
      const g = parseGender(text); if(!g){ await replyMessage(ev.replyToken, askGender()); continue; }
      s.data.gender = g; s.step='age'; await replyMessage(ev.replyToken, askAge()); continue;
    }
    if (s.step === 'age') {
      const n=Number(text);
      if(!Number.isFinite(n)||n<14||n>120){ await replyMessage(ev.replyToken, withQR('年齡需要是 14~120 的數字，請再輸入：',[qi('取消','取消')])); continue; }
      s.data.age=n; s.step='maniaB'; await replyMessage(ev.replyToken, askManiaB()); continue;
    }
    if (s.step === 'maniaB') {
      const v=parseYesNo12(text); if(v===null){ await replyMessage(ev.replyToken, askManiaB()); continue; }
      s.data.maniaB=v; s.step='maniaE'; await replyMessage(ev.replyToken, askManiaE()); continue;
    }
    if (s.step === 'maniaE') {
      const v=parseYesNo12(text); if(v===null){ await replyMessage(ev.replyToken, askManiaE()); continue; }
      s.data.maniaE=v; s.step='score'; s.idx=0; await replyMessage(ev.replyToken, askLetter(LETTERS[s.idx])); continue;
    }
    if (s.step === 'score') {
      const n=Number(text);
      if(!Number.isFinite(n)||n<-100||n>100){ await replyMessage(ev.replyToken, withQR('請輸入 -100～100 的數字：',[qi('-50','-50'),qi('0','0'),qi('50','50')])); continue; }
      const L=LETTERS[s.idx]; s.data.scores[L]=n; s.idx+=1;
      if(s.idx<LETTERS.length){ await replyMessage(ev.replyToken, askLetter(LETTERS[s.idx])); }
      else { s.step='wants'; await replyMessage(ev.replyToken, askResult()); }
      continue;
    }
    if (s.step === 'wants') {
      const wants = parseWants(text); s.data.wants = wants;
      await replyMessage(ev.replyToken, { type:'text', text:'分析處理中，請稍候…' });

      // 讀教材規則 → 單點
      let singleText = '';
      try {
        const loaded = await loadRules(req);
        if (loaded.ok && loaded.rules) {
          singleText = renderSingleByRules(s.data.scores, loaded.rules);
        } else {
          // 備援（規則讀不到）
          const alt = [];
          for (const L of LETTERS) {
            const v = Number(s.data.scores[L] ?? 0);
            const [lvl, hint] = bandDesc(v);
            alt.push(`${NAMES[L]}：${v}｜${lvl}\n— ${hint}`);
          }
          singleText = `【A~J 單點】\n${alt.join('\n\n')}`;
        }
      } catch (e) {
        console.warn('rules load error:', e?.message || e);
        const alt = [];
        for (const L of LETTERS) {
          const v = Number(s.data.scores[L] ?? 0);
          const [lvl, hint] = bandDesc(v);
          alt.push(`${NAMES[L]}：${v}｜${lvl}\n— ${hint}`);
        }
        singleText = `【A~J 單點】\n${alt.join('\n\n')}`;
      }

      const { combo, persona } = renderSummaryAndPersona({
        name: s.data.name, gender: s.data.gender, age: s.data.age,
        maniaB: s.data.maniaB, maniaE: s.data.maniaE, scores: s.data.scores,
      });

      const outMsgs = [];
      if (!wants || wants.single)  outMsgs.push({ type:'text', text: singleText.slice(0,5000) });
      if (!wants || wants.combo)   outMsgs.push({ type:'text', text: combo.slice(0,5000) });
      if (!wants || wants.persona) outMsgs.push({ type:'text', text: persona.slice(0,5000) });

      const first = outMsgs.splice(0, 5);
      if (outMsgs.length) await pushMessage(userId, outMsgs);
      await replyMessage(ev.replyToken, first);

      resetSession(userId);
      continue;
    }

    await replyMessage(ev.replyToken, withQR('輸入「重新開始」可重來。', [qi('重新開始','重新開始')]));
  }

  res.status(200).json({ ok: true });
}
