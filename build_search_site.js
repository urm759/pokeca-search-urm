const fs = require('fs');
const path = require('path');

const root = process.cwd();
const siteDir = path.join(root, 'site');
const outputJs = path.join(siteDir, 'data.js');
const settingsPath = path.join(root, 'pricing_settings.json');

const outputShopCsv = path.join(root, 'outputs', 'psa_ranked_13k_2month_pack_buy_front_shop_note_2026-07-08.csv');
const outputSimpleCsv = path.join(root, 'outputs', 'psa_ranked_13k_2month_pack_buy_front_note_2026-07-08.csv');

const TORECA_HOME_URL = 'https://toreca-souba.com/cards';
const TORECA_CHUNK_FALLBACKS = [
  'https://toreca-souba.com/_next/static/chunks/280.4dbb4869a88e93bb.js',
];

function browserHeaders() {
  return {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
  };
}

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
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

const SETTINGS = loadSettings();
const FEE_13K = Number(SETTINGS.fee13k) || 13000;
const FEE_5K = Number(SETTINGS.fee5k) || 5000;
const TARGET_13K = Number(SETTINGS.targetProfitRate13k) || 20;
const TARGET_5K = Number(SETTINGS.targetProfitRate5k) || 15;

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round100(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v / 100) * 100);
}

function fmtInt(v) {
  if (v === null || v === undefined || v === '') return '';
  return String(Math.round(num(v)));
}

function fmtPct(v) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v).toFixed(1).replace(/\.0$/, '');
}

const textCache = new Map();
const snkrdunkAAvgCache = new Map();
const torecaMarketCache = new Map();

async function fetchText(url) {
  if (textCache.has(url)) return textCache.get(url);
  const pending = (async () => {
    const res = await fetch(url, { headers: browserHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }
    return res.text();
  })();
  textCache.set(url, pending);
  try {
    return await pending;
  } catch (err) {
    textCache.delete(url);
    throw err;
  }
}

function extractSnkrdunkUrl(html) {
  const match = String(html || '').match(/https:\/\/snkrdunk\.com\/apparels\/\d+/);
  return match ? match[0] : '';
}

function extractProductCatalogId(html) {
  const text = String(html || '');
  const patterns = [
    /productCatalogId\\":(\d+)/,
    /productCatalogId":(\d+)/,
    /"productCatalogId":(\d+)/,
    /productCatalogId:(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return num(match[1]);
  }
  return 0;
}

function extractTorecaTrades(html) {
  const normalized = String(html || '').replace(/\\"/g, '"');
  const trades = [];
  for (const match of normalized.matchAll(/\{"price":(\d+),"soldAt":"([^"]+)","label":"([^"]*)","title":"([^"]+)"\}/g)) {
    trades.push({
      price: num(match[1]),
      soldAt: match[2],
      label: match[3],
      title: match[4],
    });
  }
  return trades;
}

function extractBeautyPrice(html) {
  const normalized = String(html || '').replace(/\\"/g, '"');
  const patterns = [
    /素体（美品）の最新相場は約¥([0-9,]+)/,
    /素体の最新相場は約¥([0-9,]+)/,
    /素体¥([0-9,]+)/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return num(match[1]);
  }
  return 0;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows, headers) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function extractPack(name) {
  const text = String(name || '');
  const matches = [...text.matchAll(/\(([^()]*)\)\s*$/g)];
  if (!matches.length) return '';
  return matches[matches.length - 1][1].trim();
}

function extractCardLabel(name) {
  return String(name || '')
    .replace(/\s*\(([^()]*)\)\s*$/, '')
    .trim();
}

function extractRarityFromName(name) {
  const direct = String(name || '').trim();
  if (!direct) return '';
  const tokens = ['MUR', 'SAR', 'CSR', 'CHR', 'AR', 'SR', 'UR', 'HR', 'SSR', 'RRR', 'RR', 'R', 'U', 'C', 'PR', 'P'];
  for (const token of tokens) {
    if (new RegExp(`\\b${token}\\b`).test(direct)) return token;
  }
  if (/プロモ/.test(direct)) return 'プロモ';
  const bracket = direct.match(/\[(.*?)\]/);
  if (bracket) {
    for (const token of tokens) {
      if (new RegExp(`\\b${token}\\b`, 'i').test(bracket[1])) return token;
    }
    if (/プロモ/i.test(bracket[1])) return 'プロモ';
  }
  return '';
}

function trendLabel(item) {
  const chg7 = num(item.chg7);
  const chg30 = num(item.chg30);
  const hotPct = num(item.hotPct);
  if (chg7 <= -0.12 && chg30 <= -0.08) return '下落注意';
  if (chg30 >= 0.18 || (chg7 >= 0.1 && chg30 >= 0.08) || hotPct >= 35) return '上昇継続';
  if (chg7 > 0 && chg30 < 0) return '反発期待';
  if (chg7 > 0.05) return '伸び始め';
  return '様子見';
}

function liquidityLabel(item) {
  const tv30 = num(item.tv30);
  const listings = num(item.snkListings);
  if (tv30 >= 80 || listings >= 80) return '高い';
  if (tv30 >= 20 || listings >= 20) return '中';
  return '低い';
}

function lockLabel(totalInvestment) {
  if (totalInvestment <= 20000) return '軽い';
  if (totalInvestment <= 50000) return '普通';
  if (totalInvestment <= 80000) return '重い';
  return 'かなり重い';
}

function upperBound(psa10, fee, targetRatePct) {
  const p10 = num(psa10);
  const rate = Math.max(0, num(targetRatePct)) / 100;
  const denom = 0.625 + rate;
  if (!Number.isFinite(p10) || p10 <= 0 || denom <= 0) return 0;
  const upper = (p10 / 2 - fee * (1 + rate)) / denom;
  return Math.max(0, round100(upper));
}

function roiFromPrice(psa10, shopPrice, fee) {
  const buy = num(shopPrice);
  const p10 = num(psa10);
  if (buy <= 0 || p10 <= 0) return '';
  const expectedSale = (p10 + buy * 0.75) / 2;
  const roi = ((expectedSale - buy - fee) / (buy + fee)) * 100;
  return fmtPct(roi);
}

function profitFromPrice(psa10, shopPrice, fee) {
  const buy = num(shopPrice);
  const p10 = num(psa10);
  if (buy <= 0 || p10 <= 0) return '';
  return fmtInt(p10 - buy - fee);
}

function profitRateFromPrice(psa10, shopPrice, fee) {
  const buy = num(shopPrice);
  const p10 = num(psa10);
  if (buy <= 0 || p10 <= 0) return '';
  const diff = p10 - buy - fee;
  const rate = (diff / (buy + fee)) * 100;
  return fmtPct(rate);
}

function chooseStoreFactor(item, upper, trend, liquidity) {
  let factor = 0.86;
  if (trend === '上昇継続') factor = 0.94;
  else if (trend === '伸び始め') factor = 0.91;
  else if (trend === '反発期待') factor = 0.87;
  else if (trend === '様子見') factor = 0.83;
  else if (trend === '下落注意') factor = 0.79;

  if (liquidity === '高い') factor += 0.04;
  else if (liquidity === '低い') factor -= 0.02;

  if (num(item.hotPct) >= 40) factor += 0.03;
  if (num(item.days) <= 3) factor += 0.02;
  else if (num(item.days) <= 7) factor += 0.01;

  factor = Math.min(0.98, Math.max(0.75, factor));
  return round100(upper * factor);
}

function judgeStore(currentPrice, recom, upper) {
  const price = num(currentPrice);
  const rec = num(recom);
  const cap = num(upper);
  if (price <= 0 || rec <= 0 || cap <= 0) return '見送り';
  if (price <= rec && price <= cap) return '縦積み可';
  if (price <= rec * 1.15 && price <= cap) return '少数なら買い';
  if (price <= cap * 1.1) return 'かなり安ければ';
  return '見送り';
}

function judge5k(roi) {
  const v = num(roi);
  if (v >= 30) return '縦積み可';
  if (v >= 15) return '少数なら買い';
  if (v >= 5) return 'かなり安ければ';
  return '見送り';
}

function judgePSA(profit) {
  return num(profit) > 0 ? '出す価値あり' : '見送り';
}

function tradeCount(item) {
  const candidates = [item.tv30, item.tv7, item.tv3, item.p10tv30, item.p10tv7, item.snkListings];
  const best = candidates.map(num).reduce((max, value) => Math.max(max, value), 0);
  return best;
}

function overallLabel(storeJudge, psaJudge, roi13, trend, liquidity) {
  if (psaJudge === '見送り') return '見送り';
  const roi = num(roi13);
  if (psaJudge === '出す価値あり' && (storeJudge === '縦積み可' || storeJudge === '少数なら買い') && roi >= 8 && trend !== '下落注意') {
    return '買い';
  }
  if ((storeJudge === '縦積み可' || storeJudge === '少数なら買い') && roi >= TARGET_13K && trend !== '下落注意' && liquidity !== '低い') {
    return '買い';
  }
  if ((storeJudge === '縦積み可' || storeJudge === '少数なら買い' || storeJudge === 'かなり安ければ') && roi >= 8) {
    return '条件付き';
  }
  return '見送り';
}

function scoreRow(row) {
  let score = 0;
  const roi13 = num(row['13kROI']);
  const roi5 = num(row['5kROI']);
  const profit = num(row['PSA10差額']);
  const liquidity = row['流動性'];
  const trend = row['2か月見立て'];
  const storeJudge = row['店頭判断'];

  if (roi13 >= 20) score += 3;
  else if (roi13 >= 12) score += 2;
  else if (roi13 >= 0) score += 1;

  if (roi5 >= 25) score += 1;
  if (roi5 >= 15) score += 1;
  if (profit > 0) score += 2;
  if (liquidity === '高い') score += 2;
  else if (liquidity === '中') score += 1;
  if (trend === '上昇継続' || trend === '伸び始め' || trend === '反発期待') score += 1;
  if (row['現在相場'] && row['平均相場'] && num(row['現在相場']) < num(row['平均相場'])) score += 1;
  if (storeJudge === '縦積み可') score += 2;
  else if (storeJudge === '少数なら買い') score += 1;
  if (row['PSA判断'] === '出す価値あり') score += 2;
  else if (row['PSA判断'] === '様子見') score += 0;
  else if (row['PSA判断'] === '見送り') score -= 4;
  return score;
}

function extractSnkrdunkUrl(html) {
  const match = String(html || '').match(/https:\/\/snkrdunk\.com\/apparels\/\d+/);
  return match ? match[0] : '';
}

function extractProductCatalogId(html) {
  const text = String(html || '');
  const patterns = [
    /productCatalogId\\":(\d+)/,
    /productCatalogId":(\d+)/,
    /"productCatalogId":(\d+)/,
    /productCatalogId:(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return num(match[1]);
  }
  return 0;
}

async function fetchTorecaMarketDetails(item) {
  const cacheKey = String(item.id || '');
  if (torecaMarketCache.has(cacheKey)) return torecaMarketCache.get(cacheKey);

  try {
    const torecaHtml = await fetchText(`https://toreca-souba.com/cards/${item.id}`);
    const trades = extractTorecaTrades(torecaHtml);
    const torecaATrades = trades.filter((trade) => String(trade.title || '').trim() === 'A' && num(trade.price) > 0);
    const torecaA = torecaATrades.length
      ? Math.round(torecaATrades.reduce((sum, trade) => sum + num(trade.price), 0) / torecaATrades.length)
      : 0;
    const beautyPrice = extractBeautyPrice(torecaHtml);
    const snkrdunkUrl = extractSnkrdunkUrl(torecaHtml);
    const result = { torecaA, beautyPrice, snkrdunkUrl };
    torecaMarketCache.set(cacheKey, result);
    return result;
  } catch (_) {
    const result = { torecaA: 0, beautyPrice: 0, snkrdunkUrl: '' };
    torecaMarketCache.set(cacheKey, result);
    return result;
  }
}

async function fetchSnkrdunkAAverage(snkrdunkUrl, cacheKey) {
  const key = String(cacheKey || snkrdunkUrl || '');
  if (snkrdunkAAvgCache.has(key)) return snkrdunkAAvgCache.get(key);

  try {
    if (!snkrdunkUrl) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const snkrdunkHtml = await fetchText(snkrdunkUrl);
    const productCatalogId = extractProductCatalogId(snkrdunkHtml);
    if (!productCatalogId) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const historyRes = await fetch(`https://snkrdunk.com/v3/products/${productCatalogId}/trading-history`, {
      headers: browserHeaders(),
    });
    if (!historyRes.ok) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const history = await historyRes.json();
    const aTrades = Array.isArray(history.trades)
      ? history.trades.filter((trade) => String(trade.title || '').trim() === 'A' && num(trade.price) > 0)
      : [];
    const aAvg = aTrades.length
      ? Math.round(aTrades.reduce((sum, trade) => sum + num(trade.price), 0) / aTrades.length)
      : 0;
    snkrdunkAAvgCache.set(key, aAvg);
    return aAvg;
  } catch (_) {
    snkrdunkAAvgCache.set(key, 0);
    return 0;
  }
}

async function normalizeRecord(item) {
  const toreca = await fetchTorecaMarketDetails(item);
  const snkrdunkA = await fetchSnkrdunkAAverage(toreca.snkrdunkUrl, item.id);
  const currentPrice = num(snkrdunkA || toreca.torecaA || toreca.beautyPrice || item.snkPrice || item.price);
  const avgPrice = num(item.price || item.snkPrice || currentPrice);
  const psa10 = num(item.snkPsa10Price);
  const listings = num(item.snkListings);
  const psa10Count = num(item.snkPsa10Count);
  const pack = extractPack(item.name);
  const title = extractCardLabel(item.name);
  const rarity = String(item.rarity || extractRarityFromName(item.name) || '').trim();
  const trend = trendLabel(item);
  const liquidity = liquidityLabel(item);
  const upper13k = upperBound(psa10, FEE_13K, TARGET_13K);
  const upper5k = upperBound(psa10, FEE_5K, TARGET_5K);
  const recommendation = chooseStoreFactor(item, upper13k, trend, liquidity);
  const storeJudge = judgeStore(currentPrice, recommendation, upper13k);
  const roi13 = roiFromPrice(psa10, currentPrice, FEE_13K);
  const roi5 = roiFromPrice(psa10, currentPrice, FEE_5K);
  const psaDiff = profitFromPrice(psa10, currentPrice, FEE_13K);
  const psaProfitRate = profitRateFromPrice(psa10, currentPrice, FEE_13K);
  const psaJudge = judgePSA(psaDiff);
  const overall = overallLabel(storeJudge, psaJudge, roi13, trend, liquidity);
  const simpleJudge5k = judge5k(roi5);
  const totalInvestment = currentPrice + FEE_13K;
  const score = scoreRow({
    '13kROI': roi13,
    '5kROI': roi5,
    'PSA10差額': psaDiff,
    '流動性': liquidity,
    '2か月見立て': trend,
    '現在相場': currentPrice,
    '平均相場': avgPrice,
    '店頭判断': storeJudge,
    'PSA判断': psaJudge,
  });

  return {
    '総合評価': overall,
    '現在相場': fmtInt(currentPrice),
    '平均相場': fmtInt(avgPrice),
    'カード': title,
    '収録パック': pack,
    'レアリティ': rarity,
    'PSA10売値': fmtInt(psa10),
    'PSA9売値': '',
    'PSA10枚数': fmtInt(psa10Count),
    'PSA9枚数': '',
    'PSA合計': fmtInt(listings),
    'PSA10率': listings > 0 ? fmtPct((psa10Count / listings) * 100) : '',
    '2か月見立て': trend,
    '13k判断': storeJudge,
    '店頭判断': storeJudge,
    'PSA判断': psaJudge,
    '13kROI': roi13,
    '5k判断': simpleJudge5k,
    '5kROI': roi5,
    '流動性': liquidity,
    '取引件数': fmtInt(tradeCount(item)),
    '総合点': String(score),
    '資金ロック': lockLabel(totalInvestment),
    'おすすめの仕入れ値': fmtInt(recommendation),
    '13k仕入れ上限': fmtInt(upper13k),
    '5k仕入れ上限': fmtInt(upper5k),
    'PSA10差額': psaDiff,
    '利益率': psaProfitRate,
    'URL': `https://toreca-souba.com/cards/${item.id}`,
    '画像URL': item.img || '',
    'SNKRDUNK_A': fmtInt(snkrdunkA),
    '__sourcePrice': fmtInt(currentPrice),
    '__avgPrice': fmtInt(avgPrice),
    '__snkrdunkA': fmtInt(snkrdunkA),
    '__torecaA': fmtInt(toreca.torecaA),
    '__beautyPrice': fmtInt(toreca.beautyPrice),
    '__priceSource': snkrdunkA ? 'SNKRDUNK_A' : toreca.torecaA ? 'TORECA_A' : toreca.beautyPrice ? 'BEAUTY' : 'CURRENT',
    '__storeJudge': storeJudge,
    '__psaJudge': psaJudge,
  };
}

function csvRows(rows) {
  return rows.map((row) => ({
    総合評価: row['総合評価'],
    現在相場: row['現在相場'],
    平均相場: row['平均相場'],
    カード: row['カード'],
    収録パック: row['収録パック'],
    レアリティ: row['レアリティ'],
    PSA10売値: row['PSA10売値'],
    PSA9売値: row['PSA9売値'],
    PSA10枚数: row['PSA10枚数'],
    PSA9枚数: row['PSA9枚数'],
    PSA合計: row['PSA合計'],
    PSA10率: row['PSA10率'],
    '2か月見立て': row['2か月見立て'],
    '13k判断': row['13k判断'],
    店頭判断: row['店頭判断'],
    PSA判断: row['PSA判断'],
    '13kROI': row['13kROI'],
    '5k判断': row['5k判断'],
    '5kROI': row['5kROI'],
    流動性: row['流動性'],
    取引件数: row['取引件数'],
    総合点: row['総合点'],
    資金ロック: row['資金ロック'],
    'おすすめの仕入れ値': row['おすすめの仕入れ値'],
    '13k仕入れ上限': row['13k仕入れ上限'],
    '5k仕入れ上限': row['5k仕入れ上限'],
    PSA10差額: row['PSA10差額'],
    利益率: row['利益率'],
    URL: row['URL'],
  }));
}

async function discoverTorecaChunkUrls() {
  const res = await fetch(TORECA_HOME_URL, { headers: browserHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch toreca homepage: ${res.status}`);
  const html = await res.text();
  const urls = new Set();
  for (const match of html.matchAll(/\/_next\/static\/chunks\/[^"'`\s>]+\.js/g)) {
    urls.add(`https://toreca-souba.com${match[0]}`);
  }
  for (const fallback of TORECA_CHUNK_FALLBACKS) urls.add(fallback);
  return [...urls];
}

async function fetchAndParseSource() {
  const candidates = await discoverTorecaChunkUrls();
  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: browserHeaders() });
      if (!res.ok) {
        lastError = new Error(`Failed to fetch toreca data chunk: ${res.status} (${url})`);
        continue;
      }
      const text = await res.text();
      const match = text.match(/a\.exports=JSON\.parse\('([\s\S]*)'\)\}/);
      if (!match) {
        lastError = new Error(`Could not find toreca dataset payload in: ${url}`);
        continue;
      }
      const jsonText = Function(
        `return \`${match[1].replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`;`
      )();
      return JSON.parse(jsonText);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Unable to discover toreca dataset source');
}

async function main() {
  const source = await fetchAndParseSource();
  const rows = [];
  for (const item of source.filter((entry) => entry.title === 'ポケモン')) {
    rows.push(await normalizeRecord(item));
  }

  rows.sort((a, b) => {
    const diff = num(b['総合点']) - num(a['総合点']);
    if (diff !== 0) return diff;
    return String(a['カード']).localeCompare(String(b['カード']), 'ja');
  });

  const headers = [
    '総合評価',
    '現在相場',
    '平均相場',
    'カード',
    '収録パック',
    'PSA10売値',
    'PSA9売値',
    'PSA10枚数',
    'PSA9枚数',
    'PSA合計',
    'PSA10率',
    '2か月見立て',
    '13k判断',
    '店頭判断',
    'PSA判断',
    '13kROI',
    '5k判断',
    '5kROI',
    '流動性',
    '取引件数',
    '総合点',
    '資金ロック',
    'おすすめの仕入れ値',
    '13k仕入れ上限',
    '5k仕入れ上限',
    'PSA10差額',
    '利益率',
    'URL',
  ];

  const csv = buildCsv(csvRows(rows), headers);

  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  fs.mkdirSync(siteDir, { recursive: true });

  fs.writeFileSync(outputShopCsv, csv, 'utf8');
  fs.writeFileSync(outputSimpleCsv, csv, 'utf8');

  const js = `window.POKECA_CONFIG = ${JSON.stringify(SETTINGS, null, 2)};\nwindow.POKECA_DATA = ${JSON.stringify(rows, null, 2)};\n`;
  fs.writeFileSync(outputJs, js, 'utf8');

  console.log(`Wrote ${path.relative(root, outputJs)} (${rows.length} rows)`);
  console.log(`Wrote ${path.relative(root, outputShopCsv)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
