/**
 * 営業リスト作成ツール - フロントエンド
 * 地域×業種で企業情報を収集してリスト化する
 */

// グローバル変数
var results = [];

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
  results = [];

  try {
    // バックエンドAPI呼び出し
    var query = prefecture + (city ? ' ' + city : '') + ' ' + industry;
    var params = 'query=' + encodeURIComponent(query) + '&max=' + maxResults;

    progressBar.style.width = '20%';
    progressText.textContent = '🏢 企業情報を取得中...';

    var response = await fetch('/api/search?' + params);
    var data = await response.json();

    progressBar.style.width = '70%';
    progressText.textContent = '📊 データを整理中...';

    if (data.error) {
      throw new Error(data.error);
    }

    results = data.results || [];

    progressBar.style.width = '100%';
    progressText.textContent = '✅ 完了！ ' + results.length + '件取得';

    // サマリー更新
    updateSummary(results);

    // テーブル描画
    renderResults(results);

    // 少し待ってから進捗を隠す
    setTimeout(function() {
      progressSection.classList.add('hidden');
    }, 2000);

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
  document.getElementById('ratingCount').textContent = items.filter(function(i) { return i.rating; }).length;
}

// テーブル描画
function renderResults(items) {
  var section = document.getElementById('resultsSection');
  var tbody = document.getElementById('resultsBody');
  section.classList.remove('hidden');
  tbody.innerHTML = '';

  items.forEach(function(item, idx) {
    var tr = document.createElement('tr');

    var ratingHtml = item.rating
      ? '<span class="rating-stars">' + '⭐'.repeat(Math.round(item.rating)) + '</span> ' + item.rating
      : '<span class="no-data">-</span>';

    var websiteHtml = item.website
      ? '<a href="' + esc(item.website) + '" target="_blank">🔗 開く</a>'
      : '<span class="no-data">-</span>';

    var phoneHtml = item.phone
      ? '<a href="tel:' + esc(item.phone) + '">' + esc(item.phone) + '</a>'
      : '<span class="no-data">-</span>';

    tr.innerHTML =
      '<td>' + (idx + 1) + '</td>' +
      '<td><strong>' + esc(item.name || '') + '</strong></td>' +
      '<td>' + esc(item.address || '') + '</td>' +
      '<td>' + phoneHtml + '</td>' +
      '<td>' + websiteHtml + '</td>' +
      '<td>' + ratingHtml + '</td>' +
      '<td>' + (item.reviews || '<span class="no-data">-</span>') + '</td>';

    tbody.appendChild(tr);
  });
}

// CSVダウンロード
function exportCSV() {
  if (results.length === 0) { alert('データがありません'); return; }

  var bom = '\uFEFF';
  var header = '会社名,住所,電話番号,ウェブサイト,評価,口コミ数\n';
  var rows = results.map(function(item) {
    return [
      csvEscape(item.name || ''),
      csvEscape(item.address || ''),
      csvEscape(item.phone || ''),
      csvEscape(item.website || ''),
      item.rating || '',
      item.reviews || '',
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
