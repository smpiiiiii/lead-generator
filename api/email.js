/**
 * メアド取得API
 * 企業HPからメールアドレスを自動抽出する
 */

const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;

  if (!url) {
    return res.json({ email: '', error: 'urlパラメータが必要です' });
  }

  try {
    const html = await fetchPage(url, 4000);
    const emails = extractEmails(html);
    // 最も営業向けっぽいメアドを選択
    const bestEmail = pickBestEmail(emails);
    return res.json({ email: bestEmail, allEmails: emails.slice(0, 3) });
  } catch (e) {
    return res.json({ email: '', error: e.message });
  }
};

/**
 * メアド抽出（正規表現）
 */
function extractEmails(html) {
  if (!html) return [];

  // HTMLデコード
  const decoded = html
    .replace(/&#64;/g, '@')
    .replace(/&#x40;/g, '@')
    .replace(/\[at\]/gi, '@')
    .replace(/（at）/g, '@')
    .replace(/ at /gi, '@')
    .replace(/\[dot\]/gi, '.')
    .replace(/（dot）/g, '.');

  // mailto:リンクから取得
  const mailtoRx = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const generalRx = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

  const found = new Set();

  let m;
  while ((m = mailtoRx.exec(decoded)) !== null) {
    found.add(m[1].toLowerCase());
  }
  while ((m = generalRx.exec(decoded)) !== null) {
    const email = m[0].toLowerCase();
    // 画像やCSSファイルのパスを除外
    if (!email.endsWith('.png') && !email.endsWith('.jpg') &&
        !email.endsWith('.gif') && !email.endsWith('.css') &&
        !email.endsWith('.js') && !email.includes('example.com') &&
        !email.includes('sentry') && !email.includes('webpack')) {
      found.add(email);
    }
  }

  return Array.from(found);
}

/**
 * 営業向けに最適なメアドを選択
 */
function pickBestEmail(emails) {
  if (emails.length === 0) return '';
  if (emails.length === 1) return emails[0];

  // 優先順位: info@ > contact@ > mail@ > その他
  const priority = ['info@', 'contact@', 'mail@', 'support@', 'office@', 'admin@'];
  for (const prefix of priority) {
    const match = emails.find(e => e.startsWith(prefix));
    if (match) return match;
  }

  return emails[0];
}

/**
 * ページ取得（HTTP/HTTPS対応）
 */
function fetchPage(url, timeout) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja',
      }
    }, (res) => {
      // リダイレクト対応
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) {
          const u = new URL(url);
          loc = u.origin + loc;
        }
        return fetchPage(loc, timeout).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf-8');
      // 最大500KB
      res.on('data', c => {
        data += c;
        if (data.length > 500000) { req.destroy(); resolve(data); }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout || 4000, () => { req.destroy(); reject(new Error('タイムアウト')); });
  });
}
