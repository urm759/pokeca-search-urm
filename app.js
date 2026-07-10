(() => {
  const rows = Array.isArray(window.POKECA_DATA) ? window.POKECA_DATA : [];
  const defaults = window.POKECA_CONFIG || {};
  const nf = new Intl.NumberFormat('ja-JP');
  const STORAGE_KEY = 'pokeca-search-settings-v1';

  const K = {
    card: 'カード',
    pack: '収録パック',
    overall: '総合評価',
    judge13: '13k判断',
    recomm: 'おすすめの仕入れ値',
    psaDiff: 'PSA10差額',
    profitRate: '利益率',
    shop: 'ショップ価格',
    current: '現在相場',
    avg: '平均相場',
    psa10: 'PSA10売値',
    psa9: 'PSA9売値',
    psa10Count: 'PSA10枚数',
    psa9Count: 'PSA9枚数',
    psaTotal: 'PSA合計',
    psaRate: 'PSA10率',
    trend: '2か月見立て',
    roi13: '13kROI',
    judge5: '5k判断',
    roi5: '5kROI',
    liquidity: '流動性',
    score: '総合点',
    lock: '資金ロック',
    url: 'URL',
    image: '画像URL',
    cap13: '13k仕入れ上限',
    cap5: '5k仕入れ上限',
  };

  const LABEL = {
    buy: '買い',
    cond: '条件付き',
    skip: '見送り',
    strong: '縦積み可',
    small: '少数候補',
    cheap: '安ければ',
    limit: '指値なら',
    buy5: '買い',
    strong5: '強い',
    sub: 'サブ',
    ok: '仕入れ可',
    careful: '慎重',
    circle: '〇',
  };

  const els = {
    search: document.getElementById('search'),
    evalFilter: document.getElementById('evalFilter'),
    judgeFilter: document.getElementById('judgeFilter'),
    sortFilter: document.getElementById('sortFilter'),
    packFilter: document.getElementById('packFilter'),
    onlyBuyable: document.getElementById('onlyBuyable'),
    list: document.getElementById('list'),
    count: document.getElementById('resultCount'),
    stats: document.getElementById('stats'),
    settingsLine: document.getElementById('settingsLine'),
    fee13k: document.getElementById('fee13k'),
    fee5k: document.getElementById('fee5k'),
    months13k: document.getElementById('months13k'),
    months5k: document.getElementById('months5k'),
    target13k: document.getElementById('target13k'),
    target5k: document.getElementById('target5k'),
    applySettings: document.getElementById('applySettings'),
    resetSettings: document.getElementById('resetSettings'),
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function pickNumber(value, fallback) {
    const n = num(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  const baseSettings = {
    fee13k: pickNumber(defaults.fee13k, 13000),
    fee5k: pickNumber(defaults.fee5k, 5000),
    deliveryMonths13k: Math.max(1, Math.round(pickNumber(defaults.deliveryMonths13k, 2))),
    deliveryMonths5k: Math.max(1, Math.round(pickNumber(defaults.deliveryMonths5k, 5))),
    targetProfitRate13k: pickNumber(defaults.targetProfitRate13k, 20),
    targetProfitRate5k: pickNumber(defaults.targetProfitRate5k, 15),
  };

  let state = loadSettings();
  const packOptions = [...new Set(rows.map((r) => r[K.pack]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'ja')
  );

  for (const pack of packOptions) {
    const opt = document.createElement('option');
    opt.value = pack;
    opt.textContent = pack;
    els.packFilter.appendChild(opt);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...baseSettings };
      return normalizeSettings({ ...baseSettings, ...JSON.parse(raw) });
    } catch (_) {
      return { ...baseSettings };
    }
  }

  function normalizeSettings(input) {
    return {
      fee13k: Math.max(0, Math.round(pickNumber(input.fee13k, baseSettings.fee13k))),
      fee5k: Math.max(0, Math.round(pickNumber(input.fee5k, baseSettings.fee5k))),
      deliveryMonths13k: Math.max(1, Math.round(pickNumber(input.deliveryMonths13k, baseSettings.deliveryMonths13k))),
      deliveryMonths5k: Math.max(1, Math.round(pickNumber(input.deliveryMonths5k, baseSettings.deliveryMonths5k))),
      targetProfitRate13k: Math.max(0, pickNumber(input.targetProfitRate13k, baseSettings.targetProfitRate13k)),
      targetProfitRate5k: Math.max(0, pickNumber(input.targetProfitRate5k, baseSettings.targetProfitRate5k)),
    };
  }

  function saveSettings(next) {
    state = normalizeSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
    syncInputs();
    render();
  }

  function syncInputs() {
    els.fee13k.value = state.fee13k;
    els.fee5k.value = state.fee5k;
    els.months13k.value = state.deliveryMonths13k;
    els.months5k.value = state.deliveryMonths5k;
    els.target13k.value = state.targetProfitRate13k;
    els.target5k.value = state.targetProfitRate5k;
    els.settingsLine.textContent = `設定: 13k ${nf.format(state.fee13k)}円 / ${state.deliveryMonths13k}か月 / 目標利益率 ${state.targetProfitRate13k}%  |  5k ${nf.format(state.fee5k)}円 / ${state.deliveryMonths5k}か月 / 目標利益率 ${state.targetProfitRate5k}%`;
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

  function toneFor(value) {
    const text = String(value || '');
    if (!text) return 'b-info';
    if (text.includes(LABEL.buy) || text.includes(LABEL.strong) || text.includes('強い') || text.includes('可')) return 'b-good';
    if (text.includes(LABEL.cond) || text.includes(LABEL.small) || text.includes(LABEL.cheap) || text.includes(LABEL.limit) || text.includes('あり')) return 'b-warn';
    if (text.includes(LABEL.skip) || text.includes('注意') || text.includes('ロック')) return 'b-bad';
    return 'b-info';
  }

  function stripLeadCircle(name) {
    return String(name || '').replace(/^〇/, '');
  }

  function expectedSale(row) {
    return (num(row[K.psa10]) + num(row[K.psa9])) / 2;
  }

  function capPrice(psa10, psa9, fee, targetRate) {
    const sale = (num(psa10) + num(psa9)) / 2;
    const rate = Math.max(0, num(targetRate)) / 100;
    const denom = 1 + rate;
    if (!Number.isFinite(sale) || sale <= 0 || denom <= 0) return '';
    const upper = (sale - fee * denom) / denom;
    if (!Number.isFinite(upper) || upper <= 0) return '0';
    return String(Math.max(0, Math.floor(upper / 100) * 100));
  }

  function recommendPrice(psa10, psa9, judge, fee) {
    const sale = (num(psa10) + num(psa9)) / 2;
    const breakEven = sale - fee;
    if (!Number.isFinite(breakEven) || breakEven <= 0) return '';
    let factor = 0.85;
    if (judge === LABEL.strong) factor = 0.9;
    else if (judge === LABEL.small) factor = 0.86;
    else if (judge === LABEL.cheap) factor = 0.8;
    else if (judge === LABEL.limit) factor = 0.78;
    else if (judge === LABEL.skip) factor = 0.75;
    return String(Math.max(0, Math.round((breakEven * factor) / 100) * 100));
  }

  function roi(expectedSaleValue, shopPrice, fee) {
    const shop = num(shopPrice);
    if (!shop) return '';
    const value = ((expectedSaleValue - shop - fee) / (shop + fee)) * 100;
    return Number.isFinite(value) ? String(value.toFixed(1)) : '';
  }

  function judge13FromRoi(roiValue) {
    const r = num(roiValue);
    if (r >= 30) return LABEL.strong;
    if (r >= 15) return LABEL.small;
    if (r >= 8) return LABEL.cheap;
    if (r >= 0) return LABEL.limit;
    return LABEL.skip;
  }

  function judge5FromRoi(roiValue) {
    const r = num(roiValue);
    if (r >= 35) return LABEL.strong5;
    if (r >= 20) return LABEL.buy5;
    if (r >= 10) return LABEL.sub;
    return LABEL.skip;
  }

  function lockLabel(totalInvestment) {
    if (totalInvestment <= 20000) return '縦積み可';
    if (totalInvestment <= 50000) return '複数OK';
    if (totalInvestment <= 80000) return '少数向き';
    return '資金ロック注意';
  }

  function scoreRow({ roi13, roi5, psaTotal, psaRate, current, avg, shop, recom, judge13Label }) {
    let score = 0;
    if (roi13 >= 30) score += 3;
    else if (roi13 >= 15) score += 2;
    else if (roi13 >= 8) score += 1;
    if (roi5 >= 35) score += 1;
    if (roi5 >= 20) score += 1;
    if (num(psaTotal) >= 1000) score += 1;
    if (num(psaRate) >= 80) score += 1;
    if (num(current) > 0 && num(avg) > 0 && num(current) < num(avg)) score += 1;
    if (num(shop) > 0 && num(recom) > 0 && num(shop) < num(recom)) score += 1;
    if (judge13Label === LABEL.skip) score -= 1;
    return score;
  }

  function derivedRow(row) {
    const psa10 = num(row[K.psa10]);
    const psa9 = num(row[K.psa9]);
    const shop = num(row[K.shop]);
    const expected = expectedSale(row);
    const roi13 = roi(expected, shop, state.fee13k);
    const roi5 = roi(expected, shop, state.fee5k);
    const judge13 = judge13FromRoi(roi13);
    const judge5 = judge5FromRoi(roi5);
    const recom = recommendPrice(psa10, psa9, judge13, state.fee13k);
    const psaDiff = recom === '' ? '' : String(Math.round(psa10 - num(recom) - state.fee13k));
    const profitRate = recom === '' ? '' : String((((num(psaDiff)) / (num(recom) + state.fee13k)) * 100).toFixed(1));
    const cap13 = capPrice(psa10, psa9, state.fee13k, state.targetProfitRate13k);
    const cap5 = capPrice(psa10, psa9, state.fee5k, state.targetProfitRate5k);
    const buyable = shop > 0 && num(recom) > 0 && shop <= num(recom);
    const score = scoreRow({
      roi13: num(roi13),
      roi5: num(roi5),
      psaTotal: num(row[K.psaTotal]),
      psaRate: num(row[K.psaRate]),
      current: row[K.current],
      avg: row[K.avg],
      shop,
      recom: num(recom),
      judge13Label: judge13,
    });
    return {
      ...row,
      [K.card]: stripLeadCircle(row[K.card]),
      [K.recomm]: recom,
      [K.psaDiff]: psaDiff,
      [K.profitRate]: profitRate,
      [K.cap13]: cap13,
      [K.cap5]: cap5,
      [K.roi13]: roi13,
      [K.roi5]: roi5,
      [K.judge13]: judge13,
      [K.judge5]: judge5,
      [K.score]: String(score),
      [K.overall]: score >= 7 ? LABEL.buy : score >= 4 ? LABEL.cond : LABEL.skip,
      [K.lock]: lockLabel(num(recom) + state.fee13k),
      __buyable: buyable,
      __expectedSale: expected,
    };
  }

  function matches(row) {
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      const hay = [
        row[K.card],
        row[K.pack],
        row[K.overall],
        row[K.judge13],
        row[K.judge5],
        row[K.liquidity],
        row[K.lock],
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (els.evalFilter.value && row[K.overall] !== els.evalFilter.value) return false;
    if (els.judgeFilter.value && row[K.judge13] !== els.judgeFilter.value) return false;
    if (els.packFilter.value && row[K.pack] !== els.packFilter.value) return false;
    if (els.onlyBuyable.checked && !row.__buyable) return false;
    return true;
  }

  function sortRows(a, b) {
    const mode = els.sortFilter.value || 'summary';
    if (mode === 'roi13') {
      const diff = num(b[K.roi13]) - num(a[K.roi13]);
      if (diff !== 0) return diff;
    } else if (mode === 'roi5') {
      const diff = num(b[K.roi5]) - num(a[K.roi5]);
      if (diff !== 0) return diff;
    } else {
      const order = { [LABEL.buy]: 0, [LABEL.cond]: 1, [LABEL.skip]: 2 };
      const diffOverall = (order[a[K.overall]] ?? 9) - (order[b[K.overall]] ?? 9);
      if (diffOverall !== 0) return diffOverall;
      const judgeOrder = {
        [LABEL.strong]: 0,
        [LABEL.small]: 1,
        [LABEL.cheap]: 2,
        [LABEL.limit]: 3,
        [LABEL.skip]: 4,
      };
      const diffJudge = (judgeOrder[a[K.judge13]] ?? 9) - (judgeOrder[b[K.judge13]] ?? 9);
      if (diffJudge !== 0) return diffJudge;
      const diffScore = num(b[K.score]) - num(a[K.score]);
      if (diffScore !== 0) return diffScore;
    }

    const diffScore = num(b[K.score]) - num(a[K.score]);
    if (diffScore !== 0) return diffScore;
    const diffRoi = num(b[K.roi13]) - num(a[K.roi13]);
    if (diffRoi !== 0) return diffRoi;
    return String(a[K.card] || '').localeCompare(String(b[K.card] || ''), 'ja');
  }

  function renderStats(data) {
    const good = data.filter((r) => r[K.overall] === LABEL.buy).length;
    const cond = data.filter((r) => r[K.overall] === LABEL.cond).length;
    const skip = data.filter((r) => r[K.overall] === LABEL.skip).length;
    const buyable = data.filter((r) => r.__buyable).length;
    els.stats.innerHTML = [
      ['件数', data.length],
      ['買い', good],
      ['条件', cond],
      ['見送り', skip],
      ['仕入れ可', buyable],
    ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  function rowHtml(row) {
    const imageUrl = row[K.image] || '';
    const rowClass = [
      'row',
      row[K.overall] === LABEL.buy ? 'row-good' : row[K.overall] === LABEL.cond ? 'row-warn' : 'row-bad',
      row.__buyable ? 'row-buyable' : '',
    ].filter(Boolean).join(' ');

    return `
      <article class="${rowClass}">
        <div class="row-head">
          <div class="name-block">
            ${imageUrl ? `<img class="card-art" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" />` : ''}
            <div class="name-copy">
              <div class="name">${escapeHtml(stripLeadCircle(row[K.card]))}</div>
              <div class="pack">${escapeHtml(row[K.pack] || '')}</div>
            </div>
          </div>
          <div class="row-badges">
            ${badge(row[K.overall] || '-', toneFor(row[K.overall]))}
            ${badge(row[K.judge13] || '-', toneFor(row[K.judge13]))}
            ${badge(`総合点 ${row[K.score] || '-'}`, 'b-info')}
          </div>
          <div class="price-stack">
            <div class="price-label">ショップ価格</div>
            <div class="price-value">${yen(row[K.shop])}</div>
            <div class="price-label">おすすめの仕入れ値</div>
            <div class="price-value accent">${yen(row[K.recomm])}</div>
            <div class="price-state ${row.__buyable ? 'ok' : 'ng'}">${row.__buyable ? LABEL.ok : LABEL.careful}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="kv"><span class="k">現在相場</span><span class="v">${yen(row[K.current])}</span></div>
          <div class="kv"><span class="k">平均相場</span><span class="v">${yen(row[K.avg])}</span></div>
          <div class="kv"><span class="k">PSA10売値</span><span class="v">${yen(row[K.psa10])}</span></div>
          <div class="kv"><span class="k">PSA9売値</span><span class="v">${yen(row[K.psa9])}</span></div>
          <div class="kv"><span class="k">PSA10率</span><span class="v">${pct(row[K.psaRate])}</span></div>
          <div class="kv"><span class="k">13k仕入れ上限</span><span class="v">${yen(row[K.cap13])}</span></div>
          <div class="kv"><span class="k">5k仕入れ上限</span><span class="v">${yen(row[K.cap5])}</span></div>
          <div class="kv"><span class="k">13kROI</span><span class="v">${pct(row[K.roi13])}</span></div>
          <div class="kv"><span class="k">5kROI</span><span class="v">${pct(row[K.roi5])}</span></div>
          <div class="kv"><span class="k">2か月見立て / 流動性</span><span class="v">${escapeHtml(row[K.trend] || '-')} / ${escapeHtml(row[K.liquidity] || '-')}</span></div>
        </div>

        <div class="foot">
          <div class="badges">
            ${badge(`PSA10差額 ${yen(row[K.psaDiff]).replace('円', '')}`, 'b-info')}
            ${badge(`利益率 ${pct(row[K.profitRate])}`, 'b-info')}
            ${badge(`PSA10枚数 ${nf.format(num(row[K.psa10Count]))}`, 'b-info')}
            ${badge(`PSA合計 ${nf.format(num(row[K.psaTotal]))}`, 'b-info')}
          </div>
          <a class="link" href="${escapeHtml(row[K.url] || '#')}" target="_blank" rel="noopener noreferrer">元ページを開く</a>
        </div>
      </article>
    `;
  }

  function render() {
    const data = rows.map(derivedRow);
    const filtered = data.filter(matches).sort(sortRows);
    els.count.textContent = `${filtered.length} 件`;
    els.list.innerHTML = filtered.map(rowHtml).join('') || '<div class="muted">該当データがありません。</div>';
    renderStats(data);
  }

  function readSettingsFromInputs() {
    return normalizeSettings({
      fee13k: els.fee13k.value,
      fee5k: els.fee5k.value,
      deliveryMonths13k: els.months13k.value,
      deliveryMonths5k: els.months5k.value,
      targetProfitRate13k: els.target13k.value,
      targetProfitRate5k: els.target5k.value,
    });
  }

  els.applySettings.addEventListener('click', () => saveSettings(readSettingsFromInputs()));
  els.resetSettings.addEventListener('click', () => {
    state = { ...baseSettings };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    syncInputs();
    render();
  });

  [els.fee13k, els.fee5k, els.months13k, els.months5k, els.target13k, els.target5k].forEach((input) => {
    input.addEventListener('input', () => saveSettings(readSettingsFromInputs()));
  });

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

  syncInputs();
  render();
})();
