// /api/form.js
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const liffId = process.env.LIFF_ID || '';

  res.status(200).send(`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OCA 填表</title>
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;padding:16px;line-height:1.5}
  h2{margin:0 0 12px}
  fieldset{border:1px solid #eee;border-radius:8px;padding:12px;margin:12px 0}
  label{display:block;margin:6px 0}
  input[type=number]{width:100px}
  .row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  button{padding:10px 14px;border:0;border-radius:8px;background:#06c;color:#fff;font-weight:600}
</style>
</head>
<body>
  <h2>OCA 填表</h2>

  <form id="f">
    <fieldset>
      <legend>基本資料</legend>
      <label>姓名（必填）<br><input name="name" required></label>
      <div class="row">
        <label>年齡（≥14，必填）<br><input name="age" type="number" min="14" required></label>
        <label>性別<br>
          <select name="gender">
            <option value="">不填</option>
            <option>男</option><option>女</option><option>其他</option>
          </select>
        </label>
      </div>
      <label>日期<br><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}"></label>
      <label><input type="checkbox" name="maniaB"> 躁狂（B 情緒）</label>
    </fieldset>

    <fieldset>
      <legend>A~J 分數（-100 ~ 100）</legend>
      <div class="row">
        ${['A','B','C','D','E','F','G','H','I','J'].map(k=>`
          <label>${k}: <input type="number" name="${k}" min="-100" max="100" value="0" required></label>
        `).join('')}
      </div>
    </fieldset>

    <fieldset>
      <legend>想看的內容</legend>
      <label><input type="checkbox" name="wantSingle" checked> A~J 單點解析</label>
      <label><input type="checkbox" name="wantCombine" checked> 綜合分析＋痛點</label>
      <label><input type="checkbox" name="wantProfile" checked> 人物側寫</label>
    </fieldset>

    <button type="submit">送出</button>
  </form>

  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script>
  const liffId='${liffId}';
  let userId='';

  (async ()=>{
    if(liffId){
      try{
        await liff.init({ liffId });
        if(!liff.isLoggedIn()){ liff.login(); return; }
        const p = await liff.getProfile();
        userId = p.userId || '';
      }catch(e){ console.log('LIFF init 失敗:', e); }
    }
  })();

  document.getElementById('f').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      gender: fd.get('gender') || null,
      age: Number(fd.get('age')),
      date: fd.get('date'),
      A: Number(fd.get('A')), B: Number(fd.get('B')), C: Number(fd.get('C')), D: Number(fd.get('D')),
      E: Number(fd.get('E')), F: Number(fd.get('F')), G: Number(fd.get('G')), H: Number(fd.get('H')),
      I: Number(fd.get('I')), J: Number(fd.get('J')),
      mania: { B: !!fd.get('maniaB'), E: false },
      want: {
        single: !!fd.get('wantSingle'),
        combine: !!fd.get('wantCombine'),
        profile: !!fd.get('wantProfile')
      },
      userId
    };
    if(!payload.name || !(payload.age>=14)){ alert('姓名必填、年齡需 ≥14。'); return; }

    const r = await fetch('/api/submit-oca', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    let text = '已送出，請回到 LINE 查看分析結果。';
    try{ const j = await r.json(); if(!j.ok){ text = '送出失敗：'+(j.error||r.status); } }catch(_) {}
    alert(text);
  });
  </script>
</body>
</html>`);
};
