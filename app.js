/**
 * 営業リスト作成ツール - フロントエンド
 * 地域×業種で企業情報を収集してリスト化する
 * 改善: ローカル保存、重複排除、メアド並列化、ソート・フィルター、お気に入り
 */

// グローバル変数
var results = [];
var currentPage = 0;
var lastQuery = '';
var lastMaxPerBatch = 200;
var sortState = { column: null, asc: true };
var filterState = { keyword: '', hasEmail: false, hasPhone: false, favOnly: false };

// === #1 ローカル保存 ===

/**
 * 結果をLocalStorageに保存
 */
function saveToLocal() {
  try {
    var data = {
      results: results,
      lastQuery: lastQuery,
      currentPage: currentPage,
      lastMaxPerBatch: lastMaxPerBatch,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('leadgen_data', JSON.stringify(data));
  } catch (e) {
    console.warn('ローカル保存失敗:', e);
  }
}

/**
 * LocalStorageから結果を復元
 */
function loadFromLocal() {
  try {
    var saved = localStorage.getItem('leadgen_data');
    if (!saved) return false;
    var data = JSON.parse(saved);
    if (!data.results || data.results.length === 0) return false;
    results = data.results;
    lastQuery = data.lastQuery || '';
    currentPage = data.currentPage || 0;
    lastMaxPerBatch = data.lastMaxPerBatch || 200;
    return true;
  } catch (e) {
    return false;
  }
}

// ページ読み込み時に復元
window.addEventListener('DOMContentLoaded', function() {
  if (loadFromLocal()) {
    updateSummary(results);
    renderResults(results);
    showLoadMore();
    // 保存日時を表示
    try {
      var data = JSON.parse(localStorage.getItem('leadgen_data'));
      if (data && data.savedAt) {
        var d = new Date(data.savedAt);
        var label = d.getMonth() + 1 + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
        showToast('📂 前回の結果を復元しました（' + label + '）');
      }
    } catch(e) {}
  }
});

// === #2 重複排除 ===

/**
 * 企業名+電話番号で重複を判定して排除
 */
function deduplicateResults(items) {
  var seen = {};
  var unique = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    // 名前を正規化（スペース除去、小文字化）
    var normName = (item.name || '').replace(/[\s　]/g, '').toLowerCase();
    var normPhone = (item.phone || '').replace(/[\-\s]/g, '');
    var key = normName + '|' + normPhone;
    if (!seen[key]) {
      seen[key] = true;
      unique.push(item);
    }
  }
  return unique;
}

// === #3 メアド並列取得 ===

/**
 * 複数URLのメアドを並列で取得（concurrency件ずつ）
 */
async function fetchEmailsBatch(items, concurrency, onProgress) {
  var withWebsite = items.filter(function(r) { return r.website && !r.email; });
  var completed = 0;

  for (var i = 0; i < withWebsite.length; i += concurrency) {
    var batch = withWebsite.slice(i, i + concurrency);
    var promises = batch.map(function(item) {
      return fetch('/api/email?url=' + encodeURIComponent(item.website))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.email) item.email = data.email;
        })
        .catch(function() {});
    });
    await Promise.all(promises);
    completed += batch.length;
    if (onProgress) onProgress(completed, withWebsite.length);
  }
}

// === 検索実行 ===
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
  progressBar.style.background = '';
  progressText.textContent = '🔍 ' + prefecture + (city ? city : '') + 'の' + industry + 'を検索中...';

  document.getElementById('summarySection').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  hideLoadMore();
  results = [];
  currentPage = 0;

  try {
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

      var pct = Math.min(10 + (page / totalPages) * 70, 80);
      progressBar.style.width = pct + '%';
      progressText.textContent = '🏢 ' + results.length + '件取得済み... (ページ ' + page + '/' + totalPages + ')';

      if (results.length >= currentPage * 50 + maxResults || pageResults.length < 50) break;
    }

    currentPage += totalPages;

    // maxResultsで切る
    if (results.length > maxResults) results = results.slice(0, maxResults);

    // 重複排除
    var beforeCount = results.length;
    results = deduplicateResults(results);
    var dupCount = beforeCount - results.length;

    progressBar.style.width = '82%';
    progressText.textContent = '📧 メールアドレスを取得中...（5件並列）';

    // テーブル描画（メアド取得前に表示）
    updateSummary(results);
    renderResults(results);

    // メアド並列取得（5件ずつ）
    await fetchEmailsBatch(results, 5, function(done, total) {
      var emailPct = 82 + (done / total) * 16;
      progressBar.style.width = emailPct + '%';
      progressText.textContent = '📧 メアド取得中... (' + done + '/' + total + ')';
      updateSummary(results);
      renderResults(results);
    });

    progressBar.style.width = '100%';
    var emailCount = results.filter(function(r) { return r.email; }).length;
    var dupMsg = dupCount > 0 ? ' / 重複' + dupCount + '件除外' : '';
    progressText.textContent = '✅ 完了！ ' + results.length + '件取得 / メアド ' + emailCount + '件' + dupMsg;

    updateSummary(results);
    renderResults(results);
    saveToLocal(); // ローカル保存

    setTimeout(function() {
      progressSection.classList.add('hidden');
    }, 3000);

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

// === サマリー更新 ===
function updateSummary(items) {
  document.getElementById('summarySection').classList.remove('hidden');
  document.getElementById('totalCount').textContent = items.length;
  document.getElementById('phoneCount').textContent = items.filter(function(i) { return i.phone; }).length;
  document.getElementById('websiteCount').textContent = items.filter(function(i) { return i.website; }).length;
  document.getElementById('ratingCount').textContent = items.filter(function(i) { return i.email; }).length;
}

// === #4 ソート・フィルター付きテーブル描画 ===

function getFilteredSortedResults() {
  var items = results.slice(); // コピー

  // フィルター
  if (filterState.keyword) {
    var kw = filterState.keyword.toLowerCase();
    items = items.filter(function(r) {
      return (r.name || '').toLowerCase().indexOf(kw) >= 0 ||
             (r.address || '').toLowerCase().indexOf(kw) >= 0;
    });
  }
  if (filterState.hasEmail) {
    items = items.filter(function(r) { return r.email; });
  }
  if (filterState.hasPhone) {
    items = items.filter(function(r) { return r.phone; });
  }
  if (filterState.favOnly) {
    items = items.filter(function(r) { return r._fav; });
  }

  // ソート
  if (sortState.column !== null) {
    var col = sortState.column;
    var asc = sortState.asc;
    items.sort(function(a, b) {
      var va = (a[col] || '').toString().toLowerCase();
      var vb = (b[col] || '').toString().toLowerCase();
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });
  }

  return items;
}

function renderResults(items) {
  var section = document.getElementById('resultsSection');
  var tbody = document.getElementById('resultsBody');
  section.classList.remove('hidden');

  var filtered = getFilteredSortedResults();
  tbody.innerHTML = '';

  // フィルター結果カウント
  var countEl = document.getElementById('filterCount');
  if (countEl) {
    if (filterState.keyword || filterState.hasEmail || filterState.hasPhone || filterState.favOnly) {
      countEl.textContent = results.length + '件中 ' + filtered.length + '件表示';
      countEl.style.display = '';
    } else {
      countEl.style.display = 'none';
    }
  }

  filtered.forEach(function(item, idx) {
    var tr = document.createElement('tr');
    if (item._fav) tr.classList.add('fav-row');

    var websiteHtml = item.website
      ? '<a href="' + esc(item.website) + '" target="_blank">🔗 開く</a>'
      : '<span class="no-data">-</span>';

    var phoneHtml = item.phone
      ? '<a href="tel:' + esc(item.phone) + '">' + esc(item.phone) + '</a>'
      : '<span class="no-data">-</span>';

    var emailHtml = item.email
      ? '<a href="mailto:' + esc(item.email) + '">' + esc(item.email) + '</a>'
      : '<span class="no-data">-</span>';

    // Googleマップリンク
    var mapLink = item.address
      ? ' <a href="https://maps.google.com/maps?q=' + encodeURIComponent(item.address) + '" target="_blank" class="map-link" title="マップで見る">📍</a>'
      : '';

    // お気に入りボタン
    var favClass = item._fav ? 'fav-btn active' : 'fav-btn';
    var favBtn = '<button class="' + favClass + '" onclick="toggleFav(' + results.indexOf(item) + ')">★</button>';

    tr.innerHTML =
      '<td>' + favBtn + '</td>' +
      '<td><strong>' + esc(item.name || '') + '</strong></td>' +
      '<td>' + esc(item.address || '') + mapLink + '</td>' +
      '<td>' + phoneHtml + '</td>' +
      '<td>' + emailHtml + '</td>' +
      '<td>' + websiteHtml + '</td>';

    tbody.appendChild(tr);
  });
}

// === #5 お気に入り機能 ===

function toggleFav(idx) {
  if (idx >= 0 && idx < results.length) {
    results[idx]._fav = !results[idx]._fav;
    renderResults(results);
    saveToLocal();
  }
}

// === ソートヘッダークリック ===
function sortBy(column) {
  if (sortState.column === column) {
    sortState.asc = !sortState.asc;
  } else {
    sortState.column = column;
    sortState.asc = true;
  }
  // ヘッダーの矢印更新
  document.querySelectorAll('th[data-sort]').forEach(function(th) {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-sort') === column) {
      th.classList.add(sortState.asc ? 'sort-asc' : 'sort-desc');
    }
  });
  renderResults(results);
}

// === フィルタイベント ===
document.addEventListener('DOMContentLoaded', function() {
  // キーワード検索
  var searchInput = document.getElementById('tableSearch');
  if (searchInput) {
    var searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var val = this.value;
      searchTimer = setTimeout(function() {
        filterState.keyword = val.trim();
        renderResults(results);
      }, 200);
    });
  }

  // フィルターチップ
  document.querySelectorAll('.filter-chip-lead').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var filter = chip.getAttribute('data-filter');
      if (filter === 'email') filterState.hasEmail = !filterState.hasEmail;
      if (filter === 'phone') filterState.hasPhone = !filterState.hasPhone;
      if (filter === 'fav') filterState.favOnly = !filterState.favOnly;
      chip.classList.toggle('active');
      renderResults(results);
    });
  });
});

// === CSVダウンロード（お気に入り対応）===
function exportCSV() {
  var items = filterState.favOnly
    ? results.filter(function(r) { return r._fav; })
    : getFilteredSortedResults();

  if (items.length === 0) { alert('データがありません'); return; }

  var bom = '\uFEFF';
  var header = '会社名,住所,電話番号,メールアドレス,ウェブサイト,お気に入り\n';
  var rows = items.map(function(item) {
    return [
      csvEscape(item.name || ''),
      csvEscape(item.address || ''),
      csvEscape(item.phone || ''),
      csvEscape(item.email || ''),
      csvEscape(item.website || ''),
      item._fav ? '★' : '',
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
  var items = getFilteredSortedResults();
  if (items.length === 0) { alert('データがありません'); return; }

  var text = items.map(function(item, i) {
    return (i + 1) + '. ' + (item.name || '') + (item._fav ? ' ★' : '') + '\n' +
      '   住所: ' + (item.address || '-') + '\n' +
      '   電話: ' + (item.phone || '-') + '\n' +
      '   メアド: ' + (item.email || '-') + '\n' +
      '   HP: ' + (item.website || '-');
  }).join('\n\n');

  navigator.clipboard.writeText(text).then(function() {
    var btn = document.querySelector('.btn-export.copy');
    btn.textContent = '✅ コピーしました！';
    setTimeout(function() { btn.textContent = '📋 コピー'; }, 2000);
  });
}

// === データクリア ===
function clearData() {
  if (!confirm('保存されたデータをすべて削除しますか？')) return;
  results = [];
  localStorage.removeItem('leadgen_data');
  document.getElementById('summarySection').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  hideLoadMore();
  showToast('🗑️ データを削除しました');
}

// === ユーティリティ ===
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

function showToast(msg) {
  var existing = document.getElementById('leadToast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'leadToast';
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a3a;color:#e8e8f0;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:999;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 20px rgba(0,0,0,0.4);animation:fadeIn .3s ease';
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

// === もっと読み込む ===
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

    // 重複排除
    results = deduplicateResults(results);

    // メアド並列取得
    progressBar.style.width = '82%';
    progressText.textContent = '📧 メアド取得中...（5件並列）';

    var newItems = results.slice(prevCount);
    await fetchEmailsBatch(newItems, 5, function(done, total) {
      progressText.textContent = '📧 メアド取得中... (' + done + '/' + total + ')';
    });

    var added = results.length - prevCount;
    progressBar.style.width = '100%';
    progressText.textContent = '✅ 追加 ' + added + '件！ 合計 ' + results.length + '件';

    updateSummary(results);
    renderResults(results);
    saveToLocal();

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
