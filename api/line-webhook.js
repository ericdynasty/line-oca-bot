// api/line-webhook.js
// CommonJS + 簽章驗證（Production 強制驗簽；非 Production 失敗則放行但寫入警告）
const crypto = require('crypto');
const { Client } = require('@line/bot-sdk');

// 用來回覆訊息（別忘了在 Vercel 專案環境變數設定 LINE_CHANNEL_ACCESS_TOKEN）
const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
});

// ---------- 簽章驗證工具 ----------
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
  // 讓你用瀏覽器 GET /api/line-webhook 檢查路由是否存在
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const isProd = (process.env.VERCEL_ENV === 'production') || (process.env.NODE_ENV === 'production');

    // 一定要用「原始字串」做驗簽
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

    // 驗簽之後再 parse
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      console.warn('[webhook] JSON parse error:', e);
      body = {};
    }

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

  if (event.message.type === 'image') {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '已收到圖片～目前先用文字輸入 A~J 分數，我會更快更準確地回覆你喔。'
    });
  }
}

// ---------- OCA 分析（依你的教材口徑，生活化話術） ----------
function parseScoresFromText(text) {
  const map = {};
  const regex = /([A-J])\s*:?\s*(-?\d{1,3})/gi;
  let m;
  while ((m = regex.exec(text))) {
    const k = m[1].toUpperCase();
    const v = Math.max(-100, Math.min(100, parseInt(m[2], 10)));
    map[k] = v;
  }
  const keys = ['A','B','C','D','E','F','G','H','I','J'];
  if (keys.every(k => typeof map[k] === 'number')) return map;
  return null;
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

// 用 QuickChart 網址產圖（免安裝額外套件）
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
    width: '900',
    height: '500',
    backgroundColor: 'white',
    c: JSON.stringify(config)
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
