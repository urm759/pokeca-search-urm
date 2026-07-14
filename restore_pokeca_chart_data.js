const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dataPath = path.join(root, 'site', 'data.js');
const csvPath = process.argv[2];

if (!csvPath) {
  throw new Error('CSV path is required');
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function slugFromUrl(url) {
  const match = String(url || '').match(/\/cards\/([^/?#]+)/);
  return match ? match[1] : '';
}

function deriveRarity(card) {
  const text = String(card || '');
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

function imageUrlFromUrl(url) {
  const slug = slugFromUrl(url);
  return slug
    ? `https://pub-8c3b3a58e57f45c9a1d47c28200ebfa4.r2.dev/img_snk/${slug}.webp`
    : '';
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

const csvText = stripBom(fs.readFileSync(csvPath, 'utf8'));
let csvRows = JSON.parse(csvText);
if (!Array.isArray(csvRows)) csvRows = [csvRows];

const data = csvRows.map((csv) => {
  const current = String(csv['現在相場'] || '');
  const avg = String(csv['平均相場'] || '');
  const card = String(csv['カード'] || '');
  const url = String(csv['URL'] || '');
  return {
    '総合評価': String(csv['総合評価'] || ''),
    '現在相場': current,
    '平均相場': avg,
    'カード': card,
    '収録パック': String(csv['収録パック'] || ''),
    'レアリティ': String(csv['レアリティ'] || deriveRarity(card)),
    'PSA10売値': String(csv['PSA10売値'] || ''),
    'PSA9売値': String(csv['PSA9売値'] || ''),
    'PSA10枚数': String(csv['PSA10枚数'] || ''),
    'PSA9枚数': String(csv['PSA9枚数'] || ''),
    'PSA合計': String(csv['PSA合計'] || ''),
    'PSA10率': String(csv['PSA10率'] || ''),
    '2か月見立て': String(csv['2か月見立て'] || ''),
    '13k判断': String(csv['13k判断'] || ''),
    '店頭判断': String(csv['店頭判断'] || ''),
    'PSA判断': String(csv['PSA判断'] || ''),
    '13kROI': String(csv['13kROI'] || ''),
    '5k判断': String(csv['5k判断'] || ''),
    '5kROI': String(csv['5kROI'] || ''),
    '流動性': String(csv['流動性'] || ''),
    '取引件数': String(csv['取引件数'] || ''),
    '総合点': String(csv['総合点'] || ''),
    '資金ロック': String(csv['資金ロック'] || ''),
    'おすすめの仕入れ値': String(csv['おすすめの仕入れ値'] || ''),
    '13k仕入れ上限': String(csv['13k仕入れ上限'] || ''),
    '5k仕入れ上限': String(csv['5k仕入れ上限'] || ''),
    'PSA10差額': String(csv['PSA10差額'] || ''),
    '利益率': String(csv['利益率'] || ''),
    'URL': url,
    '画像URL': imageUrlFromUrl(url),
    '__sourcePrice': current,
    '__avgPrice': avg,
    '__storeJudge': String(csv['店頭判断'] || ''),
    '__psaJudge': String(csv['PSA判断'] || ''),
    'SNKRDUNK_A': '',
    '__snkrdunkA': '',
    '__torecaA': '',
    '__beautyPrice': '',
    '__priceSource': 'POKECA_CHART',
  };
});

const config = {
  fee13k: 13000,
  fee5k: 5000,
  deliveryMonths13k: 2,
  deliveryMonths5k: 5,
  targetProfitRate13k: 20,
  targetProfitRate5k: 15,
};

const out = `window.POKECA_CONFIG = ${JSON.stringify(config, null, 2)};
window.POKECA_DATA = ${JSON.stringify(data, null, 2)};
`;

fs.writeFileSync(dataPath, out, 'utf8');
console.log(`restored ${data.length} rows from ${csvPath}`);
