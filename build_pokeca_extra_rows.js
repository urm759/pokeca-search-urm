const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'pricing_settings.json');
const DEFAULT_SETTINGS = {
  fee13k: 13000,
  fee5k: 5000,
  deliveryMonths13k: 2,
  deliveryMonths5k: 5,
  targetProfitRate13k: 20,
  targetProfitRate5k: 15,
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

const SETTINGS = loadSettings();
const FEE_13K = Number(SETTINGS.fee13k) || 13000;
const FEE_5K = Number(SETTINGS.fee5k) || 5000;

const TARGETS = new Set(process.argv.slice(2));

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStrings() {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const y = new Date(now.getTime() - 86400000);
  const yesterday = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  return [today, yesterday];
}

function decryptApiData(c, s, i, dateText) {
  const pass = `vQpUc4ej${dateText}`;
  const key = crypto.pbkdf2Sync(pass, Buffer.from(s, 'hex'), 100, 32, 'sha512');
  const iv = Buffer.from(i, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let out = decipher.update(c, 'base64', 'utf8');
  out += decipher.final('utf8');
  return JSON.parse(out);
}

async function fetchItemMap() {
  const res = await fetch('https://api.pokeca-chart.com/api/v1/item?mode=1');
  const json = await res.json();
  const { c, s, i } = json.data;
  for (const dateText of dateStrings()) {
    try {
      const items = decryptApiData(c, s, i, dateText);
      return { items: Object.values(items), usedDate: dateText };
    } catch (_) {}
  }
  throw new Error('failed to decrypt item list');
}

function n(v) {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return String(Math.round(v));
}

function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return Number(v).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function round100(v) {
  return Math.round(v / 100) * 100;
}

function normalizeShopPrice(raw, current, avg) {
  const shop = n(raw);
  if (shop === null) {
    if (current && current > 0) return Math.round(current);
    if (avg && avg > 0) return Math.round(avg);
    return null;
  }
  const refs = [];
  if (current && current > 0) refs.push(current);
  if (avg && avg > 0) refs.push(avg);
  if (!refs.length) return Math.round(shop);
  const refMin = Math.min(...refs);
  const refMax = Math.max(...refs);
  const refAvg = refs.reduce((a, b) => a + b, 0) / refs.length;
  if (shop < refMin * 0.6 || shop > refMax * 1.7) return Math.round(refAvg);
  const devCurrent = current && current > 0 ? Math.abs(shop - current) / current : 0;
  const devAvg = avg && avg > 0 ? Math.abs(shop - avg) / avg : 0;
  if (current && avg && devCurrent > 0.45 && devAvg > 0.45) return Math.round(refAvg);
  return Math.round(shop);
}

function chooseShopPrice(shops, current, avg) {
  const inStock = shops.filter((x) => Number(x.stock) > 0);
  const pool = inStock.length ? inStock : shops;
  const prices = pool.map((x) => Number(x.min_price)).filter((x) => x > 0);
  if (!prices.length) return normalizeShopPrice(null, current, avg);
  return normalizeShopPrice(Math.min(...prices), current, avg);
}

function trendLabel(rate7, rate30) {
  const r7 = n(rate7) ?? 0;
  const r30 = n(rate30) ?? 0;
  if (r30 <= -0.15) return '下落注意';
  if ((r7 > 0.12 && r30 > 0.08) || r30 >= 0.2) return '過熱警戒';
  if (r7 > 0 && r30 < 0) return '押し目';
  if (r7 < 0 && r30 < 0) return '下落注意';
  return '横ばい';
}

function liquidityLabel(pv, volume) {
  const nPv = n(pv) ?? 0;
  const nVol = n(volume) ?? 0;
  if (nPv >= 120 || nVol >= 5) return '高';
  if (nPv >= 80) return '中高';
  return '中';
}

function lockLabel(totalInvestment) {
  if (totalInvestment <= 20000) return '普通';
  if (totalInvestment <= 50000) return '普通';
  if (totalInvestment <= 80000) return '重め';
  return '重い';
}

function judge13k(roi, trend, liquidity) {
  let label;
  if (roi >= 30) label = '縦積み可';
  else if (roi >= 15) label = '少数なら買い';
  else if (roi >= 8) label = '安ければ少数';
  else if (roi >= 0) label = 'かなり安ければ';
  else label = '見送り';

  if (trend === '下落注意') {
    if (label === '縦積み可') label = '少数なら買い';
    else if (label === '少数なら買い') label = '安ければ少数';
    else if (label === '安ければ少数') label = 'かなり安ければ';
  }
  if (liquidity === '中' && label === '縦積み可') label = '少数なら買い';
  return label;
}

function judge5k(roi) {
  if (roi >= 35) return '強い';
  if (roi >= 20) return '買い';
  if (roi >= 10) return '指値なら';
  return 'サブ';
}

function recomPrice(psa10, psa9, judgment) {
  if (!psa10 || !psa9) return null;
  const expectedSale = (psa10 + psa9) / 2;
  const rate = Math.max(0, Number(SETTINGS.targetProfitRate13k) || 0) / 100;
  const upper = (expectedSale - FEE_13K * (1 + rate)) / (1 + rate);
  if (!Number.isFinite(upper) || upper <= 0) return 0;
  let factor = 0.85;
  if (judgment === '縦積み可') factor = 0.9;
  else if (judgment === '少数なら買い') factor = 0.86;
  else if (judgment === '安ければ少数') factor = 0.8;
  else if (judgment === 'かなり安ければ') factor = 0.78;
  else if (judgment === '見送り') factor = 0.75;
  return round100(upper * factor);
}

function scoreRow({ roi13, roi5, trend, liquidity, psaTotal, psaRate, current, avg, shop, recom, judgment13 }) {
  let score = 0;
  if (roi13 >= 30) score += 3;
  else if (roi13 >= 15) score += 2;
  else if (roi13 >= 8) score += 1;
  if (roi5 >= 35) score += 1;
  if (roi5 >= 20) score += 1;
  if (trend === '押し目') score += 1;
  if (trend === '過熱警戒') score -= 1;
  if (liquidity === '高' || liquidity === '中高') score += 1;
  if ((n(psaTotal) ?? 0) >= 1000) score += 1;
  if ((n(psaRate) ?? 0) >= 80) score += 1;
  if ((n(current) ?? 0) < (n(avg) ?? 0)) score += 1;
  if ((n(shop) ?? 0) < (n(recom) ?? 0)) score += 1;
  if (judgment13 === '見送り') score -= 1;
  return score;
}

function overall(score) {
  if (score >= 7) return '買い';
  if (score >= 4) return '条件付き';
  return '見送り';
}

function noteText(overallEval, judgment13, trend, liquidity, lock, score) {
  const parts = [];
  if (overallEval === '買い') parts.push('13k優先で仕入れ候補');
  else if (overallEval === '条件付き') parts.push('13kは条件付き');
  else parts.push('13kは見送り寄り');

  if (judgment13 === '縦積み可') parts.push('13kは縦積み向き');
  else if (judgment13 === '少数なら買い') parts.push('13kは少数候補');
  else if (judgment13 === '安ければ少数') parts.push('13kは安ければ少数');
  else if (judgment13 === 'かなり安ければ') parts.push('13kはかなり安ければ');
  else parts.push('13kは慎重');

  if (trend === '押し目') parts.push('2か月見立ては押し目');
  else if (trend === '横ばい') parts.push('2か月見立ては横ばい');
  else if (trend === '過熱警戒') parts.push('2か月で反動注意');
  else parts.push('2か月見立ては下落注意');

  if (score >= 6) parts.push('PSA鑑定数は薄めで値動き荒め');
  else if (score >= 4) parts.push('PSA鑑定数は標準的');
  else parts.push('PSA鑑定数は厚めで上値は重め');

  if (lock === '重い') parts.push('資金ロック重い');
  else if (lock === '重め') parts.push('資金ロック重め');
  else parts.push('資金ロックは比較的軽い');

  if (liquidity === '高') parts.push('流動性は高い');
  else if (liquidity === '中高') parts.push('流動性は比較的良好');
  else parts.push('流動性は中');

  if (overallEval === '条件付き') parts.push('5kだけなら検討余地あり');
  return parts.join(' / ');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  const { items } = await fetchItemMap();
  const map = new Map(items.map((item) => [item.strSlug, item]));
  const out = [];

  for (const slug of TARGETS) {
    const item = map.get(slug);
    if (!item) continue;

    const info = item.arrayPriceInfo || [];
    const currentInfo = info[0] || {};
    const psa9Info = info[1] || {};
    const psa10Info = info[2] || {};
    const current = n(currentInfo.nPriceRecent) ?? 0;
    const avg = n(currentInfo.nPriceAvg) ?? 0;
    const psa9 = n(psa9Info.nPriceRecent) ?? 0;
    const psa10 = n(psa10Info.nPriceRecent) ?? 0;

    const shopData = await fetchJson(`https://api.pokeca-chart.com/php/get.php?function=get_shop_stock_data&item_id=${item.nItemId}`);
    const shopPrice = chooseShopPrice(Array.isArray(shopData) ? shopData : [], current, avg);

    const grdText = await fetchText(`https://api.pokeca-chart.com/php/get.php?function=get_item_grd_info&item_id=${item.nItemId}`);
    let grd = [];
    try { grd = JSON.parse(grdText); } catch { grd = []; }
    const grdInfo = grd[0] || {};
    const psa10Count = n(grdInfo.grd_status_10) ?? n(item.nPSA10Num) ?? '';
    const psa9Count = n(grdInfo.grd_status_9) ?? '';
    const psaTotal = n(grdInfo.grd_status_all) ?? '';
    const psaRate = psa10Count && psaTotal ? fmtNum((psa10Count / psaTotal) * 100, 1) : '';

    const trend = trendLabel(currentInfo.fRiseFallRate7, currentInfo.fRiseFallRate30);
    const liq = liquidityLabel(item.nPv, item.nVolume);
    const roi13 = shopPrice ? fmtNum((((psa10 + psa9) / 2 - shopPrice - FEE_13K) / (shopPrice + FEE_13K)) * 100, 1) : '';
    const roi5 = shopPrice ? fmtNum((((psa10 + psa9) / 2 - shopPrice - FEE_5K) / (shopPrice + FEE_5K)) * 100, 1) : '';
    const j13 = judge13k(n(roi13) ?? 0, trend, liq);
    const j5 = judge5k(n(roi5) ?? 0);
    const recom = recomPrice(psa10, psa9, j13);
    const psaDiff = recom !== null ? Math.round(psa10 - recom - FEE_13K) : '';
    const profitRate = recom !== null ? fmtNum((psaDiff / (recom + FEE_13K)) * 100, 1) : '';
    const score = scoreRow({
      roi13: n(roi13) ?? 0,
      roi5: n(roi5) ?? 0,
      trend,
      liquidity: liq,
      psaTotal,
      psaRate,
      current,
      avg,
      shop: shopPrice,
      recom,
      judgment13: j13,
    });
    const totalEval = overall(score);
    const lock = lockLabel((shopPrice || 0) + FEE_13K);

    out.push({
      '総合評価': totalEval,
      '備考': noteText(totalEval, j13, trend, liq, lock, score),
      '現在相場': fmtInt(current),
      '平均相場': fmtInt(avg),
      'カード': item.strName,
      '収録パック': (item.arrayCategories && item.arrayCategories[0]) || '',
      'PSA10売値': fmtInt(psa10),
      'PSA9売値': fmtInt(psa9),
      'PSA10枚数': fmtInt(psa10Count),
      'PSA9枚数': fmtInt(psa9Count),
      'PSA合計': fmtInt(psaTotal),
      'PSA10率': psaRate,
      '2か月見立て': trend,
      '13k判断': j13,
      '13kROI': roi13,
      '5k判断': j5,
      '5kROI': roi5,
      '流動性': liq,
      '総合点': String(score),
      '資金ロック': lock,
      'URL': `https://pokeca-chart.com/gr/${item.strSlug}/`,
      '__shop_price': String(shopPrice ?? ''),
      '__おすすめの仕入れ値': String(recom ?? ''),
      '__PSA10差額': String(psaDiff ?? ''),
      '__利益率': String(profitRate ?? ''),
    });
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
