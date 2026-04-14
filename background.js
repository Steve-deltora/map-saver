// background.js - Service Worker
// Handles extraction (Groq API) and Google Maps tab automation

// Track save progress for each session
const saveProgress = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractPlaces') {
    handleExtractPlaces(message.text, message.apiKey)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'savePlaces') {
    handleSavePlaces(message.places, message.listName, message.sessionId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'getProgress') {
    sendResponse({ progress: saveProgress[message.sessionId] || [] });
    return false;
  }

  if (message.action === 'mapsReady') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'analyzeSelection') {
    // 浮動按鈕點擊 → 儲存選取文字，嘗試打開 popup
    chrome.storage.local.set({
      pendingSelection: { text: message.text, url: message.url, ts: message.ts }
    });
    chrome.action.openPopup().catch(() => {/* Chrome < 127 不支援，使用者手動點圖示 */});
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'extractFromUrl') {
    handleExtractFromUrl(message.url)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ hasContent: false, error: e.message }));
    return true;
  }
});

// ─── Extraction dispatcher ────────────────────────────────────────────────────

async function handleExtractPlaces(text, apiKey) {
  if (!text || text.trim().length < 5) return { success: false, error: 'No content to analyze.' };

  // 頁面內容超過 300 字才預處理（短文如手動選取不需要）
  const processedText = text.length > 300 ? preprocessForAI(text) : text;
  return handleGroqExtract(processedText, apiKey);
}

// ─── 智慧內容預處理器（減少 token 用量）────────────────────────────────────────
//
// 策略：
//   1. 前 5 行必留（店名通常在貼文開頭）
//   2. 找到「地址/營業/電話/📍」等錨點行，保留其上下 3 行
//   3. 過濾廣告、過長心得、價格行
//   4. 去重後限制在 900 字元

function preprocessForAI(text) {
  const locationRe = /地址|縣|市|區|鄉|鎮|路|街|號|樓|巷|弄|都道府県|町|丁目|営業|電話|交通|📍|🗺️|☎️|TEL|tel/i;
  const noiseRe    = /門票|訂房|周遊券|代購|點我|Klook|KKday|Agoda|booking\.com/i;
  const priceRe    = /NT\$|TWD|\d+\s*元|¥\s*\d+|\$\s*\d+/;

  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 1);

  // 找錨點行，展開前後 3 行
  const keep = new Set();
  lines.forEach((line, i) => {
    if (locationRe.test(line)) {
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) keep.add(j);
    }
  });
  // 前 5 行必留
  for (let i = 0; i < Math.min(5, lines.length); i++) keep.add(i);

  const seen = new Set();
  const result = [];

  [...keep].sort((a, b) => a - b).forEach(i => {
    const line = lines[i];
    if (!line || seen.has(line)) return;
    if (noiseRe.test(line)) return;
    if (priceRe.test(line) && !locationRe.test(line)) return;
    if (line.length > 80 && !locationRe.test(line)) return; // 過長心得
    seen.add(line);
    result.push(line);
  });

  // 若過濾後太少，補入前段未被 noise 過濾的行
  if (result.length < 4) {
    for (const line of lines) {
      if (seen.has(line) || noiseRe.test(line) || line.length > 80) continue;
      seen.add(line);
      result.push(line);
      if (result.length >= 8) break;
    }
  }

  const out = result.join('\n').slice(0, 900);
  return out || text.slice(0, 900);
}

// ─── Groq API ────────────────────────────────────────────────────────────────
// 免費額度：每日 100,000 tokens，速度快
// 取得 Key：https://console.groq.com（不需信用卡）

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function handleGroqExtract(text, apiKey) {
  if (!apiKey) return { success: false, error: 'Groq API Key 未設定，請前往設定頁面。' };

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: buildExtractionPrompt(text) }],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: `Groq API 錯誤：${err.error?.message || response.statusText}` };
  }

  const data = await response.json();
  // 追蹤每日用量
  const usedTokens = data.usage?.total_tokens || 0;
  if (usedTokens > 0) trackGroqUsage(usedTokens);

  const raw = data.choices?.[0]?.message?.content || '[]';
  return parsePlacesJson(raw, 'groq');
}

async function trackGroqUsage(tokens) {
  const today = new Date().toISOString().slice(0, 10);
  const { groqUsage } = await chrome.storage.local.get('groqUsage');
  const prev = (groqUsage?.date === today) ? (groqUsage.tokens || 0) : 0;
  await chrome.storage.local.set({ groqUsage: { date: today, tokens: prev + tokens } });
}

// ─── 共用：Prompt 與 JSON 解析 ───────────────────────────────────────────────

function buildExtractionPrompt(text) {
  return `你是一個幫助辨識社群媒體貼文中「真實店家/地點名稱」的工具。

請從以下貼文內容中，找出所有真實存在的店家或地點名稱（餐廳、咖啡廳、景點、商店等）。

判斷規則：
1. 貼文「主角」（被直接介紹、評論、推薦的店家）→ confidence 0.85 以上
2. 「背景提及」（順帶出現的合作方、比較對象、品牌來源）→ confidence 0.3~0.6
3. 如果貼文有提到地區/地址（例如「六本木」「新宿」「澀谷」「道頓堀」），填入 location 欄位；沒有則留空字串
4. location 請盡可能具體（「六本木」優於「東京」）
5. 只回傳真實店名，不要回傳描述句子

只回傳 JSON 陣列，不要任何其他文字：
[{"name": "店名", "type": "restaurant|cafe|bar|shop|attraction|hotel|other", "confidence": 0.0~1.0, "location": "區域（選填）"}]

貼文內容：
${text.slice(0, 4000)}`;
}

function parsePlacesJson(raw, modeName) {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return { success: true, places: [] };
  try {
    const places = JSON.parse(match[0]);
    return { success: true, places, mode: modeName };
  } catch {
    return { success: false, error: `無法解析 ${modeName} 回傳的內容。` };
  }
}

// ─── Google Maps Automation ───────────────────────────────────────────────────
//
// 正確架構：
//   Google Maps 是 SPA，換地點不會重載頁面
//   → content script 注入一次就夠，之後直接用搜尋框搜尋
//   → 完全不需要 URL 導航或重新注入

async function handleSavePlaces(places, listName, sessionId) {
  saveProgress[sessionId] = places.map(p => ({ name: p.name, status: 'pending' }));
  await flushProgress(sessionId);

  let mapsTabId, tabCreatedByUs;
  try {
    ({ tabId: mapsTabId, created: tabCreatedByUs } = await getOrCreateMapsTab());
  } catch (err) {
    saveProgress[sessionId].forEach(p => { p.status = 'error'; p.error = err.message; });
    await flushProgress(sessionId);
    return { success: false, progress: saveProgress[sessionId] };
  }

  for (let i = 0; i < places.length; i++) {
    saveProgress[sessionId][i].status = 'saving';
    await flushProgress(sessionId);

    const result = await savePlaceInTab(mapsTabId, places[i].name, listName, places[i].location);
    saveProgress[sessionId][i].status = result.success ? 'done' : 'error';
    if (!result.success) saveProgress[sessionId][i].error = result.error;
    if (result.warning)  saveProgress[sessionId][i].warning = result.warning;
    await flushProgress(sessionId);

    if (i < places.length - 1) await sleep(600);
  }

  // 完成後關閉我們開的分頁
  if (tabCreatedByUs) {
    try { await chrome.tabs.remove(mapsTabId); } catch { /* 已被手動關閉，忽略 */ }
  }

  return { success: true, progress: saveProgress[sessionId] };
}

// 把進度寫入 storage，讓 popup polling 讀到
async function flushProgress(sessionId) {
  await chrome.storage.local.set({ [`progress_${sessionId}`]: saveProgress[sessionId] });
}

// ─── Tab 管理 ─────────────────────────────────────────────────────────────────
//
// Maps 必須在前景（active:true）才能正常渲染和響應 click()
// 儲存完成後自動關閉分頁，使用者只會短暫看到它

async function getOrCreateMapsTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.google.com/maps/*', 'https://maps.google.com/*'],
  });
  if (tabs.length > 0) {
    log(`Reusing Maps tab ${tabs[0].id}`);
    await chrome.tabs.update(tabs[0].id, { active: true });
    return { tabId: tabs[0].id, created: false };
  }

  log('Creating Maps tab...');
  const tab = await chrome.tabs.create({ url: 'https://www.google.com/maps', active: true });
  await waitForTabComplete(tab.id, 20000);
  return { tabId: tab.id, created: true };
}


function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
  });
}

// ─── 單一地點儲存 ─────────────────────────────────────────────────────────────
//
// 設計：background 導航到 /maps/place/店名，等頁面載入後注入 script，
//       script 只負責點 Save 按鈕（不需搜尋框，不受背景分頁限制）

async function savePlaceInTab(tabId, placeName, listName, placeLocation) {
  try { await chrome.tabs.get(tabId); }
  catch { return { success: false, error: 'Google Maps 分頁已被關閉。' }; }

  // Step 1: 有 location 就附加到搜尋詞，避免找到錯誤分店
  const query = (placeLocation && placeLocation.trim())
    ? `${placeName} ${placeLocation.trim()}`
    : placeName;
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  log(`Navigating to: ${url}`);
  await chrome.tabs.update(tabId, { url });

  // Step 2: 等待頁面完全載入
  await waitForTabComplete(tabId, 20000);

  // Step 3: 等 Maps JS 初始化
  await sleep(1500);

  // Step 4: 注入 fresh content script
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['maps_automator.js'] });
  } catch (err) {
    return { success: false, error: `無法注入 script：${err.message}` };
  }
  await sleep(500);

  // Step 5: 執行儲存
  return sendToTab(tabId, { action: 'doSave', listName }, 15000);
}

// 有 timeout 保護的 sendMessage
function sendToTab(tabId, message, timeout = 10000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: `逾時（${timeout / 1000}秒）：Maps 無回應。` });
    }, timeout);

    chrome.tabs.sendMessage(tabId, message, response => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: '沒有收到回應。' });
      }
    });
  });
}

// ─── 從 URL 抓取貼文內容 ──────────────────────────────────────────────────────

async function handleExtractFromUrl(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForTabComplete(tab.id, 15000);
  await sleep(2000); // 等頁面 JS 渲染

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_extractor.js'] });
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    return { hasContent: false, error: `無法讀取頁面：${err.message}` };
  }

  await sleep(300);
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 5000);
    chrome.tabs.sendMessage(tab.id, { action: 'extractContent' }, response => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });

  chrome.tabs.remove(tab.id).catch(() => {});
  return result || { hasContent: false, error: '無法讀取頁面內容，請直接在瀏覽器開啟該頁面後再抽取。' };
}

function log(msg) { console.log(`[MapSaver BG] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
