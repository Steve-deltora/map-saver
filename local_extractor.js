// local_extractor.js
// 免費、離線的店名/地址抽取引擎（不需要任何 API）
// 使用 Regex + 啟發式規則

// ─── 業態後綴字典 ────────────────────────────────────────────────────────────

const BUSINESS_TYPES = {
  restaurant: [
    // 中文
    '餐廳', '餐館', '餐室', '飯店', '飯館', '食堂', '食府', '食肆',
    '小吃', '小吃店', '小館', '便當', '便當店', '早餐店', '麵店', '麵館',
    '牛肉麵', '拉麵', '烏龍麵', '蕎麥麵', '冷麵', '涼麵',
    '壽司', '壽司店', '壽司屋', '迴轉壽司',
    '火鍋', '火鍋店', '涮涮鍋', '鍋物', '熱炒',
    '燒肉', '燒烤', '串燒', '烤肉', '炸雞', '鹹酥雞', '雞排',
    '牛排', '排餐', '定食', '料理', '懷石',
    '海鮮', '海産', '生魚片', '刺身',
    '快餐', '速食', '漢堡', '披薩',
    '粥', '稀飯', '湯品', '雞湯',
    '素食', '蔬食',
    // 日文
    'レストラン', '食堂', '料理', '定食屋', 'ダイニング',
    'ラーメン', 'うどん', 'そば', '蕎麦', '寿司',
    '焼肉', '焼き鳥', '居酒屋', 'バー',
    '弁当', '定食',
  ],
  cafe: [
    // 中文
    '咖啡廳', '咖啡館', '咖啡店', '咖啡室', '珈琲',
    '茶室', '茶館', '茶坊', '茶藝館', '手搖飲', '飲料店',
    '奶茶店', '珍奶店', '泡沫紅茶',
    '甜點', '甜點店', '甜品', '甜品店', '蛋糕店', '烘焙坊',
    '麵包店', '烘焙', '糕點', '點心',
    '冰店', '剉冰', '霜淇淋', '冰淇淋', '甜冰',
    // 英文
    'café', 'cafe', 'coffee', 'bakery', 'patisserie', 'boulangerie',
    // 日文
    'カフェ', 'コーヒー', 'ケーキ', 'パン屋', 'ベーカリー',
  ],
  bar: [
    '酒吧', '酒館', '酒屋', '居酒屋', '小酒館', '立飲',
    'bar', 'pub', 'bistro', 'lounge',
    'バー', '居酒屋',
  ],
  shop: [
    '商店', '店鋪', '門市', '專賣店', '精品',
    '書店', '文具店', '藥妝店', '藥局', '藥妝',
    '超市', '市場', '百貨', '購物',
    '服飾', '鞋店', '配件', '飾品',
    'shop', 'store', 'boutique', 'market',
  ],
  attraction: [
    '公園', '動物園', '植物園', '水族館', '博物館', '美術館',
    '廟', '神社', '寺', '教堂', '大教堂',
    '城堡', '古蹟', '遺址', '景區', '景點',
    '海灘', '溫泉', '瀑布', '山頂',
    '市集', '夜市',
  ],
  hotel: [
    '旅館', '旅店', '民宿', '民宿', '青旅', '青年旅舍',
    '飯店', '大飯店', '酒店', '旅社',
    'hotel', 'hostel', 'inn', 'resort',
    'ホテル', '旅館', '民宿',
  ],
};

// 把業態關鍵字打平，建立 type 對照表
const TYPE_KEYWORD_MAP = [];
for (const [type, keywords] of Object.entries(BUSINESS_TYPES)) {
  for (const kw of keywords) {
    TYPE_KEYWORD_MAP.push({ kw, type });
  }
}
// 由長到短排序，優先匹配較長的關鍵字
TYPE_KEYWORD_MAP.sort((a, b) => b.kw.length - a.kw.length);

// ─── 主函式 ──────────────────────────────────────────────────────────────────

function localExtractPlaces(text) {
  const results = new Map(); // 用 Map 去重

  const addPlace = (name, type, confidence, source) => {
    name = name.trim();
    if (name.length < 2 || name.length > 40) return;
    if (isNoise(name)) return;

    const key = name.toLowerCase().replace(/\s+/g, '');
    if (!results.has(key)) {
      results.set(key, { name, type, confidence, source });
    } else {
      // 更高的 confidence 覆蓋
      const existing = results.get(key);
      if (confidence > existing.confidence) {
        results.set(key, { name, type, confidence, source });
      }
    }
  };

  // 1. 引號內的文字（最可靠）
  extractQuoted(text, addPlace);

  // 2. 業態後綴 pattern
  extractBySuffix(text, addPlace);

  // 3. Hashtag 中的地點
  extractHashtags(text, addPlace);

  // 4. 地址
  extractAddresses(text, addPlace);

  // 5. 英文 Title Case 名稱
  extractTitleCase(text, addPlace);

  return Array.from(results.values())
    .sort((a, b) => b.confidence - a.confidence);
}

// ─── 1. 引號抽取 ──────────────────────────────────────────────────────────────

function extractQuoted(text, addPlace) {
  // 中文書名號/引號: 「...」『...』【...】《...》
  const cjkQuotes = /[「『【《]([^」』】》\n]{2,30})[」』】》]/g;
  let m;
  while ((m = cjkQuotes.exec(text)) !== null) {
    const name = m[1].trim();
    const type = guessType(name);
    addPlace(name, type, type !== 'other' ? 0.85 : 0.6, 'quoted-cjk');
  }

  // 全形引號: "..." "..."
  const fullWidthQuotes = /[\u201c\u300c]([^\u201d\u300d\n]{2,30})[\u201d\u300d]/g;
  while ((m = fullWidthQuotes.exec(text)) !== null) {
    const name = m[1].trim();
    const type = guessType(name);
    addPlace(name, type, type !== 'other' ? 0.8 : 0.55, 'quoted-fw');
  }

  // ASCII double quotes (less reliable)
  const asciiQuotes = /"([A-Za-z\u4e00-\u9fff\u3040-\u30ff][^"\n]{1,28})"/g;
  while ((m = asciiQuotes.exec(text)) !== null) {
    const name = m[1].trim();
    const type = guessType(name);
    if (type !== 'other') {
      addPlace(name, type, 0.7, 'quoted-ascii');
    }
  }
}

// ─── 2. 業態後綴 ─────────────────────────────────────────────────────────────

function extractBySuffix(text, addPlace) {
  // 前綴：2-8個CJK字符 + 業態關鍵字
  // 例如：「龍潮拉麵」「一蘭拉麵」「星巴克咖啡」
  for (const { kw, type } of TYPE_KEYWORD_MAP) {
    // 逃脫 regex 特殊字元
    const escaped = escapeRegex(kw);

    // CJK 前綴
    const pattern = new RegExp(
      `([\u4e00-\u9fff\u3040-\u30ff\uff00-\uffef·・]{1,8}${escaped})`,
      'g'
    );
    let m;
    while ((m = pattern.exec(text)) !== null) {
      addPlace(m[1], type, 0.75, `suffix:${kw}`);
    }

    // 英文前綴（用於英文名稱 + 業態）
    if (/[a-zA-Z]/.test(kw)) {
      const enPattern = new RegExp(
        `([A-Z][a-zA-Z\\s'&]{1,20}${escaped})`,
        'g'
      );
      while ((m = enPattern.exec(text)) !== null) {
        addPlace(m[1].trim(), type, 0.7, `suffix-en:${kw}`);
      }
    }
  }
}

// ─── 3. Hashtag 抽取 ─────────────────────────────────────────────────────────

function extractHashtags(text, addPlace) {
  const pattern = /#([\u4e00-\u9fff\u3040-\u30fffA-Za-z0-9_]{2,25})/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const tag = m[1];
    const type = guessType(tag);
    // 只收業態相關的 hashtag，避免收到一般標籤
    if (type !== 'other') {
      addPlace(tag, type, 0.65, 'hashtag');
    }
    // 或者 tag 包含地名關鍵字
    if (hasLocationKeyword(tag)) {
      addPlace(tag, type, 0.6, 'hashtag-location');
    }
  }
}

// ─── 4. 地址抽取 ─────────────────────────────────────────────────────────────

function extractAddresses(text, addPlace) {
  // 台灣地址
  // 例：台北市大安區忠孝東路四段101號
  const twPattern = /((?:台|臺)(?:北|中|南|東|西|灣)|新北|桃園|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|基隆|澎湖|金門|連江)[市縣]?[^\s,，。！？\n「」]{0,30}?[路街道巷弄][0-9０-９]{1,4}(?:號|巷[0-9０-９]{1,4}號)?/g;
  let m;
  while ((m = twPattern.exec(text)) !== null) {
    addPlace(m[0], 'address', 0.9, 'address-tw');
  }

  // 日本地址
  // 例：東京都渋谷区神南1-19-11
  const jpPattern = /(?:[東西南北]?[都道府県][^\s,，。\n]{0,30}?[丁目番地号])/g;
  while ((m = jpPattern.exec(text)) !== null) {
    if (m[0].length > 6) {
      addPlace(m[0], 'address', 0.88, 'address-jp');
    }
  }

  // 香港地址
  const hkPattern = /(?:香港|九龍|新界)[^\s,，。\n]{5,40}/g;
  while ((m = hkPattern.exec(text)) !== null) {
    addPlace(m[0], 'address', 0.82, 'address-hk');
  }

  // 門牌號碼提示（前面是店名）
  // 例：「xxx 123號」「在 xxx路 旁邊」
}

// ─── 5. 英文 Title Case ───────────────────────────────────────────────────────

function extractTitleCase(text, addPlace) {
  // 連續 2-4 個 Title Case 英文單字（可能是店名）
  const pattern = /\b([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){1,3})\b/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const name = m[1];
    const type = guessType(name);
    if (type !== 'other') {
      addPlace(name, type, 0.65, 'title-case');
    }
  }
}

// ─── 輔助函式 ─────────────────────────────────────────────────────────────────

function guessType(name) {
  const lower = name.toLowerCase();
  for (const { kw, type } of TYPE_KEYWORD_MAP) {
    if (lower.includes(kw.toLowerCase())) return type;
  }
  if (hasLocationKeyword(name)) return 'attraction';
  return 'other';
}

const LOCATION_KEYWORDS = [
  '市', '區', '鄉', '鎮', '村', '路', '街', '巷', '弄', '號',
  '公園', '廣場', '商場', '大樓', '大廈',
  '丁目', '番地', '都', '道', '府', '県',
];

function hasLocationKeyword(text) {
  return LOCATION_KEYWORDS.some(kw => text.includes(kw));
}

const NOISE_WORDS = new Set([
  // 常見非店名詞
  '今天', '昨天', '明天', '這裡', '那裡', '地方', '附近', '附近',
  '推薦', '必吃', '必去', '好吃', '好喝', '超讚', '超棒', '超好',
  '朋友', '家人', '自己', '大家', '我們', '你們', '他們',
  '台灣', '日本', '香港', '泰國', '韓國', '美國', '中國',
  'instagram', 'facebook', 'youtube', 'tiktok',
]);

function isNoise(name) {
  return (
    NOISE_WORDS.has(name) ||
    /^[0-9\s]+$/.test(name) ||           // 純數字
    /^[！？。，、…]+$/.test(name) ||      // 純標點
    name.split('').every(c => /\s/.test(c)) // 純空白
  );
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Export ───────────────────────────────────────────────────────────────────

// 供 background.js 的 importScripts 使用
if (typeof self !== 'undefined') {
  self.localExtractPlaces = localExtractPlaces;
}
