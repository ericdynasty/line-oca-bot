// api/line-webhook.js
// v4.1 — 每步驟：reply 確認 + push 下一題（雙保險）
// 並加入 fallback：若狀態遺失但收到 1/2/3，直接當性別繼續
// 需要 package.json: { "type": "module" }, Node >= 18

import { Client } from '@line/bot-sdk';
import { loadRulesSafe } from './_oca_rules.js';

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
});

const MSG = {
  hello1: '您好，我是 Eric 的 OCA 助理，我會逐一詢問您每項資料，請您確實填寫，謝謝。',
  hello2: '請輸入填表人姓名：',
  cancelHint: '輸入「取消」可中止，或輸入「重新開始」隨時重來。',
  canceled: '已取消這次填寫。要再開始，請輸入「填表」或點下方按鈕。',
  restarted: '已重新開始，從頭來一次。',
  alreadyInFlow: '我們正在進行中哦～我再幫你接續目前這一題。',
};

const LETTERS = ['A','B','C','D','E','F','G','H','I','J'];
const NAMES = {
  A: '穩定性', B: '愉快', C: '鎮定', D: '確定力', E: '活躍',
  F: '積極',   G: '負責', H: '評估能力', I: '欣賞能力', J: '溝通能力',
};

// 🔸 簡易記憶體（雲端可能重啟，已加 fallback 邏輯減少影響）
const SESS = new Map();
function getS(uid){ if(!SESS.has(uid)) SESS.set(uid,{ step:'start', data:{}, idx:0 }); return SESS.get(uid); }
function resetS(uid){ SESS.delete(uid); }

function qr(label,text){ return { type:'action', action:{ type:'message', label, text } }; }
async function replyMessage(token, messages){
  if(!token) return;
  const arr = Array.isArray(messages)?messages:[messages];
  await client.replyMessage(token, arr);
}
async function pushMessage(to, messages){
  if(!to) return;
  const arr = Array.isArray(messages)?messages:[messages];
  await client.pushMessage(to, arr);
}

function isIntStr(s){ return /^-?\d+$/.test(String(s).trim()); }
function toInt(s){ return parseInt(String(s).trim(),10); }
function parseSex(s){
  const t = String(s).trim();
  if (['1','男','male','Male','M','m'].includes(t)) return '男';
  if (['2','女','female','Female','F','f'].includes(t)) return '女';
  if (['3','其他','無','不方便'].includes(t)) return '其他';
  return null;
}
function bandDesc(v){
  if (v >= 40) return ['高(重)', '— 偏強勢、驅動力大'];
  if (v >= 10) return ['高(輕)', '— 略偏高、傾向明顯'];
  if (v > -10) return ['中性', '— 較平衡、影響小'];
  if (v > -40) return ['低(輕)', '— 略偏低、偶爾受影響'];
  return ['低(重)', '— 不足感明顯、需特別留意'];
}
function parseWants(t){
  const s = String(t||'').trim();
  if(!s || s==='全部') return null;
  const set = new Set(s.split(/[,，\s]+/).map(x=>x.trim()).filter(Boolean));
  return { single:set.has('1'), combo:set.has('2'), persona:set.has('3') };
}
function renderSingleByRules(scores, rules){
  try{
    if(!rules || !rules.single) throw new Error('no rules');
    const lines=[];
    for(const L of LETTERS){
      const v=Number(scores[L]??0);
      const arr=rules.single?.[L];
      if(Array.isArray(arr)){
        let picked=null;
        for(const item of arr){
          const [lo,hi]=item.range??[-100,100];
          if(v>=lo && v<=hi){ picked=item; break; }
        }
        if(picked){
          lines.push(`${L} ${NAMES[L]}：${v}｜${picked.tag||'描述'}\n（教材 ${picked.ref||''}）`);
          lines.push(picked.text||'');
          lines.push('');
          continue;
        }
      }
      const [lvl,hint]=bandDesc(v);
      lines.push(`${L} ${NAMES[L]}：${v}｜${lvl}\n${hint}`);
      lines.push('');
    }
    return `【A~J 單點】\n${lines.join('\n')}`.trim();
  }catch{
    const alt=[];
    for(const L of LETTERS){
      const v=Number(scores[L]??0);
      const [lvl,hint]=bandDesc(v);
      alt.push(`${L} ${NAMES[L]}：${v}｜${lvl}\n${hint}\n`);
    }
    return `【A~J 單點】\n${alt.join('\n')}`.trim();
  }
}
function renderSummaryAndPersona(payload){
  const { maniaB, maniaE, scores } = payload;
  const sorted = LETTERS.map(L=>({L,name:NAMES[L],v:Number(scores[L]??0)})).sort((a,b)=>a.v-b.v);
  const lows  = sorted.slice(0,2);
  const highs = sorted.slice(-2).reverse();
  const maniaTextB = (maniaB!==undefined&&maniaB!==null) ? `躁狂（B 情緒）：${(+maniaB||0)>=40?'有':'無'}` : '躁狂（B 情緒）：無';
  const maniaTextE = (maniaE!==undefined&&maniaE!==null) ? `躁狂（E 點）：${(+maniaE||0)>=40?'有':'無'}` : '躁狂（E 點）：無';
  const combo =
`【綜合重點】
最需要留意／最有影響的面向：
低分：${lows.map(x=>`${x.L} ${x.name}：${x.v}`).join('、')}
高分：${highs.map(x=>`${x.L} ${x.name}：${x.v}`).join('、')}

${maniaTextB}；${maniaTextE}
．日期：${new Date().toISOString().slice(0,10).replace(/-/g,'/')}
`.trim();
  const persona =
`【人物側寫】
依據最高/最低分面做簡要觀察（示意）。`.trim();
  return { combo, persona };
}
function nextLetterPrompt(idx){
  const L = LETTERS[idx];
  return {
    type:'text',
    text:`請輸入${L} ${NAMES[L]}（-100～100）的分數：`,
    quickReply:{ items:[ qr('取消','取消'), qr('重新開始','重新開始') ] }
  };
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).send('Method Not Allowed');
  const events = (req.body && req.body.events) || [];
  res.status(200).json({ ok:true }); // 先回 200，避免 LINE 超時

  for(const ev of events){
    try{
      if(ev.type!=='message' || ev.message.type!=='text') continue;
      const userId = ev.source?.userId;
      const text   = String(ev.message.text||'').trim();
      if(!userId) continue;

      // 通用指令
      if(text==='取消'){ resetS(userId); await replyMessage(ev.replyToken, MSG.canceled); continue; }
      if(text==='重新開始' || text==='填表'){
        resetS(userId);
        const s=getS(userId); s.step='name';
        await replyMessage(ev.replyToken, { type:'text', text: MSG.hello1 });
        await pushMessage(userId, { type:'text', text:`${MSG.hello2}\n${MSG.cancelHint}` });
        continue;
      }

      const s = getS(userId);

      // ---- 智慧補位：若狀態不在 sex，但使用者直接輸入 1/2/3，就當作性別 ----
      if(s.step!=='sex' && s.step!=='start'){
        const maybeSex = parseSex(text);
        if(maybeSex && !s.data.gender){
          s.data.gender = maybeSex;
          s.step = 'age';
          await replyMessage(ev.replyToken, { type:'text', text:`性別：${maybeSex}（已記錄）` });
          await pushMessage(userId, { type:'text', text:'請輸入年齡（14～120）。', quickReply:{ items:[ qr('取消','取消') ] } });
          continue;
        }
      }

      // ---- 流程 ----
      if(s.step==='start'){
        s.step='name';
        await replyMessage(ev.replyToken, { type:'text', text: MSG.hello1 });
        await pushMessage(userId, { type:'text', text:`${MSG.hello2}\n${MSG.cancelHint}` });
        continue;
      }

      if(s.step==='name'){
        s.data.name = text.slice(0,60);
        s.step='sex';
        await replyMessage(ev.replyToken, { type:'text', text:`已記錄姓名：${s.data.name}` });
        await pushMessage(userId, {
          type:'text',
          text:'性別請選（或輸入 1/2/3）：\n1. 男　2. 女　3. 其他',
          quickReply:{ items:[ qr('1 男','1'), qr('2 女','2'), qr('3 其他','3'), qr('取消','取消') ] }
        });
        continue;
      }

      if(s.step==='sex'){
        const sex = parseSex(text);
        if(!sex){ await replyMessage(ev.replyToken,'請輸入 1/2/3 或 男/女/其他。'); continue; }
        s.data.gender = sex;
        s.step='age';
        await replyMessage(ev.replyToken, { type:'text', text:`性別：${sex}（已記錄）` });
        await pushMessage(userId, { type:'text', text:'請輸入年齡（14～120）。', quickReply:{ items:[ qr('取消','取消') ] } });
        continue;
      }

      if(s.step==='age'){
        if(!isIntStr(text)){ await replyMessage(ev.replyToken,'請輸入整數年齡（14～120）。'); continue; }
        const age = toInt(text);
        if(age<14 || age>120){ await replyMessage(ev.replyToken,'年齡超出範圍，請輸入 14～120。'); continue; }
        s.data.age=age;
        s.step='maniaB';
        await replyMessage(ev.replyToken, { type:'text', text:`年齡：${age}（已記錄）` });
        await pushMessage(userId, { type:'text', text:'請輸入躁狂 B 點（-100～100）的分數：' });
        continue;
      }

      if(s.step==='maniaB'){
        if(!isIntStr(text)){ await replyMessage(ev.replyToken,'請輸入整數（-100～100）。'); continue; }
        const v=toInt(text);
        if(v<-100 || v>100){ await replyMessage(ev.replyToken,'分數需介於 -100～100。'); continue; }
        s.data.maniaB=v;
        s.step='maniaE';
        await replyMessage(ev.replyToken, { type:'text', text:`B 點：${v}（已記錄）` });
        await pushMessage(userId, { type:'text', text:'請輸入躁狂 E 點（-100～100）的分數：' });
        continue;
      }

      if(s.step==='maniaE'){
        if(!isIntStr(text)){ await replyMessage(ev.replyToken,'請輸入整數（-100～100）。'); continue; }
        const v=toInt(text);
        if(v<-100 || v>100){ await replyMessage(ev.replyToken,'分數需介於 -100～100。'); continue; }
        s.data.maniaE=v;
        s.step='letters';
        s.data.scores={}; s.idx=0;
        await replyMessage(ev.replyToken, { type:'text', text:`E 點：${v}（已記錄）` });
        await pushMessage(userId, nextLetterPrompt(s.idx));
        continue;
      }

      if(s.step==='letters'){
        if(!isIntStr(text)){ await replyMessage(ev.replyToken,'請輸入整數（-100～100）。'); continue; }
        const v=toInt(text);
        if(v<-100 || v>100){ await replyMessage(ev.replyToken,'分數需介於 -100～100。'); continue; }
        const L=LETTERS[s.idx];
        s.data.scores[L]=v;
        s.idx++;
        if(s.idx<LETTERS.length){
          await replyMessage(ev.replyToken, { type:'text', text:`${L}：${v}（已記錄）` });
          await pushMessage(userId, nextLetterPrompt(s.idx));
        }else{
          s.step='wants';
          await replyMessage(ev.replyToken, { type:'text', text:'A~J 已完成（已記錄）' });
          await pushMessage(userId, {
            type:'text',
            text:'想看的內容（可多選，空白代表全部）：\n1. A~J 單點  2. 綜合重點  3. 人物側寫\n請輸入數字（例：1,2）或「全部」。',
            quickReply:{ items:[ qr('全部','全部'), qr('1','1'), qr('2','2'), qr('3','3') ] }
          });
        }
        continue;
      }

      if(s.step==='wants'){
        const wants=parseWants(text);
        s.data.wants=wants;

        // reply 一句，然後 push 結果
        await replyMessage(ev.replyToken, { type:'text', text:'分析處理中，請稍候…' });

        let singleText='';
        try{
          const loaded=await loadRulesSafe();
          if(loaded?.ok && loaded.rules){ singleText=renderSingleByRules(s.data.scores
