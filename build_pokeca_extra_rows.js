const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'pricing_settings.json');
const TCGPLAYER_OVERRIDE_PATH = path.join(__dirname, 'tcgplayer_overrides.json');
const DEFAULT_SETTINGS = {
  fee13k: 13000,
  fee5k: 5000,
  deliveryMonths13k: 2,
  deliveryMonths5k: 5,
  targetProfitRate13k: 20,
  targetProfitRate5k: 15,
};

const SETTINGS = loadSettings();
const FEE_13K = Number(SETTINGS.fee13k) || 13000;
const FEE_5K = Number(SETTINGS.fee5k) || 5000;
const TARGETS = new Set(process.argv.slice(2));
const snkrdunkAAvgCache = new Map();
const tcgplayerMatchCache = new Map();
const tcgplayerOverrideMap = loadTcgplayerOverrides();

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadTcgplayerOverrides() {
  try {
    const raw = fs.readFileSync(TCGPLAYER_OVERRIDE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [normalizeOverrideKey(key), value]),
    );
  } catch (_) {
    return {};
  }
}

function normalizeOverrideKey(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function resolveTcgplayerOverride(url) {
  const key = normalizeOverrideKey(url);
  const legacyKey = key.includes('pokeca-chart.com/gr/')
    ? normalizeOverrideKey(key.replace('https://pokeca-chart.com/gr/', 'https://toreca-souba.com/cards/'))
    : '';
  return tcgplayerOverrideMap[key] || (legacyKey ? tcgplayerOverrideMap[legacyKey] : null) || null;
}

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
    if (match) return Number(match[1]) || 0;
  }
  return 0;
}

async function fetchSnkrdunkAAverage(snkrdunkUrl, cacheKey) {
  const key = String(cacheKey || snkrdunkUrl || '');
  if (snkrdunkAAvgCache.has(key)) return snkrdunkAAvgCache.get(key);
  try {
    if (!snkrdunkUrl) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const pageRes = await fetch(snkrdunkUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
    });
    if (!pageRes.ok) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const html = await pageRes.text();
    const productCatalogId = extractProductCatalogId(html);
    if (!productCatalogId) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const historyRes = await fetch(`https://snkrdunk.com/v3/products/${productCatalogId}/trading-history`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
      },
    });
    if (!historyRes.ok) {
      snkrdunkAAvgCache.set(key, 0);
      return 0;
    }

    const hist = await historyRes.json();
    const trades = Array.isArray(hist.trades) ? hist.trades : [];
    const aTrades = trades.filter((trade) => String(trade.title || '').trim() === 'A' && Number(trade.price) > 0);
    const aAvg = aTrades.length
      ? Math.round(aTrades.reduce((sum, trade) => sum + Number(trade.price), 0) / aTrades.length)
      : 0;
    snkrdunkAAvgCache.set(key, aAvg);
    return aAvg;
  } catch (_) {
    snkrdunkAAvgCache.set(key, 0);
    return 0;
  }
}

function trendLabel(rate7, rate30) {
  const r7 = n(rate7) ?? 0;
  const r30 = n(rate30) ?? 0;
  if (r30 <= -0.15) return '下落注意';
  if ((r7 > 0.12 && r30 > 0.08) || r30 >= 0.2) return '上昇強い';
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
  if (totalInvestment <= 20000) return '軽い';
  if (totalInvestment <= 50000) return 'やや重い';
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
  if (roi >= 20) return 'あり';
  if (roi >= 10) return '注意';
  return '見送り';
}

function storeJudge(shopPrice, recom, upper13k) {
  if (!shopPrice || !recom || upper13k === null || upper13k === undefined) return '見送り';
  if (shopPrice <= recom && upper13k >= recom) return '可';
  if (shopPrice <= recom) return '条件付き';
  return '見送り';
}

function psaJudge(psaDiff, profitRate) {
  if (Number(psaDiff) > 0 && Number(profitRate) > 0) return '可';
  return '見送り';
}

function recomPrice(psa10, psa9, storeEval) {
  if (!psa10 || !psa9) return null;
  const expectedSale = (psa10 + psa9) / 2;
  const rate = Math.max(0, Number(SETTINGS.targetProfitRate13k) || 0) / 100;
  const upper = (expectedSale - FEE_13K * (1 + rate)) / (1 + rate);
  if (!Number.isFinite(upper) || upper <= 0) return 0;
  let factor = 0.85;
  if (storeEval === '可') factor = 0.9;
  else if (storeEval === '条件付き') factor = 0.82;
  else if (storeEval === '見送り') factor = 0.75;
  return round100(upper * factor);
}

function capPrice(psa10, psa9, fee, minProfitRate) {
  const expectedSale = (Number(psa10) + Number(psa9)) / 2;
  const rate = Math.max(0, Number(minProfitRate) || 0) / 100;
  const denom = 1 + rate;
  if (!Number.isFinite(expectedSale) || expectedSale <= 0 || denom <= 0) return null;
  const upper = (expectedSale - fee * denom) / denom;
  if (!Number.isFinite(upper) || upper <= 0) return 0;
  return round100(upper);
}

function resolvePsa9Price(psa9Raw, snkrdunkA, shopPrice) {
  const raw = n(psa9Raw) ?? 0;
  if (raw > 0) return { value: Math.round(raw), source: '実値' };
  const snkr = n(snkrdunkA) ?? 0;
  if (snkr > 0) return { value: Math.round(snkr), source: 'SNKRDUNK_A' };
  const shop = n(shopPrice) ?? 0;
  if (shop > 0) return { value: Math.round(shop * 0.75), source: '仕入れ額75%' };
  return { value: 0, source: '不明' };
}

const PACK_ENGLISH_MAP = {
  'SV プロモーションカード': 'SV Promo Cards',
  'S プロモーションカード': 'S Promo Cards',
  'SM プロモーションカード': 'SM Promo Cards',
  '25th ANNIVERSARY COLLECTION': '25th Anniversary Collection',
  'ポケモンカード151': 'Pokémon Card 151',
  'VSTARユニバース': 'VSTAR Universe',
  'シャイニートレジャーex': 'Shiny Treasure ex',
  '黒炎の支配者': 'Ruler of the Black Flame',
  '仰天のボルテッカー': 'Amazing Volt Tackle',
  'スターバース': 'Star Birth',
  'フュージョンアーツ': 'Fusion Arts',
  'イーブイヒーローズ': 'Eevee Heroes',
  '双璧のファイター': 'Twin Fighters',
  '変幻の仮面': 'Mask of Change',
  '超電ブレイカー': 'Super Electric Breaker',
  'クリムゾンヘイズ': 'Crimson Haze',
  'テラスタルフェスex': 'Terastal Festival ex',
  'メガシンフォニア': 'Mega Symphonia',
  'メガブレイブ': 'Mega Brave',
  'MEGAドリームex': 'MEGA Dream ex',
  'ロケット団の栄光': 'Glory of Team Rocket',
  'ブラックボルト': 'Black Bolt',
  'ホワイトフレア': 'White Flare',
  'ニンジャスピナー': 'Ninja Spinner',
  'ムニキスゼロ': 'Munikis Zero',
  'アビスアイ': 'Abyss Eye',
  'インフェルノX': 'Inferno X',
  'WCS23横浜 記念デッキ': 'WCS23 Yokohama Commemorative Deck',
  'ポケモンカードゲーム Classic': 'Pokémon Card Game Classic',
  'スタートデッキ100 バトルコレクション': 'Start Deck 100 Battle Collection',
  'メガブレイブ': 'Mega Brave',
  'メガシンフォニア': 'Mega Symphonia',
};

const NAME_REPLACEMENTS = [
  ['ロケット団の', "Rocket's "],
  ['名探偵', 'Detective '],
  ['メガ', 'Mega '],
  ['ピカチュウ', 'Pikachu'],
  ['リザードン', 'Charizard'],
  ['カイリュー', 'Dragonite'],
  ['ゲンガー', 'Gengar'],
  ['ダークライ', 'Darkrai'],
  ['ゼクロム', 'Zekrom'],
  ['レシラム', 'Reshiram'],
  ['ビクティニ', 'Victini'],
  ['ミュウツー', 'Mewtwo'],
  ['ミュウ', 'Mew'],
  ['イーブイ', 'Eevee'],
  ['ニンフィア', 'Sylveon'],
  ['ブラッキー', 'Umbreon'],
  ['サーナイト', 'Gardevoir'],
  ['ゲッコウガ', 'Greninja'],
  ['バンギラス', 'Tyranitar'],
  ['ギャラドス', 'Gyarados'],
  ['ギラティナ', 'Giratina'],
  ['ルカリオ', 'Lucario'],
  ['ジュラルドン', 'Duraludon'],
  ['サーフゴー', 'Gholdengo'],
  ['オーガポン', 'Ogerpon'],
  ['カミツオロチ', 'Hydrapple'],
  ['キチキギス', 'Fezandipiti'],
  ['イダイナキバ', 'Great Tusk'],
  ['テツノカイナ', 'Iron Hands'],
  ['テツノブジン', 'Iron Valiant'],
  ['テツノイバラ', 'Iron Thorns'],
  ['テツノドクガ', 'Iron Moth'],
  ['テツノツツミ', 'Iron Bundle'],
  ['メガリザードンX', 'Mega Charizard X'],
  ['メガカイリュー', 'Mega Dragonite'],
  ['メガゲンガー', 'Mega Gengar'],
  ['メガダークライ', 'Mega Darkrai'],
];

const NAME_EXACT_OVERRIDES = new Map([
  ['マリィ', 'Marnie'],
  ['リーリエ', 'Lillie'],
  ['リーリエの決心', "Lillie's Determination"],
  ['リーリエのピッピ', "Lillie's Clefairy"],
  ['リーリエのピッピ ex', "Lillie's Clefairy ex"],
  ['リーリエのピッピex', "Lillie's Clefairy ex"],
  ['ピッピ', 'Clefairy'],
  ['エーフィ', 'Espeon'],
  ['エーフィV', 'Espeon V'],
  ['エーフィVMAX', 'Espeon VMAX'],
  ['ガラルファイヤーV', 'Galarian Moltres V'],
  ['ガラルファイヤーVMAX', 'Galarian Moltres VMAX'],
  ['ガラルサンダーV', 'Galarian Zapdos V'],
  ['ガラルフリーザーV', 'Galarian Articuno V'],
  ['ゼイユ', 'Carmine'],
  ['メイのはげまし', "May's Encouragement"],
  ['ピカチュウ(マスターボールミラー)', 'Pikachu (Master Ball Mirror)'],
  ['ピカチュウ（マスターボールミラー）', 'Pikachu (Master Ball Mirror)'],
  ['ヒロシマのピカチュウ', "Pikachu (Hiroshima Promo)"],
  ['トウホクのピカチュウ', "Pikachu (Tohoku Promo)"],
  ['フクオカのピカチュウ', "Pikachu (Fukuoka Promo)"],
  ['ポケモンカード151', 'Pokémon Card 151'],
  ['ポケモンカードゲーム Classic', 'Pokémon Card Game Classic'],
  ['25th ANNIVERSARY COLLECTION', '25th Anniversary Collection'],
]);

for (const [key, value] of [...NAME_EXACT_OVERRIDES.entries()]) {
  NAME_EXACT_OVERRIDES.set(normalizeNameKey(key), value);
}

function stripBracketSuffix(text) {
  return String(text || '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

function extractCardNumber(text) {
  const match = String(text || '').match(/\[([^\]]+)\]\s*$/);
  return match ? match[1].trim() : '';
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeNameKey(text) {
  return normalizeSpaces(text)
    .replace(/[（）()\[\]【】'"’‘`・\-_.]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function replaceKnownNameParts(text) {
  let out = String(text || '');
  for (const [jp, en] of NAME_REPLACEMENTS) {
    out = out.split(jp).join(en);
  }
  return out;
}

function kanaToRomaji(text) {
  const input = String(text || '');
  const pairs = {
    キャ: 'kya', キュ: 'kyu', キョ: 'kyo',
    シャ: 'sha', シュ: 'shu', ショ: 'sho',
    チャ: 'cha', チュ: 'chu', チョ: 'cho',
    ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
    ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
    ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
    リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
    ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
    ジャ: 'ja', ジュ: 'ju', ジョ: 'jo',
    ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
    ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
    ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo',
    ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du',
    ウィ: 'wi', ウェ: 'we', ウォ: 'wo',
  };
  const single = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
    カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
    サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
    タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
    ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
    ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
    マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
    ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
    ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
    ワ: 'wa', ヲ: 'o', ン: 'n',
    ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
    ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
    ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
    バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
    パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
    ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo',
    ー: '-',
  };
  let out = '';
  let geminate = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next2 = input.slice(i, i + 2);
    const next3 = input.slice(i, i + 3);
    if (ch === 'ッ') {
      geminate = true;
      continue;
    }
    if (pairs[next2]) {
      let roman = pairs[next2];
      if (geminate) roman = roman[0] + roman;
      out += roman;
      geminate = false;
      i += 1;
      continue;
    }
    if (single[next3]) {
      let roman = single[next3];
      if (geminate) roman = roman[0] + roman;
      out += roman;
      geminate = false;
      i += 2;
      continue;
    }
    if (single[next2]) {
      let roman = single[next2];
      if (geminate) roman = roman[0] + roman;
      out += roman;
      geminate = false;
      i += 1;
      continue;
    }
    const kana = single[ch];
    if (kana) {
      let roman = kana;
      if (geminate && roman) roman = roman[0] + roman;
      out += roman;
      geminate = false;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
      const katakana = String.fromCharCode(code + 0x60);
      const roman = single[katakana] || ch;
      out += roman;
      geminate = false;
      continue;
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch;
      geminate = false;
      continue;
    }
    if (ch === '・' || ch === '－' || ch === 'ー') {
      out += ' ';
      geminate = false;
      continue;
    }
    out += ch;
  }
  return normalizeSpaces(out.replace(/\s+/g, ' '));
}

function toEnglishPack(pack) {
  return PACK_ENGLISH_MAP[String(pack || '').trim()] || String(pack || '').trim();
}

function toEnglishName(name) {
  const stripped = stripBracketSuffix(name);
  const exact = NAME_EXACT_OVERRIDES.get(stripped)
    || NAME_EXACT_OVERRIDES.get(normalizeSpaces(stripped))
    || NAME_EXACT_OVERRIDES.get(normalizeNameKey(stripped));
  if (exact) return exact;
  const replaced = replaceKnownNameParts(stripped);
  const romanized = kanaToRomaji(replaced);
  const spaced = romanized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z]+)no\s+([A-Z])/g, '$1 no $2')
    .replace(/([A-Za-z])ex\b/g, '$1 ex')
    .replace(/([A-Za-z])GX\b/g, '$1 GX')
    .replace(/([A-Za-z])VMAX\b/g, '$1 VMAX')
    .replace(/([A-Za-z])VSTAR\b/g, '$1 VSTAR')
    .replace(/\s+/g, ' ');
  const cleaned = normalizeSpaces(spaced)
    .replace(/\bNo\b/g, 'no')
    .replace(/\bEx\b/g, 'ex')
    .replace(/\bVmax\b/g, 'VMAX')
    .replace(/\bVstar\b/g, 'VSTAR');
  return cleaned
    .split(' ')
    .map((word) => {
      if (!word) return word;
      if (word.toLowerCase() === 'no') return 'no';
      if (word.toLowerCase() === 'ex') return 'ex';
      if (/^(gx|vmax|vstar|sv|sm|s|m|wcs\d+|p)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function buildTcgplayerCandidate(name, pack, cardNumber) {
  const englishPack = toEnglishPack(pack);
  const englishName = toEnglishName(name);
  const terms = [englishPack, englishName, cardNumber].filter(Boolean).join(' ');
  const hasEnoughInfo = Boolean(englishPack && englishName && cardNumber);
  const status = hasEnoughInfo ? '自動候補' : '情報未取得';
  return {
    englishPack,
    englishName,
    cardNumber,
    status,
    query: terms,
    url: hasEnoughInfo
      ? `https://www.tcgplayer.com/search/pokemon-japan/product?productLineName=pokemon-japan&view=grid&q=${encodeURIComponent(terms)}`
      : '',
  };
}

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCardNumber(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Z/]/g, '');
}

async function fetchTcgplayerMatch({ englishName, englishPack, cardNumber }) {
  const key = [normalizeMatchText(englishPack), normalizeMatchText(englishName), normalizeCardNumber(cardNumber)].join('|');
  if (tcgplayerMatchCache.has(key)) return tcgplayerMatchCache.get(key);

  const query = [englishPack, englishName, cardNumber].filter(Boolean).join(' ').trim();
  if (!query) {
    const empty = { status: '情報未取得', productId: '', directUrl: '', searchUrl: '' };
    tcgplayerMatchCache.set(key, empty);
    return empty;
  }

  const searchUrl = `https://www.tcgplayer.com/search/pokemon-japan/product?productLineName=pokemon-japan&view=grid&q=${encodeURIComponent(query)}`;
  const body = {
    size: 10,
    from: 0,
    algorithm: 'sales_dismax',
    context: {},
    filters: {
      exclude: { rarityName: ['Code Card', 'Common', 'Uncommon'], cardType: ['Land'] },
      range: { marketPrice: { gte: 10 } },
      term: { productLineName: ['pokemon-japan'] },
    },
    sessionId: key || 'tcgplayer-match',
  };
  if (normalizeMatchText(englishPack)) {
    body.filters.term.setName = [englishPack];
  }

  try {
    const res = await fetch(`https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(query)}&isList=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tcgplayer ${res.status}`);
    const json = await res.json();
    const products = Array.isArray(json?.results?.[0]?.results) ? json.results[0].results : [];
    const targetNumber = normalizeCardNumber(cardNumber);
    const targetName = normalizeMatchText(englishName);
    const targetPack = normalizeMatchText(englishPack);

    let best = null;
    let bestScore = -1;
    for (const product of products) {
      const pNumber = normalizeCardNumber(product?.customAttributes?.number || '');
      const pName = normalizeMatchText(product?.productName || '');
      const pSet = normalizeMatchText(product?.setName || '');
      const pLine = normalizeMatchText(product?.productLineName || '');
      let score = 0;
      if (targetNumber && pNumber === targetNumber) score += 120;
      else if (targetNumber && (pNumber.includes(targetNumber) || targetNumber.includes(pNumber))) score += 80;
      if (targetPack && pSet === targetPack) score += 35;
      else if (targetPack && (pSet.includes(targetPack) || targetPack.includes(pSet))) score += 18;
      if (targetName && pName.includes(targetName.split(' ')[0] || targetName)) score += 20;
      if (pLine.includes('pokemon japan')) score += 5;
      if ((product?.marketPrice ?? 0) > 0) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }

    if (!best || bestScore < 80) {
      const notFound = { status: '情報未取得', productId: '', directUrl: '', searchUrl };
      tcgplayerMatchCache.set(key, notFound);
      return notFound;
    }

    const productId = String(best.productId || '');
    const directUrl = productId ? `https://www.tcgplayer.com/product/${productId}` : '';
    const result = {
      status: '自動確定',
      productId,
      directUrl,
      searchUrl,
    };
    tcgplayerMatchCache.set(key, result);
    return result;
  } catch (_) {
    const failed = { status: '情報未取得', productId: '', directUrl: '', searchUrl };
    tcgplayerMatchCache.set(key, failed);
    return failed;
  }
}

function extractShopPrices(shops) {
  const inStock = shops.filter((x) => Number(x.stock) > 0);
  const pool = inStock.length ? inStock : shops;
  return pool.map((x) => Number(x.min_price)).filter((x) => x > 0);
}

function trimmedAverage(values) {
  const nums = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!nums.length) return 0;
  if (nums.length === 1) return Math.round(nums[0]);
  if (nums.length === 2) return Math.round((nums[0] + nums[1]) / 2);
  const pool = nums.length >= 4 ? nums.slice(1, -1) : nums;
  return Math.round(pool.reduce((sum, v) => sum + v, 0) / pool.length);
}

function blendMarketAverage(values) {
  return trimmedAverage(values);
}

function chooseShopPrice(shops, current, avg) {
  const prices = extractShopPrices(shops);
  if (!prices.length) return { price: normalizeShopPrice(null, current, avg), tradeCount: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  let raw = sorted[0];
  if (sorted.length >= 5) raw = sorted[2];
  else if (sorted.length >= 3) raw = sorted[1];
  else if (sorted.length === 2) raw = Math.round((sorted[0] + sorted[1]) / 2);
  return { price: normalizeShopPrice(raw, current, avg), tradeCount: sorted.length };
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

function scoreRow({ roi13, roi5, trend, liquidity, psaTotal, psaRate, current, avg, shop, recom, psaEval }) {
  let score = 0;
  if (roi13 >= 30) score += 3;
  else if (roi13 >= 15) score += 2;
  else if (roi13 >= 8) score += 1;
  if (roi5 >= 35) score += 1;
  if (roi5 >= 20) score += 1;
  if (trend === '押し目' || trend === '上昇強い') score += 1;
  if (trend === '下落注意') score -= 1;
  if (liquidity === '高' || liquidity === '中高') score += 1;
  if ((n(psaTotal) ?? 0) >= 1000) score += 1;
  if ((n(psaRate) ?? 0) >= 80) score += 1;
  if ((n(current) ?? 0) < (n(avg) ?? 0)) score += 1;
  if ((n(shop) ?? 0) < (n(recom) ?? 0)) score += 1;
  if (psaEval === '見送り') score -= 4;
  return score;
}

function overall(score) {
  if (score >= 7) return '買い';
  if (score >= 4) return '条件付き';
  return '見送り';
}

function noteText(overallEval, storeEval, psaEval, trend, liquidity, lock, score) {
  const parts = [];
  if (overallEval === '買い') parts.push('総合は仕入れ候補');
  else if (overallEval === '条件付き') parts.push('総合は条件付き');
  else parts.push('総合は見送り寄り');

  if (storeEval === '可') parts.push('店頭は可');
  else if (storeEval === '条件付き') parts.push('店頭は条件付き');
  else parts.push('店頭は見送り');

  parts.push(psaEval === '可' ? 'PSAは利益あり' : 'PSAは見送り');

  if (trend === '押し目') parts.push('2か月見立ては押し目');
  else if (trend === '横ばい') parts.push('2か月見立ては横ばい');
  else if (trend === '上昇強い') parts.push('2か月見立ては強い');
  else parts.push('2か月見立ては下落注意');

  if (score >= 6) parts.push('PSA鑑定数は薄めで値動き荒め');
  else if (score >= 4) parts.push('PSA鑑定数は標準的');
  else parts.push('PSA鑑定数は厚めで上値は重め');

  if (lock === '重い') parts.push('資金ロック重い');
  else if (lock === '重め') parts.push('資金ロック重め');
  else parts.push('資金ロックは比較的軽い');

  if (liquidity === '高') parts.push('流動性は高い');
  else if (liquidity === '中高') parts.push('流動性は中高');
  else parts.push('流動性は中');

  if (overallEval === '条件付き') parts.push('5kだけなら検討余地あり');
  return parts.join(' / ');
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
    const avgRaw = n(currentInfo.nPriceAvg) ?? 0;
    const psa9Raw = n(psa9Info.nPriceRecent) ?? 0;
    const psa10 = n(psa10Info.nPriceRecent) ?? 0;

    const shopData = await fetchJson(`https://api.pokeca-chart.com/php/get.php?function=get_shop_stock_data&item_id=${item.nItemId}`);
    const shopUrls = Array.isArray(shopData) ? shopData.map((row) => String(row.url || '')).filter(Boolean) : [];
    const snkrdunkUrl = shopUrls.find((url) => /snkrdunk\.com\/apparels\/\d+/.test(url)) || '';
    const snkrdunkA = await fetchSnkrdunkAAverage(snkrdunkUrl, item.strSlug || item.nItemId);
    const shopPrices = extractShopPrices(Array.isArray(shopData) ? shopData : []);
    const shopAvg = shopPrices.length ? trimmedAverage(shopPrices) : 0;
    const avg = blendMarketAverage([current, avgRaw, snkrdunkA, shopAvg]);

    const shopInfo = chooseShopPrice(Array.isArray(shopData) ? shopData : [], current, avg);
    const shopPrice = shopInfo.price;
    const tradeCount = shopInfo.tradeCount;
    const psa9Resolved = resolvePsa9Price(psa9Raw, snkrdunkA, shopPrice);
    const psa9 = psa9Resolved.value;
    const tcgCandidate = buildTcgplayerCandidate(
      item.strName,
      (item.arrayCategories && item.arrayCategories[0]) || '',
      extractCardNumber(item.strName),
    );
    const tcgMatch = await fetchTcgplayerMatch({
      englishName: tcgCandidate.englishName,
      englishPack: tcgCandidate.englishPack,
      cardNumber: tcgCandidate.cardNumber,
    });
    const tcgOverride = resolveTcgplayerOverride(`https://pokeca-chart.com/gr/${item.strSlug}/`);
    const tcgResolved = tcgOverride
      ? {
          status: '手動固定',
          productId: String(tcgOverride.productId || '').trim(),
          directUrl: String(tcgOverride.directUrl || '').trim() || (String(tcgOverride.productId || '').trim() ? `https://www.tcgplayer.com/product/${String(tcgOverride.productId || '').trim()}` : ''),
          searchUrl: String(tcgOverride.searchUrl || '').trim(),
        }
      : tcgMatch;

    const grdText = await fetchText(`https://api.pokeca-chart.com/php/get.php?function=get_item_grd_info&item_id=${item.nItemId}`);
    let grd = [];
    try {
      grd = JSON.parse(grdText);
    } catch {
      grd = [];
    }
    const grdInfo = grd[0] || {};
    const psa10Count = n(grdInfo.grd_status_10) ?? n(item.nPSA10Num) ?? '';
    const psa9Count = n(grdInfo.grd_status_9) ?? '';
    const psaTotal = n(grdInfo.grd_status_all) ?? '';
    const psaRate = psa10Count && psaTotal ? fmtNum((psa10Count / psaTotal) * 100, 1) : '';

    const trend = trendLabel(currentInfo.fRiseFallRate7, currentInfo.fRiseFallRate30);
    const liq = liquidityLabel(item.nPv, item.nVolume);
    const roi13 = shopPrice ? fmtNum((((psa10 + psa9) / 2 - shopPrice - FEE_13K) / (shopPrice + FEE_13K)) * 100, 1) : '';
    const roi5 = shopPrice ? fmtNum((((psa10 + psa9) / 2 - shopPrice - FEE_5K) / (shopPrice + FEE_5K)) * 100, 1) : '';

    const storeEval = judge13k(n(roi13) ?? 0, trend, liq);
    const psa10Diff = psa10 ? Math.round(psa10 - (shopPrice || 0) - FEE_13K) : '';
    const psaProfitRate = shopPrice ? fmtNum((psa10Diff / ((shopPrice || 0) + FEE_13K)) * 100, 1) : '';
    const psaEval = psaJudge(psa10Diff, psaProfitRate);
    const recom = recomPrice(psa10, psa9, storeEval);
    const upper13k = capPrice(psa10, psa9, FEE_13K, SETTINGS.targetProfitRate13k);
    const storeDecision = storeJudge(shopPrice, recom, upper13k);
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
      psaEval,
    });

    const totalEval = psaEval === '見送り' ? '見送り' : overall(score);
    const lock = lockLabel((shopPrice || 0) + FEE_13K);

    out.push({
      '総合評価': totalEval,
      '備考': noteText(totalEval, storeDecision, psaEval, trend, liq, lock, score),
      '現在相場': fmtInt(current),
      '平均相場': fmtInt(avg),
      'SNKRDUNK_A': fmtInt(snkrdunkA),
      'SHOP_AVG': fmtInt(shopAvg),
      'カード': item.strName,
      '収録パック': (item.arrayCategories && item.arrayCategories[0]) || '',
      'PSA10売値': fmtInt(psa10),
      'PSA9売値': fmtInt(psa9),
      'PSA9ソース': psa9Resolved.source,
      'PSA10枚数': fmtInt(psa10Count),
      'PSA9枚数': fmtInt(psa9Count),
      'PSA総数': fmtInt(psaTotal),
      'PSA10率': psaRate,
      '2か月見立て': trend,
      '店頭可否': storeDecision,
      '店頭判断': storeDecision,
      '13k判断': storeEval,
      '13kROI': roi13,
      'PSA可否': psaEval,
      'PSA判断': psaEval,
      '5k判断': judge5k(n(roi5) ?? 0),
      '5kROI': roi5,
      '流動性': liq,
      '取引件数': String(tradeCount),
      '総合点': String(score),
      '資金ロック': lock,
      '13k仕入れ上限': String(upper13k ?? ''),
      '5k仕入れ上限': String(capPrice(psa10, psa9, FEE_5K, SETTINGS.targetProfitRate5k) ?? ''),
      'URL': `https://pokeca-chart.com/gr/${item.strSlug}/`,
      '画像URL': String(item.strImgUrl || item.img || ''),
      '英語名候補': tcgCandidate.englishName,
      '英語カード名': tcgCandidate.englishName,
      '英語収録': tcgCandidate.englishPack,
      'カード番号': tcgCandidate.cardNumber,
      'TCGplayer取得状態': tcgResolved.status,
      'TCGplayer商品ID': tcgResolved.productId,
      'TCGplayer直リンク': tcgResolved.directUrl,
      'TCGplayer候補': tcgCandidate.query,
      'TCGplayer候補URL': tcgMatch.directUrl || tcgCandidate.url,
      'TCGplayer手動固定': tcgOverride ? '1' : '',
      '__shop_price': String(shopPrice ?? ''),
      '__snkrdunkA': String(snkrdunkA ?? ''),
      'おすすめの仕入れ値': String(recom ?? ''),
      '__おすすめの仕入れ値': String(recom ?? ''),
      '__PSA10差額': String(psa10Diff ?? ''),
      '__利益率': String(psaProfitRate ?? ''),
    });
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
