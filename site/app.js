(() => {
  const rows = Array.isArray(window.POKECA_DATA) ? window.POKECA_DATA : [];
  const nf = new Intl.NumberFormat('ja-JP');
  const els = {
    search: document.getElementById('search'),
    evalFilter: document.getElementById('evalFilter'),
    judgeFilter: document.getElementById('judgeFilter'),
    packFilter: document.getElementById('packFilter'),
    onlyCircle: document.getElementById('onlyCircle'),
    list: document.getElementById('list'),
    count: document.getElementById('resultCount'),
    stats: document.getElementById('stats'),
  };

  const labels = {
    '買い': 'b-good',
    '条件付き': 'b-warn',
    '見送り': 'b-bad',
    '縦積み可': 'b-good',
    '少数なら買い': 'b-info',
    '安ければ少数': 'b-warn',
    'かなり安ければ': 'b-warn',
    '見送り': 'b-bad',
    '高い': 'b-bad',
    '普通': 'b-info',
    '強い': 'b-good',
    '重め': 'b-warn',
    '軽め': 'b-good',
    '押し目': 'b-good',
    '横ばい': 'b-info',
    '過熱警戒': 'b-bad',
  };

  const packs = [...new Set(rows.map((r) => r['収録パック']).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  for (const pack of packs) {
    const opt = document.createElement('option');
    opt.value = pack;
    opt.textContent = pack;
    els.packFilter.appendChild(opt);
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function yen(v) {
    if (v === null || v === undefined || v === '') return '-';
    const n = num(v);
    return `${nf.format(Math.round(n))}円`;
  }

  function pct(v) {
    if (v === null || v === undefined || v === '') return '-';
    const n = num(v);
    return `${n.toFixed(1).replace(/\.0$/, '')}%`;
  }

  function badge(text, cls) {
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function compareText(a, b) {
    return String(a).localeCompare(String(b), 'ja');
  }

  function toneFor(value) {
    return labels[value] || 'b-info';
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
        row['2か月見立て'],
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (els.evalFilter.value && row['総合評価'] !== els.evalFilter.value) return false;
    if (els.judgeFilter.value && row['13k判断'] !== els.judgeFilter.value) return false;
    if (els.packFilter.value && row['収録パック'] !== els.packFilter.value) return false;
    if (els.onlyCircle.checked && !String(row['カード'] || '').startsWith('〇')) return false;
    return true;
  }

  function sortRows(a, b) {
    const ev = { '買い': 0, '条件付き': 1, '見送り': 2 };
    const av = ev[a['総合評価']] ?? 9;
    const bv = ev[b['総合評価']] ?? 9;
    if (av !== bv) return av - bv;
    const aj = num(a['総合点']);
    const bj = num(b['総合点']);
    if (aj !== bj) return bj - aj;
    const aroi = num(a['13kROI']);
    const broi = num(b['13kROI']);
    if (aroi !== broi) return broi - aroi;
    return compareText(a['カード'], b['カード']);
  }

  els.stats.innerHTML = [
    ['件数', rows.length],
    ['買い', rows.filter((r) => r['総合評価'] === '買い').length],
    ['条件付き', rows.filter((r) => r['総合評価'] === '条件付き').length],
    ['見送り', rows.filter((r) => r['総合評価'] === '見送り').length],
  ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  function rowHtml(row) {
    const buyPrice = num(row['おすすめの仕入れ値']);
    const shop = num(row['ショップ価格']);
    const link = row['URL'] || '#';
    const purchasable = buyPrice > 0 && shop > 0 && shop <= buyPrice;
    const rowClass = [
      'row',
      `row-${row['総合評価'] === '買い' ? 'good' : row['総合評価'] === '条件付き' ? 'warn' : 'bad'}`,
      purchasable ? 'row-buyable' : '',
    ].filter(Boolean).join(' ');
    return `
      <article class="${rowClass}">
        <div class="row-head">
          <div class="name-block">
            <div class="name">${row['カード'] || ''}</div>
            <div class="pack">${row['収録パック'] || ''}</div>
          </div>
          <div class="row-badges">
            ${badge(row['総合評価'] || '-', toneFor(row['総合評価']))}
            ${badge(row['13k判断'] || '-', toneFor(row['13k判断']))}
            ${badge(`総合点 ${row['総合点'] || '-'}`, 'b-info')}
          </div>
          <div class="price-stack">
            <div class="price-label">ショップ価格</div>
            <div class="price-value">${yen(shop) }</div>
            <div class="price-label">おすすめ仕入れ値</div>
            <div class="price-value accent">${yen(buyPrice)}</div>
            <div class="price-state ${purchasable ? 'ok' : 'ng'}">${purchasable ? '仕入れOK' : '様子見'}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="kv"><span class="k">現在相場</span><span class="v">${yen(row['現在相場'])}</span></div>
          <div class="kv"><span class="k">平均相場</span><span class="v">${yen(row['平均相場'])}</span></div>
          <div class="kv"><span class="k">PSA10売値</span><span class="v">${yen(row['PSA10売値'])}</span></div>
          <div class="kv"><span class="k">PSA10差額</span><span class="v">${yen(row['PSA10差額'])}</span></div>
          <div class="kv"><span class="k">利益率</span><span class="v">${pct(row['利益率'])}</span></div>
          <div class="kv"><span class="k">13kROI</span><span class="v">${pct(row['13kROI'])}</span></div>
          <div class="kv"><span class="k">5kROI</span><span class="v">${pct(row['5kROI'])}</span></div>
          <div class="kv"><span class="k">流動性 / 資金</span><span class="v">${row['流動性'] || '-'} / ${row['資金ロック'] || '-'}</span></div>
        </div>

        <div class="foot">
          <div class="badges">
            ${badge(`PSA10率 ${pct(row['PSA10率'])}`, 'b-info')}
            ${badge(`2か月 ${row['2か月見立て'] || '-'}`, toneFor(row['2か月見立て']))}
            ${badge(`PSA合計 ${nf.format(num(row['PSA合計']))}`, 'b-info')}
          </div>
          <a class="link" href="${link}" target="_blank" rel="noopener noreferrer">元ページを見る</a>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = rows.filter(matches).sort(sortRows);
    els.count.textContent = `${filtered.length} 件`;
    els.list.innerHTML = filtered.map(rowHtml).join('') || '<div class="muted">該当なし</div>';
  }

  ['input', 'change'].forEach((evt) => {
    els.search.addEventListener(evt, render);
    els.evalFilter.addEventListener(evt, render);
    els.judgeFilter.addEventListener(evt, render);
    els.packFilter.addEventListener(evt, render);
    els.onlyCircle.addEventListener(evt, render);
  });

  document.querySelectorAll('[data-term]').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.search.value = btn.dataset.term || '';
      render();
      els.search.focus();
    });
  });

  render();
})();
