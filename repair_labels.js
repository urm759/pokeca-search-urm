const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = process.cwd();
const dataPath = path.join(root, 'site', 'data.js');

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round100(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v / 100) * 100);
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
  return Number(roi).toFixed(1).replace(/\.0$/, '');
}

function profitFromPrice(psa10, shopPrice, fee) {
  const buy = num(shopPrice);
  const p10 = num(psa10);
  if (buy <= 0 || p10 <= 0) return '';
  return String(Math.round(p10 - buy - fee));
}

function profitRateFromPrice(psa10, shopPrice, fee) {
  const buy = num(shopPrice);
  const p10 = num(psa10);
  if (buy <= 0 || p10 <= 0) return '';
  const diff = p10 - buy - fee;
  const rate = (diff / (buy + fee)) * 100;
  return Number(rate).toFixed(1).replace(/\.0$/, '');
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

function overallLabel(storeJudge, psaJudge, roi13, trend, liquidity, target13k) {
  if (psaJudge === '見送り') return '見送り';
  const roi = num(roi13);
  if (psaJudge === '出す価値あり' && (storeJudge === '縦積み可' || storeJudge === '少数なら買い') && roi >= 8 && trend !== '下落注意') {
    return '買い';
  }
  if ((storeJudge === '縦積み可' || storeJudge === '少数なら買い') && roi >= target13k && trend !== '下落注意' && liquidity !== '低い') {
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

const raw = fs.readFileSync(dataPath, 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(raw, ctx);

const config = ctx.window.POKECA_CONFIG || {};
const rows = Array.isArray(ctx.window.POKECA_DATA) ? ctx.window.POKECA_DATA : [];
const fee13k = Number(config.fee13k) || 13000;
const fee5k = Number(config.fee5k) || 5000;
const target13k = Number(config.targetProfitRate13k) || 20;
const target5k = Number(config.targetProfitRate5k) || 15;

for (const row of rows) {
  const currentPrice = num(row['現在相場']);
  const avgPrice = num(row['平均相場']);
  const psa10 = num(row['PSA10売値']);
  const trend = trendLabel(row);
  const liquidity = liquidityLabel(row);
  const upper13k = upperBound(psa10, fee13k, target13k);
  const upper5k = upperBound(psa10, fee5k, target5k);
  const recommendation = chooseStoreFactor(row, upper13k, trend, liquidity);
  const storeJudge = judgeStore(currentPrice, recommendation, upper13k);
  const roi13 = roiFromPrice(psa10, currentPrice, fee13k);
  const roi5 = roiFromPrice(psa10, currentPrice, fee5k);
  const psaDiff = profitFromPrice(psa10, currentPrice, fee13k);
  const psaProfitRate = profitRateFromPrice(psa10, currentPrice, fee13k);
  const psaJudge = judgePSA(psaDiff);
  const overall = overallLabel(storeJudge, psaJudge, roi13, trend, liquidity, target13k);
  const simpleJudge5k = judge5k(roi5);
  const totalInvestment = currentPrice + fee13k;

  row['総合評価'] = overall;
  row['2か月見立て'] = trend;
  row['流動性'] = liquidity;
  row['13k判断'] = storeJudge;
  row['店頭判断'] = storeJudge;
  row['PSA判断'] = psaJudge;
  row['5k判断'] = simpleJudge5k;
  row['資金ロック'] = lockLabel(totalInvestment);
  row['総合点'] = String(scoreRow({
    ...row,
    '13kROI': roi13,
    '5kROI': roi5,
    'PSA10差額': psaDiff,
    '流動性': liquidity,
    '2か月見立て': trend,
    '現在相場': currentPrice,
    '平均相場': avgPrice,
    '店頭判断': storeJudge,
    'PSA判断': psaJudge,
  }));
  row['13kROI'] = roi13;
  row['5kROI'] = roi5;
  row['PSA10差額'] = psaDiff;
  row['利益率'] = psaProfitRate;
  row['13k仕入れ上限'] = String(upper13k);
  row['5k仕入れ上限'] = String(upper5k);
  row['おすすめの仕入れ値'] = String(recommendation);
  row['__storeJudge'] = storeJudge;
  row['__psaJudge'] = psaJudge;
}

const output = `window.POKECA_CONFIG = ${JSON.stringify(config, null, 2)};\nwindow.POKECA_DATA = ${JSON.stringify(rows, null, 2)};\n`;
fs.writeFileSync(dataPath, output, 'utf8');
console.log(`rewrote ${rows.length} rows`);
