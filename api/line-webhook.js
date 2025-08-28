// api/line-webhook.js
// CommonJS + 簽章驗證（Production 強制）+ 圖片 OCR 擷取 A~J
const crypto = require('crypto');
const { Client } = require('@line/bot-sdk');
const Tesseract = require('tesseract.js');

// 你需要在 Vercel 專案環境變數設定：
// LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET
const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
});

// ---------- 工具：讀 raw body 做簽章驗證 ----------
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function verifySignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------- Webhook 入口 ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const isProd = (process.env.VERCEL_ENV === 'production') || (process.env.NODE_ENV === 'production');

    const rawBody = await readRawBody(req);
    const signature = req.headers['x-line-signature'] || '';
    const secret = process.env.LINE_CHANNEL_SECRET || '';
    const ok = verifySignature(secret, rawBody, signature);

    if (isProd && !ok) {
      console.warn('[webhook] bad signature (production)');
      return res.status(401).send('Bad signature');
    }
    if (!isProd && !ok) {
      console.warn('[webhook] signature failed (non-prod, allowed for testing)');
    }

    let body = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (e) { console.warn('JSON parse error', e); }
    const events = Array.isArray(body.events) ? body.events : [];
    await Promise.all(events.map(handleEvent));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[webhook] handler error', err);
    return res.status(200).send('OK');
  }
};

// ---------- 事件處理 ----------
async function handleEvent(event) {
  if (event.type !== 'message') return;

  const replyToken = event.replyToken;
  const userId = event?.source?.userId;

  // 文字：解析 A~J
  if (event.message.type === 'text') {
    const scores = parseScoresFromText(event.message.text);
    if (!scores) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '請輸入 A~J 分數，例如：A:10, B:-20, C:30, D:0, E:75, F:10, G:-40, H:-25, I:5, J:20'
      });
      return;
    }
    await replyWithAnalysis(replyToken, scores);
    return;
  }

  // 圖片：OCR 擷取 A~J
  if (event.message.type === 'image') {
    // 先不讓 LINE 超時：回一則短訊
    await client.replyMessage(replyToken, { type: 'text', text: '已收到圖片，我正在分析 OCA 分數（約 10~15 秒）…' });

    try {
      const buf = await downloadImageBuffer(event.message.id);
      const partial = await ocrScoresFromBuffer(buf, 15000); // 15 秒保守上限
      const scores = mergeIfComplete(partial);

      if (!scores) {
        await safePush(userId, { type: 'text', text: '暫時無法從圖片辨識出完整的 A~J 分數。建議在圖片旁貼上文字分數，例如：A:10,B:-20,... 我就能立即分析。' });
        return;
      }
      await pushAnalysis(userId, scores);
    } catch (e) {
      console.error('[OCR] error', e);
      await safePush(userId, { type: 'text', text: '分析圖片時遇到小狀況，請改用文字輸入 A~J 分數（例如 A:10,B:-20,...），我會立即回覆。' });
    }
  }
}

// ---------- 下載 LINE 圖片 ----------
async function downloadImageBuffer(messageId) {
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (e) => reject(e));
  });
}

// ---------- OCR：從圖片萃取 A~J ----------
async function ocrScoresFromBuffer(buf, timeoutMs = 15000) {
  const p = Tesseract.recognize(buf, 'eng', { logger: () => {} });
  const res = await withTimeout(p, timeoutMs);
  const text = (res && res.data && res.data.text) ? res.data.text : '';
  // console.log('[OCR] raw text:', text);
  return extractScoresFromText(text);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('OCR timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); })
           .catch((e) => { clearTimeout(t); reject(e); });
  });
}

// 把全形字、各種破折號/負號、頓號等清理成易於比對的字串
function normalize(str) {
  if (!str) return '';
  const full2half = s => s.replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const unifyMinus = s => s.replace(/[−–—﹣－ーｰ~〜]/g, '-');
  const unifyColon = s => s.replace(/[：;]/g, ':');
  return unifyColon(unifyMinus(full2half(str))).replace(/\s+/g, ' ');
}

// 從任意文字中萃取 A~J 對應的數值（-100 ~ 100）
function extractScoresFromText(text) {
  const out = {};
  const s = normalize(text);
  const re = /([A-J])\s*:?\s*([+-]?\d{1,3})/gi;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toUpperCase();
    const v = Math.max(-100, Math.min(100, parseInt(m[2], 10)));
    out[k] = v;
  }
  return out; // 可能只有部分鍵
}

function mergeIfComplete(partial) {
  if (!partial) return null;
  const keys = ['A','B','C','D','E','F','G','H','I','J'];
  const ok = keys.every(k => typeof partial[k] === 'number');
  return ok ? keys.reduce((acc,k) => (acc[k] = partial[k], acc), {}) : null;
}

// ---------- OCA 分析（與你教材口徑一致） ----------
function parseScoresFromText(text) {
  const out = extractScoresFromText(text);
  return mergeIfComplete(out);
}

function pickLabels(s) {
  const labels = [];
  if (s.C <= -20 && s.G <= -20 && s.H <= -20) labels.push('內耗型');
  if (s.E >= 40 && s.H >= 20) labels.push('開朗型');
  if (s.A >= 30 && s.D >= 30) labels.push('謹慎規劃型');
  if ((s.B >= 70 || s.E >= 70) && s.G <= -20) labels.push('行動爆衝型');
  if (s.B <= -50 && s.E <= -50) labels.push('低潮修復期');
  return labels.length ? Array.from(new Set(labels)) : ['平衡成長型'];
}
function manicFlags(s) {
  return {
    manicB: s.B >= 80 ? 'high' : s.B <= -70 ? 'low' : null,
    manicE: s.E >= 80 ? 'high' : s.E <= -70 ? 'low' : null
  };
}
function bigGaps(s) {
  const gaps = [];
  if (Math.abs(s.A - s.H) >= 60) gaps.push('想得多但說得少／表達落差');
  if (Math.abs(s.B - s.G) >= 60) gaps.push('能量高低與穩定度落差');
  return gaps;
}
function buildPersona(s) {
  const labels = pickLabels(s);
  const flags = manicFlags(s);
  const gaps = bigGaps(s);
  const pains = [];
  if (labels.includes('內耗型')) pains.push('常在心裡反覆推演，話到嘴邊又吞回去，久了容易覺得累。');
  if (labels.includes('行動爆衝型')) pains.push('一衝就全力、但後勁不足，與人互動時節奏不易對上。');
  if (labels.includes('低潮修復期')) pains.push('最近提不起勁，事情想做但能量不上來。');
  if (gaps.includes('想得多但說得少／表達落差')) pains.push('腦內方案很多，但臨場表達卡住，別人抓不到你的重點。');
  const manicHints = [];
  if (flags.manicB === 'high') manicHints.push('Manic B：行動能量很強，適合短打任務，但要留意收尾品質。');
  if (flags.manicB === 'low')  manicHints.push('B 低：動力不足，先做 10 分鐘暖身任務。');
  if (flags.manicE === 'high') manicHints.push('Manic E：社交能量高，善用協作快速拆解任務。');
  if (flags.manicE === 'low')  manicHints.push('E 低：別勉強社交，改用非同步訊息維持最低限度的溝通。');
  const talk =
`你習慣先把事情想清楚再行動，這份穩健讓人安心；
只是壓力上來時，容易把情緒收得太緊。接下來的一週，試著在重要場合前先寫三行重點：
「我想達成什麼」、「我需要對方做什麼」、「下一步是什麼」。這會讓你更自在地被理解。`;
  return { labels, pains: pains.length ? pains : ['整體平衡，持續小步快跑累積成就感即可。'], manicHints, gaps, talk };
}

// ---------- 圖表（QuickChart 網址，免安裝） ----------
function buildChartUrl(s) {
  const labels = ['A','B','C','D','E','F','G','H','I','J'];
  const data = labels.map(k => s[k]);
  const highlight = [];
  if (s.B >= 80 || s.B <= -70) highlight.push({ x: 1, y: s.B });
  if (s.E >= 80 || s.E <= -70) highlight.push({ x: 4, y: s.E });
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'OCA 曲線', data, fill: false, borderWidth: 3, tension: 0.25, pointRadius: 4 },
        { type: 'scatter', label: 'Manic B/E', data: highlight, pointRadius: 6, pointStyle: 'triangle' }
      ]
    },
    options: {
      plugins: { title: { display: true, text: 'OCA 曲線（含 Manic B/E 標註）' }, legend: { display: true } },
      scales: { y: { min: -100, max: 100, ticks: { stepSize: 20 } }, x: { grid: { display: false } } }
    }
  };
  const params = new URLSearchParams({
    width: '900', height: '500', backgroundColor: 'white', c: JSON.stringify(config)
  });
  return `https://quickchart.io/chart?${params.toString()}`;
}

function analysisText(s, persona) {
  const lines = [];
  lines.push('🔎 OCA 分析（重點）');
  lines.push(`標籤：${persona.labels.join('、')}`);
  if (persona.gaps.length) lines.push(`落差：${persona.gaps.join('、')}`);
  if (persona.manicHints.length) lines.push(`Manic 提示：\n• ${persona.manicHints.join('\n• ')}`);
  lines.push('');
  lines.push('🧍 人物側寫');
  lines.push(persona.talk);
  lines.push('');
  lines.push('😮‍💨 目前痛點');
  lines.push('• ' + persona.pains.join('\n• '));
  lines.push('');
  lines.push('📋 原始分數');
  lines.push(['A','B','C','D','E','F','G','H','I','J'].map(k => `${k}:${s[k]}`).join(', '));
  return lines.join('\n');
}

async function replyWithAnalysis(replyToken, scores) {
  const persona = buildPersona(scores);
  const chartUrl = buildChartUrl(scores);
  await client.replyMessage(replyToken, [
    { type: 'image', originalContentUrl: chartUrl, previewImageUrl: chartUrl },
    { type: 'text', text: analysisText(scores, persona) },
    { type: 'text', text: '小提醒：若你上傳的是純曲線圖，建議同時輸入 A~J 分數（例如 A:10,B:-20,...），分析會更快更準確。' }
  ]);
}
async function pushAnalysis(userId, scores) {
  const persona = buildPersona(scores);
  const chartUrl = buildChartUrl(scores);
  await safePush(userId, [
    { type: 'image', originalContentUrl: chartUrl, previewImageUrl: chartUrl },
    { type: 'text', text: analysisText(scores, persona) },
    { type: 'text', text: '小提醒：若你上傳的是純曲線圖，建議同時輸入 A~J 分數（例如 A:10,B:-20,...），分析會更快更準確。' }
  ]);
}
async function safePush(userId, message) {
  if (!userId) return;
  try { await client.pushMessage(userId, message); } catch (e) { console.error('[push] error', e); }
}
