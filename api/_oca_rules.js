// 以 HTTP 方式載入 /data/oca_rules.json，避免 import JSON 的相容性問題
export async function loadRules(req) {
  // 取得正確的對外網址（在預覽/正式環境都成立）
  const host =
    (req?.headers?.['x-forwarded-host'] || req?.headers?.host || process.env.VERCEL_URL || 'line-oca-bot.vercel.app').toString();
  const proto = (req?.headers?.['x-forwarded-proto'] || 'https').toString();

  const base = host.startsWith('http') ? host : `${proto}://${host}`;
  const url = `${base}/data/oca_rules.json`;

  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`loadRules failed: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

export default { loadRules };
