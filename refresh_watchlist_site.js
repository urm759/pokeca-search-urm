const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const siteDir = path.join(root, 'site');
const outputJs = path.join(siteDir, 'data.js');
const outputsDir = path.join(root, 'outputs');
const settingsPath = path.join(root, 'pricing_settings.json');
const watchlistCsvPath = path.join(root, 'inputs', 'pokeca-watchlist-20260714.csv');
const sourceScript = path.join(root, 'build_pokeca_extra_rows.js');

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function slugFromUrl(url) {
  const match = String(url || '').match(/\/gr\/([^/]+)/);
  return match ? match[1] : '';
}

function imageUrlFromSlug(slug) {
  return slug ? `https://pub-8c3b3a58e57f45c9a1d47c28200ebfa4.r2.dev/img_snk/${slug}.webp` : '';
}

function loadWatchlistSlugs() {
  if (!fs.existsSync(watchlistCsvPath)) {
    throw new Error(`Missing watchlist CSV: ${watchlistCsvPath}`);
  }
  const csvText = fs.readFileSync(watchlistCsvPath, 'utf8').replace(/^\uFEFF/, '');
  const csvRows = parseCsv(csvText);
  const headers = csvRows.shift() || [];
  const slugIndex = headers.indexOf('slug');
  if (slugIndex === -1) throw new Error('watchlist CSV does not contain a slug column');

  const slugs = [];
  const seen = new Set();
  for (const cols of csvRows) {
    const slug = String(cols[slugIndex] || '').trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function buildRowsFromSource(slugs) {
  const result = spawnSync(process.execPath, [sourceScript, ...slugs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'failed to build watchlist rows').trim());
  }

  const text = String(result.stdout || '').trim();
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected output from build_pokeca_extra_rows.js');
  }

  return rows.map((row) => {
    const url = String(row['URL'] || '');
    const slug = slugFromUrl(url);
    return {
      ...row,
      '画像URL': row['画像URL'] || imageUrlFromSlug(slug),
    };
  });
}

async function main() {
  const settings = loadSettings();
  const slugs = loadWatchlistSlugs();
  const rows = buildRowsFromSource(slugs);

  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });

  const js = `window.POKECA_CONFIG = ${JSON.stringify(settings, null, 2)};\nwindow.POKECA_DATA = ${JSON.stringify(rows, null, 2)};\n`;
  fs.writeFileSync(outputJs, js, 'utf8');

  console.log(`Rebuilt ${rows.length} cards from ${path.relative(root, watchlistCsvPath)}`);
  console.log(`Wrote ${path.relative(root, outputJs)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
