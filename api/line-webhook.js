// api/line-webhook.js
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  return res.status(200).send('OK');
}
