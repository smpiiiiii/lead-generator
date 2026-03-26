/**
 * 営業リスト作成ツール - バックエンドAPI
 * Google Places APIで企業情報を取得する
 * Vercel Serverless Function
 */

const https = require('https');

// Google Places APIキー（環境変数から取得）
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { query, max } = req.query;
  const maxResults = parseInt(max) || 50;

  if (!query) {
    return res.json({ error: 'queryパラメータが必要です' });
  }

  try {
    // Google Places API使用可能チェック
    if (GOOGLE_API_KEY) {
      const results = await searchGooglePlaces(query, maxResults);
      return res.json({ results });
    }

    // APIキーなし → iタウンページスクレイピング
    const results = await searchITownPage(query, maxResults);
    return res.json({ results });

  } catch (err) {
    console.error('検索エラー:', err);
    return res.json({ error: err.message || '検索中にエラーが発生しました' });
  }
};

// ===== Google Places API =====
async function searchGooglePlaces(query, maxResults) {
  const results = [];
  let nextPageToken = null;

  while (results.length < maxResults) {
    const data = await placesTextSearch(query, nextPageToken);
    if (!data.results) break;

    for (const place of data.results) {
      if (results.length >= maxResults) break;

      // 詳細情報を取得（電話番号、HP）
      let details = {};
      try {
        details = await placesDetails(place.place_id);
      } catch (e) {}

      results.push({
        name: place.name || '',
        address: place.formatted_address || '',
        phone: details.formatted_phone_number || '',
        website: details.website || '',
        rating: place.rating || null,
        reviews: place.user_ratings_total || null,
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;

    // ページトークンの有効化待ち
    await sleep(2000);
  }

  return results;
}

function placesTextSearch(query, pageToken) {
  return new Promise((resolve, reject) => {
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${GOOGLE_API_KEY}`;
    if (pageToken) url += `&pagetoken=${pageToken}`;

    httpsGet(url).then(resolve).catch(reject);
  });
}

function placesDetails(placeId) {
  const fields = 'formatted_phone_number,website,opening_hours';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=ja&key=${GOOGLE_API_KEY}`;
  return httpsGet(url).then(data => data.result || {});
}

// ===== iタウンページ スクレイピング =====
async function searchITownPage(query, maxResults) {
  const results = [];
  let page = 1;

  while (results.length < maxResults && page <= 5) {
    try {
      const url = `https://itp.ne.jp/result/?clid=3050&cid=L01&kw=${encodeURIComponent(query)}&num=50&pg=${page}`;
      const html = await httpsGetText(url);

      // 企業情報を正規表現で抽出
      const entries = parseITownPage(html);
      if (entries.length === 0) break;

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        results.push(entry);
      }

      page++;
    } catch (e) {
      console.error('iタウンページエラー:', e.message);
      break;
    }
  }

  // iタウンページからデータが取れなかった場合、Google検索経由のフォールバック
  if (results.length === 0) {
    return await searchFallback(query, maxResults);
  }

  return results;
}

function parseITownPage(html) {
  const results = [];
  
  // 店舗・企業名の抽出
  const nameRegex = /class="[^"]*shopName[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
  const phoneRegex = /class="[^"]*telNum[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi;
  const addressRegex = /class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi;

  // 簡易パース: data-hit-item属性を持つブロックから抽出
  const blockRegex = /data-hit-item[^>]*>([\s\S]*?)(?=data-hit-item|$)/gi;
  
  let match;
  const names = [];
  const phones = [];
  const addresses = [];

  // 名前抽出
  while ((match = nameRegex.exec(html)) !== null) {
    names.push(stripTags(match[1]).trim());
  }

  // 電話番号抽出
  while ((match = phoneRegex.exec(html)) !== null) {
    const phone = stripTags(match[1]).trim().replace(/\s+/g, '');
    if (phone.match(/\d{2,}/)) phones.push(phone);
  }

  // 住所抽出
  while ((match = addressRegex.exec(html)) !== null) {
    addresses.push(stripTags(match[1]).trim());
  }

  // 組み合わせ
  for (let i = 0; i < names.length; i++) {
    results.push({
      name: names[i] || '',
      address: addresses[i] || '',
      phone: phones[i] || '',
      website: '',
      rating: null,
      reviews: null,
    });
  }

  return results;
}

// ===== フォールバック: シンプルなWeb検索 =====
async function searchFallback(query, maxResults) {
  // Google Custom Search APIがない場合はダミーではなくエラーを返す
  return [];
}

// ===== ユーティリティ =====
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LeadGenerator/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSONパースエラー')); }
      });
    }).on('error', reject);
  });
}

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      }
    }, (res) => {
      // リダイレクト対応
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function stripTags(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
