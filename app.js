/**
 * 営業リスト作成ツール - フロントエンド
 * 地域×業種で企業情報を収集してリスト化する
 */

// グローバル変数
var results = [];
var currentPage = 0;
var lastQuery = '';
var lastMaxPerBatch = 200;

// 検索実行
async function startSearch() {
  var prefecture = document.getElementById('prefectureSelect').value;
  var city = document.getElementById('cityInput').value.trim();
  var industry = document.getElementById('industryInput').value.trim();
  var maxResults = parseInt(document.getElementById('maxResults').value);

  if (!prefecture) { alert('都道府県を選択してください'); return; }
  if (!industry) { alert('業種を入力してください'); return; }

  var btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.classList.add('searching');
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>検索中...</span>';

  var progressSection = document.getElementById('progressSection');
  var progressBar = document.getElementById('progressBar');
  var progressText = document.getElementById('progressText');
  progressSection.classList.remove('hidden');
  progressBar.style.width = '5%';
  progressText.textContent = '🔍 ' + prefecture + (city ? city : '') + 'の' + industry + 'を検索中...';

  document.getElementById('summarySection').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  hideLoadMore();
  results = [];
  currentPage = 0;

  try {
    // バックエンドAPI呼び出し（複数ページ対応）
    var query = prefecture + (city ? ' ' + city : '') + ' ' + industry;
    lastQuery = query;
    lastMaxPerBatch = maxResults;
    var totalPages = Math.ceil(maxResults / 50);

    progressBar.style.width = '10%';
    progressText.textContent = '🏢 企業情報を取得中...';

    for (var page = currentPage + 1; page <= currentPage + totalPages; page++) {
      var params = 'query=' + encodeURIComponent(query) + '&max=50&page=' + page;
      var response = await fetch('/api/search?' + params);
      var data = await response.json();

      if (data.error) {
        if (page === 1) throw new Error(data.error);
        break;
      }

      var pageResults = data.results || [];
      if (pageResults.length === 0) break;

      results = results.concat(pageResults);

      var pct = Math.min(10 + (page / totalPages) * 80, 90);
      progressBar.style.width = pct + '%';
      progressText.textContent = '🏢 ' + results.length + '件取得済み... (ページ ' + page + '/' + totalPages + ')';

      if (results.length >= currentPage * 50 + maxResults || pageResults.length < 50) break;
    }

    // ページオフセット更新
    currentPage += totalPages;

    // maxResultsで切る
    if (results.length > maxResults) results = results.slice(0, maxResults);

    progressBar.style.width = '85%';
    progressText.textContent = '📧 メールアドレスを取得中...';

    // テーブル描画（メアド取得前に表示）
    updateSummary(results);
    renderResults(results);

    // HPがある企業のメアドを取得
    var withWebsite = results.filter(function(r) { return r.website; });
    for (var i = 0; i < withWebsite.length; i++) {
      try {
        var emailRes = await fetch('/api/email?url=' + encodeURIComponent(withWebsite[i].website));
        var emailData = await emailRes.json();
        if (emailData.email) {
          withWebsite[i].email = emailData.email;
        }
      } catch(e) {}
      var emailPct = 85 + (i / withWebsite.length) * 14;
      progressBar.style.width = emailPct + '%';
      progressText.textContent = '📧 メアド取得中... (' + (i+1) + '/' + withWebsite.length + ')';
      // 途中経過も反映
      updateSummary(results);
      renderResults(results);
    }

    progressBar.style.width = '100%';
    var emailCount = results.filter(function(r) { return r.email; }).length;
    progressText.textContent = '✅ 完了！ ' + results.length + '件取得 / メアド ' + emailCount + '件';

    updateSummary(results);
    renderResults(results);

    setTimeout(function() {
      progressSection.classList.add('hidden');
    }, 3000);

    // もっと読み込むボタン表示
    showLoadMore();

  } catch (err) {
    progressBar.style.width = '100%';
    progressBar.style.background = '#e74c3c';
    progressText.textContent = '❌ エラー: ' + err.message;
  }

  btn.disabled = false;
  btn.classList.remove('searching');
  btn.innerHTML = '<span class="btn-icon">🚀</span><span>リスト作成開始</span>';
}

// サマリー更新
function updateSummary(items) {
  document.getElementById('summarySection').classList.remove('hidden');
  document.getElementById('totalCount').textContent = items.length;
  document.getElementById('phoneCount').textContent = items.filter(function(i) { return i.phone; }).length;
  document.getElementById('websiteCount').textContent = items.filter(function(i) { return i.website; }).length;
  document.getElementById('ratingCount').textContent = items.filter(function(i) { return i.email; }).length;
}

// テーブル描画
function renderResults(items) {
  var section = document.getElementById('resultsSection');
  var tbody = document.getElementById('resultsBody');
  section.classList.remove('hidden');
  tbody.innerHTML = '';

  items.forEach(function(item, idx) {
    var tr = document.createElement('tr');

    var websiteHtml = item.website
      ? '<a href="' + esc(item.website) + '" target="_blank">🔗 開く</a>'
      : '<span class="no-data">-</span>';

    var phoneHtml = item.phone
      ? '<a href="tel:' + esc(item.phone) + '">' + esc(item.phone) + '</a>'
      : '<span class="no-data">-</span>';

    var emailHtml = item.email
      ? '<a href="mailto:' + esc(item.email) + '">' + esc(item.email) + '</a>'
      : '<span class="no-data">-</span>';

    tr.innerHTML =
      '<td>' + (idx + 1) + '</td>' +
      '<td><strong>' + esc(item.name || '') + '</strong></td>' +
      '<td>' + esc(item.address || '') + '</td>' +
      '<td>' + phoneHtml + '</td>' +
      '<td>' + emailHtml + '</td>' +
      '<td>' + websiteHtml + '</td>';

    tbody.appendChild(tr);
  });
}

// CSVダウンロード
function exportCSV() {
  if (results.length === 0) { alert('データがありません'); return; }

  var bom = '\uFEFF';
  var header = '会社名,住所,電話番号,メールアドレス,ウェブサイト\n';
  var rows = results.map(function(item) {
    return [
      csvEscape(item.name || ''),
      csvEscape(item.address || ''),
      csvEscape(item.phone || ''),
      csvEscape(item.email || ''),
      csvEscape(item.website || ''),
    ].join(',');
  }).join('\n');

  var blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var prefecture = document.getElementById('prefectureSelect').value;
  var industry = document.getElementById('industryInput').value;
  a.download = prefecture + '_' + industry + '_リスト.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// クリップボードにコピー
function copyToClipboard() {
  if (results.length === 0) { alert('データがありません'); return; }

  var text = results.map(function(item, i) {
    return (i + 1) + '. ' + (item.name || '') + '\n' +
      '   住所: ' + (item.address || '-') + '\n' +
      '   電話: ' + (item.phone || '-') + '\n' +
      '   HP: ' + (item.website || '-') + '\n' +
      '   評価: ' + (item.rating || '-') + ' (' + (item.reviews || 0) + '件)';
  }).join('\n\n');

  navigator.clipboard.writeText(text).then(function() {
    var btn = document.querySelector('.btn-export.copy');
    btn.textContent = '✅ コピーしました！';
    setTimeout(function() { btn.textContent = '📋 コピー'; }, 2000);
  });
}

// ユーティリティ
function esc(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function csvEscape(str) {
  if (!str) return '';
  if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// もっと読み込む
async function loadMore() {
  var btn = document.getElementById('loadMoreBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 追加取得中...';

  var progressSection = document.getElementById('progressSection');
  var progressBar = document.getElementById('progressBar');
  var progressText = document.getElementById('progressText');
  progressSection.classList.remove('hidden');
  progressBar.style.width = '5%';
  progressBar.style.background = '';

  var totalPages = Math.ceil(lastMaxPerBatch / 50);
  var prevCount = results.length;

  try {
    for (var page = currentPage + 1; page <= currentPage + totalPages; page++) {
      var params = 'query=' + encodeURIComponent(lastQuery) + '&max=50&page=' + page;
      var response = await fetch('/api/search?' + params);
      var data = await response.json();

      var pageResults = data.results || [];
      if (pageResults.length === 0) break;

      results = results.concat(pageResults);

      var pct = Math.min(10 + ((page - currentPage) / totalPages) * 70, 80);
      progressBar.style.width = pct + '%';
      progressText.textContent = '🏢 追加 ' + (results.length - prevCount) + '件取得中... (ページ ' + page + ')';

      if (pageResults.length < 50) break;
    }

    currentPage += totalPages;

    // 新しく取得した分のメアドを取得
    progressBar.style.width = '85%';
    progressText.textContent = '📧 メアド取得中...';

    var newItems = results.slice(prevCount);
    var withWebsite = newItems.filter(function(r) { return r.website; });
    for (var i = 0; i < withWebsite.length; i++) {
      try {
        var emailRes = await fetch('/api/email?url=' + encodeURIComponent(withWebsite[i].website));
        var emailData = await emailRes.json();
        if (emailData.email) withWebsite[i].email = emailData.email;
      } catch(e) {}
      progressText.textContent = '📧 メアド取得中... (' + (i+1) + '/' + withWebsite.length + ')';
    }

    var added = results.length - prevCount;
    progressBar.style.width = '100%';
    progressText.textContent = '✅ 追加 ' + added + '件！ 合計 ' + results.length + '件';

    updateSummary(results);
    renderResults(results);

    setTimeout(function() { progressSection.classList.add('hidden'); }, 3000);

  } catch(e) {
    progressText.textContent = '❌ エラー: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = '➕ もっと読み込む（次の' + lastMaxPerBatch + '件）';
}

function showLoadMore() {
  var el = document.getElementById('loadMoreSection');
  if (el) { el.classList.remove('hidden'); return; }
  el = document.createElement('div');
  el.id = 'loadMoreSection';
  el.style.cssText = 'text-align:center;padding:16px;';
  el.innerHTML = '<button id="loadMoreBtn" class="btn-search" onclick="loadMore()" style="background:linear-gradient(135deg,#059669,#047857)">' +
    '<span class="btn-icon">➕</span><span>もっと読み込む（次の' + lastMaxPerBatch + '件）</span></button>';
  var footer = document.querySelector('.app-footer');
  footer.parentNode.insertBefore(el, footer);
}

function hideLoadMore() {
  var el = document.getElementById('loadMoreSection');
  if (el) el.classList.add('hidden');
}
