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
  const STORE_KEY = 'pokeca-manual-store-price-v1';
  let theme = loadTheme();

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
      els.themeToggle.textContent = theme === 'dark' ? 'Dark' : 'Light';
      els.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
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
    return `${num(v).toFixed(1).replace(/\.0$/, '')}%`;
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
    if (v.includes('買い') || v.includes('縦積み可') || v.includes('出す価値あり') || v.includes('OK')) return 'b-good';
    if (v.includes('条件付き') || v.includes('少数') || v.includes('かなり安ければ') || v.includes('様子見')) return 'b-warn';
    if (v.includes('見送り') || v.includes('下落注意')) return 'b-bad';
    return 'b-info';
  }

  function displayName(name) {
    return String(name || '').replace(/^〇/, '');
  }

  function derivedRarity(row) {
    const direct = String(row['レアリティ'] || '').trim();
    if (direct) return direct;
    const text = String(row['カード'] || '');
    const tokens = ['MUR', 'SAR', 'CSR', 'CHR', 'AR', 'SR', 'UR', 'HR', 'SSR', 'RRR', 'RR', 'R', 'U', 'C', 'PR', 'P'];
    for (const token of tokens) {
      if (new RegExp(`\\b${token}\\b`).test(text)) return token;
    }
    if (/プロモ/.test(text)) return 'プロモ';
    const bracket = text.match(/\[(.*?)\]/);
    if (bracket) {
      for (const token of tokens) {
        if (new RegExp(`\\b${token}\\b`, 'i').test(bracket[1])) return token;
      }
      if (/プロモ/i.test(bracket[1])) return 'プロモ';
    }
    return '';
  }

  function storeLabel(row) {
    return String(row['店頭判断'] || row['13k判断'] || '');
  }

  function psaLabel(row) {
    return String(row['PSA判断'] || '');
  }

  function priceKey(row) {
    return `${STORE_KEY}:${String(row['URL'] || '')}`;
  }

  function getManualStorePrice(row) {
    try {
      const saved = localStorage.getItem(priceKey(row));
      if (!saved) return null;
      const parsed = num(saved);
      return parsed > 0 ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveManualStorePrice(row, raw) {
    try {
      const key = priceKey(row);
      const value = String(raw ?? '').trim();
      if (!value) {
        localStorage.removeItem(key);
        return;
      }
      const parsed = num(value);
      if (parsed > 0) localStorage.setItem(key, String(Math.round(parsed)));
      else localStorage.removeItem(key);
    } catch (_) {}
  }

  function effectiveShopPrice(row, override) {
    if (Number.isFinite(override)) return override;
    return num(row['現在相場']);
  }

  function psa9PriceFromShop(shopPrice) {
    const value = num(shopPrice);
    return value > 0 ? Math.round(value * 0.75) : 0;
  }

  function avgSignal(row) {
    const current = num(row['現在相場']);
    const average = num(row['平均相場']);
    if (!current || !average) return '-';
    if (current > average) return '平均超え';
    if (current < average) return '平均割れ';
    return '平均同値';
  }

  function shopSignal(row) {
    const current = num(row['現在相場']);
    const upper = num(row['13k仕入れ上限']);
    if (!current || !upper) return '-';
    if (current <= upper * 0.95) return '店頭OK';
    if (current <= upper * 1.08) return '店頭注意';
    return '店頭NG';
  }

  function isBuyable(row, shopOverride) {
    const shop = effectiveShopPrice(row, shopOverride);
    const upper = num(row['13k仕入れ上限']);
    const psaOk = psaLabel(row) !== '見送り';
    if (!shop || !upper || !psaOk) return false;
    return shop <= upper * 1.08;
  }

  function matches(row) {
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      const hay = [
        row['カード'],
        row['収録パック'],
        derivedRarity(row),
        row['総合評価'],
        storeLabel(row),
        psaLabel(row),
        row['5k判断'],
        row['流動性'],
        row['2か月見立て'],
        row['資金ロック'],
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (els.evalFilter.value && row['総合評価'] !== els.evalFilter.value) return false;
    if (els.judgeFilter.value && storeLabel(row) !== els.judgeFilter.value) return false;
    if (els.packFilter.value && row['収録パック'] !== els.packFilter.value) return false;
    if (els.onlyBuyable.checked && !isBuyable(row)) return false;
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
      const rank = { 買い: 0, 条件付き: 1, 見送り: 2 };
      const diffOverall = (rank[a['総合評価']] ?? 9) - (rank[b['総合評価']] ?? 9);
      if (diffOverall !== 0) return diffOverall;
      const diffJudge = (rank[storeLabel(a)] ?? 9) - (rank[storeLabel(b)] ?? 9);
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
    const manualShopPrice = getManualStorePrice(row);
    const shopPrice = effectiveShopPrice(row, manualShopPrice);
    const buyable = isBuyable(row, shopPrice);
    const psa10 = num(row['PSA10売値']);
    const psa9 = psa9PriceFromShop(shopPrice);
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
              <div class="pack">${escapeHtml(derivedRarity(row) || '')}</div>
            </div>
          </div>
          <div class="row-badges">
            ${badge(`買っていいか ${row['総合評価'] || '-'}`, toneFor(row['総合評価']))}
            ${badge(`店頭価格確認 ${shopSignal(row)}`, toneFor(shopSignal(row)))}
            ${badge(`鑑定価値 ${psaLabel(row) || '-'}`, toneFor(psaLabel(row)))}
          </div>
          <div class="price-stack">
            <div class="price-label">現在相場</div>
            <div class="price-value">${yen(row['現在相場'])}</div>
            <div class="price-label">平均相場</div>
            <div class="price-value">${yen(row['平均相場'])}</div>
            <div class="price-label">おすすめの仕入れ値</div>
            <div class="price-value accent">${yen(row['おすすめの仕入れ値'])}</div>
            <div class="price-label">店頭価格</div>
            <input class="store-price-input" data-store-price data-url="${escapeHtml(row['URL'] || '')}" type="number" inputmode="numeric" placeholder="未入力" value="${manualShopPrice ?? ''}" />
            <div class="price-state ${buyable ? 'ok' : 'ng'}">${buyable ? '仕入れ可' : '慎重'}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="kv"><span class="k">PSA10売値</span><span class="v">${yen(psa10)}</span></div>
          <div class="kv"><span class="k">PSA9売値</span><span class="v">${yen(psa9)}</span></div>
          <div class="kv"><span class="k">13k仕入れ上限</span><span class="v">${yen(row['13k仕入れ上限'])}</span></div>
          <div class="kv"><span class="k">5k仕入れ上限</span><span class="v">${yen(row['5k仕入れ上限'])}</span></div>
          <div class="kv"><span class="k">13kROI</span><span class="v">${pct(row['13kROI'])}</span></div>
          <div class="kv"><span class="k">5kROI</span><span class="v">${pct(row['5kROI'])}</span></div>
          <div class="kv"><span class="k">取引件数</span><span class="v">${nf.format(num(row['取引件数']))}</span></div>
          <div class="kv"><span class="k">2か月見立て</span><span class="v">${escapeHtml(row['2か月見立て'] || '-')}</span></div>
          <div class="kv"><span class="k">平均比</span><span class="v">${escapeHtml(avgSignal(row))}</span></div>
          <div class="kv"><span class="k">流動性</span><span class="v">${escapeHtml(row['流動性'] || '-')}</span></div>
          <div class="kv"><span class="k">PSA10率</span><span class="v">${pct(row['PSA10率'])}</span></div>
          <div class="kv"><span class="k">総合点</span><span class="v">${escapeHtml(row['総合点'] || '-')}</span></div>
        </div>

        <div class="foot">
          <div class="badges">
            ${badge(`PSA10差額 ${yen(row['PSA10差額'])}`, 'b-info')}
            ${badge(`利益率 ${pct(row['利益率'])}`, 'b-info')}
            ${badge(`PSA10枚数 ${nf.format(num(row['PSA10枚数']))}`, 'b-info')}
            ${badge(`平均比 ${avgSignal(row)}`, 'b-info')}
            ${badge(`鑑定価値 ${row['PSA判断'] || '-'}`, toneFor(row['PSA判断']))}
          </div>
          <a class="link" href="${escapeHtml(row['URL'] || '#')}" target="_blank" rel="noopener noreferrer">開く</a>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = rows.filter(matches).sort(sortRows);
    els.count.textContent = `${filtered.length}件`;
    els.list.innerHTML = filtered.map(rowHtml).join('') || '<div class="muted">該当するカードがありません。</div>';

    const good = rows.filter((r) => r['総合評価'] === '買い').length;
    const cond = rows.filter((r) => r['総合評価'] === '条件付き').length;
    const skip = rows.filter((r) => r['総合評価'] === '見送り').length;
    const buyableCount = rows.filter((r) => isBuyable(r)).length;
    const psaOk = rows.filter((r) => r['PSA判断'] !== '見送り').length;

    els.stats.innerHTML = [
      ['件数', rows.length],
      ['買い', good],
      ['条件付き', cond],
      ['見送り', skip],
      ['PSA可', psaOk],
      ['仕入れ可', buyableCount],
    ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

    if (els.settingsLine) {
      els.settingsLine.textContent =
        `13k 鑑定費 ${nf.format(num(config.fee13k) || 13000)}円 / ${num(config.deliveryMonths13k) || 2}か月 / 目標ROI ${num(config.targetProfitRate13k) || 20}%  |  ` +
        `5k 鑑定費 ${nf.format(num(config.fee5k) || 5000)}円 / ${num(config.deliveryMonths5k) || 5}か月 / 目標ROI ${num(config.targetProfitRate5k) || 15}%`;
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

  els.list.addEventListener('change', (evt) => {
    const input = evt.target.closest('input[data-store-price]');
    if (!input) return;
    const row = rows.find((r) => String(r['URL'] || '') === String(input.dataset.url || ''));
    if (!row) return;
    saveManualStorePrice(row, input.value);
    render();
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=20260711').catch(() => {});
    });
  }

  applyTheme(theme);
  render();
})();
