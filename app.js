(() => {
  const rows = Array.isArray(window.POKECA_DATA) ? window.POKECA_DATA : [];
  const config = window.POKECA_CONFIG || {};
  const nf = new Intl.NumberFormat('ja-JP');
  const els = {
    search: document.getElementById('search'),
    evalFilter: document.getElementById('evalFilter'),
    judgeFilter: document.getElementById('judgeFilter'),
    sortFilter: document.getElementById('sortFilter'),
    packFilter: document.getElementById('packFilter'),
    onlyBuyable: document.getElementById('onlyBuyable'),
    themeToggle: document.getElementById('themeToggle'),
    list: document.getElementById('list'),
    count: document.getElementById('resultCount'),
    stats: document.getElementById('stats'),
    settingsLine: document.getElementById('settingsLine'),
  };

  const THEME_KEY = 'pokeca-theme';
  let theme = loadTheme();

  const packs = [...new Set(rows.map((r) => r['収録パック']).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'ja')
  );
  for (const pack of packs) {
    const opt = document.createElement('option');
    opt.value = pack;
    opt.textContent = pack;
    els.packFilter.appendChild(opt);
  }

  function loadTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (_) {}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  function applyTheme(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101522' : '#eef2f6');
    if (els.themeToggle) {
      els.themeToggle.textContent = theme === 'dark' ? '明るいモード' : '暗いモード';
      els.themeToggle.setAttribute('aria-label', theme === 'dark' ? '明るいモードに切り替え' : '暗いモードに切り替え');
    }
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function yen(v) {
    if (v === null || v === undefined || v === '') return '-';
    return `${nf.format(Math.round(num(v)))}円`;
  }

  function pct(v) {
    if (v === null || v === undefined || v === '') return '-';
    const n = num(v);
    return `${n.toFixed(1).replace(/\.0$/, '')}%`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badge(text, cls) {
    return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
  }

  function toneFor(text) {
    const v = String(text || '');
    if (v.includes('買い') || v.includes('縦積み可') || v.includes('強い')) return 'b-good';
    if (v.includes('条件付き') || v.includes('少数候補') || v.includes('安ければ') || v.includes('指値なら') || v.includes('あり')) return 'b-warn';
    if (v.includes('見送り') || v.includes('注意')) return 'b-bad';
    return 'b-info';
  }

  function displayName(name) {
    return String(name || '').replace(/^〇/, '');
  }

  function matches(row) {
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      const hay = [
        row['カード'],
        row['収録パック'],
        row['総合評価'],
        row['13k判断'],
        row['5k判断'],
        row['流動性'],
        row['資金ロック'],
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (els.evalFilter.value && row['総合評価'] !== els.evalFilter.value) return false;
    if (els.judgeFilter.value && row['13k判断'] !== els.judgeFilter.value) return false;
    if (els.packFilter.value && row['収録パック'] !== els.packFilter.value) return false;
    if (els.onlyBuyable.checked && !(num(row['ショップ価格']) > 0 && num(row['おすすめの仕入れ値']) > 0 && num(row['ショップ価格']) <= num(row['おすすめの仕入れ値']))) {
      return false;
    }
    return true;
  }

  function sortRows(a, b) {
    const mode = els.sortFilter.value || 'summary';
    if (mode === 'roi13') {
      const diff = num(b['13kROI']) - num(a['13kROI']);
      if (diff !== 0) return diff;
    } else if (mode === 'roi5') {
      const diff = num(b['5kROI']) - num(a['5kROI']);
      if (diff !== 0) return diff;
    } else {
      const rank = { '買い': 0, '条件付き': 1, '見送り': 2 };
      const diffOverall = (rank[a['総合評価']] ?? 9) - (rank[b['総合評価']] ?? 9);
      if (diffOverall !== 0) return diffOverall;
      const judgeRank = { '縦積み可': 0, '少数候補': 1, '安ければ': 2, '指値なら': 3, '見送り': 4 };
      const diffJudge = (judgeRank[a['13k判断']] ?? 9) - (judgeRank[b['13k判断']] ?? 9);
      if (diffJudge !== 0) return diffJudge;
      const diffScore = num(b['総合点']) - num(a['総合点']);
      if (diffScore !== 0) return diffScore;
    }
    const diffScore = num(b['総合点']) - num(a['総合点']);
    if (diffScore !== 0) return diffScore;
    return String(a['カード'] || '').localeCompare(String(b['カード'] || ''), 'ja');
  }

  function rowHtml(row) {
    const imageUrl = row['画像URL'] || '';
    const buyable = num(row['ショップ価格']) > 0 && num(row['おすすめの仕入れ値']) > 0 && num(row['ショップ価格']) <= num(row['おすすめの仕入れ値']);
    const rowClass = [
      'row',
      row['総合評価'] === '買い' ? 'row-good' : row['総合評価'] === '条件付き' ? 'row-warn' : 'row-bad',
      buyable ? 'row-buyable' : '',
    ].filter(Boolean).join(' ');

    return `
      <article class="${rowClass}">
        <div class="row-head">
          <div class="name-block">
            ${imageUrl ? `<img class="card-art" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" />` : ''}
            <div class="name-copy">
              <div class="name">${escapeHtml(displayName(row['カード']))}</div>
              <div class="pack">${escapeHtml(row['収録パック'] || '')}</div>
            </div>
          </div>
          <div class="row-badges">
            ${badge(row['総合評価'] || '-', toneFor(row['総合評価']))}
            ${badge(row['13k判断'] || '-', toneFor(row['13k判断']))}
            ${badge(`総合点 ${row['総合点'] || '-'}`, 'b-info')}
          </div>
          <div class="price-stack">
            <div class="price-label">ショップ価格</div>
            <div class="price-value">${yen(row['ショップ価格'])}</div>
            <div class="price-label">おすすめの仕入れ値</div>
            <div class="price-value accent">${yen(row['おすすめの仕入れ値'])}</div>
            <div class="price-state ${buyable ? 'ok' : 'ng'}">${buyable ? '仕入れ可' : '慎重'}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="kv"><span class="k">現在相場</span><span class="v">${yen(row['現在相場'])}</span></div>
          <div class="kv"><span class="k">平均相場</span><span class="v">${yen(row['平均相場'])}</span></div>
          <div class="kv"><span class="k">PSA10売値</span><span class="v">${yen(row['PSA10売値'])}</span></div>
          <div class="kv"><span class="k">PSA9売値</span><span class="v">${yen(row['PSA9売値'])}</span></div>
          <div class="kv"><span class="k">PSA10率</span><span class="v">${pct(row['PSA10率'])}</span></div>
          <div class="kv"><span class="k">13k仕入れ上限</span><span class="v">${yen(row['13k仕入れ上限'])}</span></div>
          <div class="kv"><span class="k">5k仕入れ上限</span><span class="v">${yen(row['5k仕入れ上限'])}</span></div>
          <div class="kv"><span class="k">13kROI</span><span class="v">${pct(row['13kROI'])}</span></div>
          <div class="kv"><span class="k">5kROI</span><span class="v">${pct(row['5kROI'])}</span></div>
          <div class="kv"><span class="k">2か月見立て / 流動性</span><span class="v">${escapeHtml(row['2か月見立て'] || '-')} / ${escapeHtml(row['流動性'] || '-')}</span></div>
        </div>

        <div class="foot">
          <div class="badges">
            ${badge(`PSA10差額 ${yen(row['PSA10差額']).replace('円', '')}`, 'b-info')}
            ${badge(`利益率 ${pct(row['利益率'])}`, 'b-info')}
            ${badge(`PSA合計 ${nf.format(num(row['PSA合計']))}`, 'b-info')}
            ${badge(`資金ロック ${row['資金ロック'] || '-'}`, toneFor(row['資金ロック']))}
          </div>
          <a class="link" href="${escapeHtml(row['URL'] || '#')}" target="_blank" rel="noopener noreferrer">元ページを開く</a>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = rows.filter(matches).sort(sortRows);
    els.count.textContent = `${filtered.length} 件`;
    els.list.innerHTML = filtered.map(rowHtml).join('') || '<div class="muted">該当データがありません。</div>';
    const good = rows.filter((r) => r['総合評価'] === '買い').length;
    const cond = rows.filter((r) => r['総合評価'] === '条件付き').length;
    const skip = rows.filter((r) => r['総合評価'] === '見送り').length;
    const buyable = rows.filter((r) => num(r['ショップ価格']) > 0 && num(r['おすすめの仕入れ値']) > 0 && num(r['ショップ価格']) <= num(r['おすすめの仕入れ値'])).length;
    els.stats.innerHTML = [
      ['件数', rows.length],
      ['買い', good],
      ['条件', cond],
      ['見送り', skip],
      ['仕入れ可', buyable],
    ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

    if (els.settingsLine) {
      els.settingsLine.textContent = `設定: 鑑定費 ${nf.format(num(config.fee13k) || 13000)}円 / ${num(config.deliveryMonths13k) || 2}か月 / 目標利益率 ${num(config.targetProfitRate13k) || 20}%  |  鑑定費 ${nf.format(num(config.fee5k) || 5000)}円 / ${num(config.deliveryMonths5k) || 5}か月 / 目標利益率 ${num(config.targetProfitRate5k) || 15}%`;
    }
  }

  ['input', 'change'].forEach((evt) => {
    els.search.addEventListener(evt, render);
    els.evalFilter.addEventListener(evt, render);
    els.judgeFilter.addEventListener(evt, render);
    els.sortFilter.addEventListener(evt, render);
    els.packFilter.addEventListener(evt, render);
    els.onlyBuyable.addEventListener(evt, render);
  });

  document.querySelectorAll('[data-term]').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.search.value = btn.dataset.term || '';
      render();
      els.search.focus();
    });
  });

  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', () => {
      applyTheme(theme === 'dark' ? 'light' : 'dark');
    });
  }

  applyTheme(theme);
  render();
})();
