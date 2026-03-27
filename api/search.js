/**
 * 営業リスト作成ツール - バックエンドAPI
 * Google Places API (New) で企業情報を高速取得
 * iタウンページは1ページのみ取得で高速化
 */

const https = require('https');

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { query, max } = req.query;
  const maxResults = Math.min(parseInt(max) || 20, 200);

  if (!query) {
    return res.json({ error: 'queryパラメータが必要です' });
  }

  try {
    if (GOOGLE_API_KEY) {
      // Google Places API使用  — まずテスト呼び出し
      const testData = await placesTextSearch(query, null);
      console.log('Google API status:', testData.status, testData.error_message || '');
      
      if (testData.status === 'REQUEST_DENIED' || testData.status === 'OVER_QUERY_LIMIT') {
        // APIキーが無効 or 課金未設定 → iタウンページにフォールバック
        console.error('Google API拒否:', testData.error_message);
        const results = await searchITownPageFast(query, maxResults);
        return res.json({ results, source: 'itown', apiError: testData.error_message || testData.status });
      }
      
      if (testData.status === 'OK' || testData.status === 'ZERO_RESULTS') {
        const results = await processGoogleResults(testData, query, maxResults);
        return res.json({ results, source: 'google' });
      }
      
      // それ以外のステータス
      const results = await searchITownPageFast(query, maxResults);
      return res.json({ results, source: 'itown', apiError: testData.status });
    }

    // APIキーなし → iタウンページ（1ページ高速取得）
    const results = await searchITownPageFast(query, maxResults);
    return res.json({ results, source: 'itown' });

  } catch (err) {
    console.error('検索エラー:', err);
    return res.json({ error: err.message || '検索中にエラーが発生しました', results: [] });
  }
};

// ===== Google Places 結果処理 =====
async function processGoogleResults(firstData, query, maxResults) {
  const results = [];

  // 最初のレスポンスを処理
  let data = firstData;
  while (data && results.length < maxResults) {
    if (!data.results || data.results.length === 0) break;

    for (const place of data.results) {
      if (results.length >= maxResults) break;
      // 詳細取得（電話・HP）- 1件ずつ
      let phone = '', website = '';
      try {
        const d = await placesDetails(place.place_id);
        phone = d.formatted_phone_number || '';
        website = d.website || '';
      } catch(e) {}

      results.push({
        name: place.name || '',
        address: place.formatted_address || '',
        phone,
        website,
        rating: place.rating || null,
        reviews: place.user_ratings_total || null,
      });
    }

    if (!data.next_page_token || results.length >= maxResults) break;
    await new Promise(r => setTimeout(r, 2000));
    data = await placesTextSearch(query, data.next_page_token);
  }

  return results;
}

function placesTextSearch(query, pageToken) {
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${GOOGLE_API_KEY}`;
  if (pageToken) url += `&pagetoken=${pageToken}`;
  return httpGetJSON(url);
}

function placesDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&language=ja&key=${GOOGLE_API_KEY}`;
  return httpGetJSON(url).then(d => d.result || {});
}

// ===== iタウンページ 複数ページ対応版 =====
async function searchITownPageFast(query, maxResults) {
  const results = [];
  let page = 1;
  const perPage = 50;
  
  while (results.length < maxResults) {
    try {
      // iタウンページ検索（各ページ50件、ページネーション対応）
      const sr = (page - 1) * perPage + 1;
      const url = `https://itp.ne.jp/result/?kw=${encodeURIComponent(query)}&num=${perPage}&sr=${sr}`;
      const html = await httpGetText(url, 5000);
      
      // HTMLからデータ抽出
      const parsed = extractBusinessData(html);
      
      // 取得件数が0なら終了（最終ページを超えた）
      if (parsed.length === 0) break;
      
      for (const item of parsed) {
        if (results.length >= maxResults) break;
        results.push(item);
      }
      
      // 取得件数がperPage未満なら最終ページ
      if (parsed.length < perPage) break;
      
      page++;
      // 最大4ページまで（200件）
      if (page > 4) break;
      
    } catch (e) {
      console.error('iタウンページ取得エラー (ページ' + page + '):', e.message);
      break;
    }
  }

  // iタウンページから取れなかった場合、代替データソースを使用
  if (results.length === 0) {
    return await searchAlternative(query, maxResults);
  }

  return results;
}

// HTML解析 - iタウンページ
function extractBusinessData(html) {
  const results = [];
  
  // 企業情報ブロックの抽出
  // iタウンページでは各店舗がli.normalListで囲まれている
  const entryPattern = /<div class="normalHeader"[\s\S]*?<\/article>/gi;
  const entries = html.match(entryPattern) || [];
  
  // もしパターンマッチしなかったら別のパターンを試す
  if (entries.length === 0) {
    // 名前だけでも抽出を試みる
    const names = [];
    const phones = [];
    const addrs = [];
    
    // 店舗名
    const nameRx = /class="[^"]*(?:shopName|name|title)[^"]*"[^>]*>[\s\S]*?<(?:a|span)[^>]*>([^<]+)</gi;
    let m;
    while ((m = nameRx.exec(html)) !== null) {
      const n = m[1].trim();
      if (n.length > 1 && n.length < 100) names.push(n);
    }
    
    // 電話番号
    const phoneRx = /(?:tel|phone|電話)[^>]*>[\s]*([0-9\-()（）]{8,})/gi;
    while ((m = phoneRx.exec(html)) !== null) {
      phones.push(m[1].replace(/[（）()]/g,'').trim());
    }
    
    // 住所
    const addrRx = /(?:address|住所|所在地)[^>]*>([^<]{5,80})/gi;
    while ((m = addrRx.exec(html)) !== null) {
      addrs.push(m[1].trim());
    }
    
    for (let i = 0; i < names.length; i++) {
      results.push({
        name: names[i],
        address: addrs[i] || '',
        phone: phones[i] || '',
        website: '',
        rating: null,
        reviews: null,
      });
    }
    return results;
  }

  for (const entry of entries) {
    const name = extractText(entry, /class="[^"]*shopName[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)/i);
    const phone = extractText(entry, /(?:tel|phone)[^>]*>[\s]*([0-9\-]{8,})/i);
    const addr = extractText(entry, /class="[^"]*address[^"]*"[^>]*>([^<]+)/i);
    
    if (name) {
      results.push({
        name: name.trim(),
        address: (addr || '').trim(),
        phone: (phone || '').trim(),
        website: '',
        rating: null,
        reviews: null,
      });
    }
  }

  return results;
}

// 代替: Google検索結果から店舗情報を取得
async function searchAlternative(query, maxResults) {
  const results = [];
  
  try {
    // DuckDuckGo Instant Answerは企業リストには不向きなので
    // 構造化データを持つNAVITIMEやEPARK等から取得を試みる
    const url = `https://www.navitime.co.jp/category/0501/?keyword=${encodeURIComponent(query)}`;
    const html = await httpGetText(url, 4000);
    
    // 店舗名パターン
    const nameRx = /<(?:h[2-4]|a|span)[^>]*class="[^"]*(?:name|title|shop)[^"]*"[^>]*>([^<]{2,60})<\//gi;
    let m;
    while ((m = nameRx.exec(html)) !== null && results.length < maxResults) {
      results.push({
        name: m[1].trim(),
        address: '',
        phone: '',
        website: '',
        rating: null,
        reviews: null,
      });
    }
  } catch(e) {}

  // それでも空なら、ユーザーにGoogle Places APIの設定を促す
  if (results.length === 0) {
    return [{
      name: '⚠️ データ取得できませんでした',
      address: 'Google Places APIキーを設定するとより確実に取得できます',
      phone: '',
      website: '',
      rating: null,
      reviews: null,
    }];
  }

  return results;
}

function extractText(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

// ===== HTTP通信 =====
function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'LeadGen/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON解析エラー')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('タイムアウト')); });
  });
}

function httpGetText(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = 'https://itp.ne.jp' + loc;
        return httpGetText(loc, timeout).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout || 4000, () => { req.destroy(); reject(new Error('タイムアウト')); });
  });
}
