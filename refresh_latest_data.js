const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.cwd();
const shopNoteCsv = path.join(root, 'outputs', 'psa_ranked_13k_2month_pack_buy_front_shop_note_2026-07-08.csv');
const noteCsv = path.join(root, 'outputs', 'psa_ranked_13k_2month_pack_buy_front_note_2026-07-08.csv');
const buildRowsScript = path.join(root, 'build_pokeca_extra_rows.js');
const newUrls = [
  'https://pokeca-chart.com/gr/s6a-081-069/',
  'https://pokeca-chart.com/gr/s6a-083-069/',
  'https://pokeca-chart.com/gr/m5-118-081/',
  'https://pokeca-chart.com/gr/m2-116-080/',
  'https://pokeca-chart.com/gr/s12-110-098/',
  'https://pokeca-chart.com/gr/m1l-091-063/',
  'https://pokeca-chart.com/gr/sv9-126-100/',
  'https://pokeca-chart.com/gr/mc-765-742/',
  'https://pokeca-chart.com/gr/s12a-212-172/',
  'https://pokeca-chart.com/gr/m2a-250-193/',
  'https://pokeca-chart.com/gr/s12a-221-172/',
  'https://pokeca-chart.com/gr/cll-008-032/',
  'https://pokeca-chart.com/gr/sv8a-236-187/',
  'https://pokeca-chart.com/gr/sv8-136-106/',
  'https://pokeca-chart.com/gr/s8b-279-184/',
  'https://pokeca-chart.com/gr/sm11b-054-049/',
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function slugFromUrl(url) {
  const m = String(url).match(/https?:\/\/pokeca-chart\.com\/(?:gr\/)?([^/?#]+)\/?/);
  return m ? m[1] : '';
}

function buildCsv(rows, headers) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function main() {
  const source = fs.readFileSync(shopNoteCsv, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(source).filter((r) => r.length > 1);
  const header = rows.shift();
  const urlIndex = header.indexOf('URL');
  if (urlIndex < 0) throw new Error('URL column not found in shop note CSV.');

  const urls = [];
  const seen = new Set();
  for (const row of rows) {
    const url = row[urlIndex] || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  for (const url of newUrls) {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  const slugs = urls.map(slugFromUrl).filter(Boolean);
  const raw = execFileSync(process.execPath, [buildRowsScript, ...slugs], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  const freshRows = JSON.parse(raw);

  const noteHeaders = [
    '総合評価',
    '備考',
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
    '13kROI',
    '5k判断',
    '5kROI',
    '流動性',
    '総合点',
    '資金ロック',
    'URL',
  ];

  const noteRows = freshRows.map((row) => ({
    '総合評価': row['総合評価'] ?? '',
    '備考': row['備考'] ?? '',
    '現在相場': row['現在相場'] ?? '',
    '平均相場': row['平均相場'] ?? '',
    'カード': row['カード'] ?? '',
    '収録パック': row['収録パック'] ?? '',
    'PSA10売値': row['PSA10売値'] ?? '',
    'PSA9売値': row['PSA9売値'] ?? '',
    'PSA10枚数': row['PSA10枚数'] ?? '',
    'PSA9枚数': row['PSA9枚数'] ?? '',
    'PSA合計': row['PSA合計'] ?? '',
    'PSA10率': row['PSA10率'] ?? '',
    '2か月見立て': row['2か月見立て'] ?? '',
    '13k判断': row['13k判断'] ?? '',
    '13kROI': row['13kROI'] ?? '',
    '5k判断': row['5k判断'] ?? '',
    '5kROI': row['5kROI'] ?? '',
    '流動性': row['流動性'] ?? '',
    '総合点': row['総合点'] ?? '',
    '資金ロック': row['資金ロック'] ?? '',
    'URL': row['URL'] ?? '',
  }));

  fs.writeFileSync(noteCsv, buildCsv(noteRows, noteHeaders), 'utf8');
  console.log(`Wrote ${path.relative(root, noteCsv)} (${noteRows.length} rows)`);
}

main();
