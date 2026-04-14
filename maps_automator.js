// maps_automator.js
//
// 職責：只負責點 UI 按鈕（Save + 選清單）
// 導航由 background.js 的 chrome.tabs.update() 負責
// 每次頁面載入後由 background.js 重新注入（不需保持狀態）

'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'doSave') {
    doSave(message.listName)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.action === 'ping') {
    const box = document.querySelector('#searchboxinput, input[aria-label*="搜尋"], input[aria-label*="Search"]');
    sendResponse({ ready: true, mapsReady: !!box, url: location.href });
    return false;
  }
});

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function doSave(listName) {
  log(`doSave("${listName}") on ${location.href}`);

  // 前景 tab，1-2 秒內應該就有結果
  const ready = await waitUntil(
    () => hasPlacePanel() || hasSearchResults(),
    5000
  );
  if (!ready) return { success: false, error: `搜尋「${getSearchedName()}」無結果。` };

  // 搜尋結果列表 → 點第一個
  if (!hasPlacePanel()) {
    const first = getFirstResult();
    if (!first) return { success: false, error: '找不到搜尋結果。' };
    fireClick(first);
    const ok = await waitUntil(() => isOnPlacePage(), 4000);
    if (!ok) return { success: false, error: '地點面板未出現。' };
    await sleep(300);
  }

  // 等 Save 按鈕
  const saveBtn = await waitUntil(findSaveButton, 3000);
  if (!saveBtn) return { success: false, error: '找不到「儲存」按鈕。' };

  const snapBefore = snapshotDialogs();
  fireClick(saveBtn);

  // 等 save panel
  const dialog = await waitUntil(() => findSavePanel(snapBefore), 4000);
  if (!dialog) return { success: false, error: '儲存清單對話框未出現。' };

  await sleep(300);
  log(`Selecting list: "${listName}"...`);
  return selectList(dialog, listName);
}

// ─── 判斷頁面狀態 ─────────────────────────────────────────────────────────────

function hasPlacePanel() {
  return !!(
    document.querySelector('h1.DUwDvf') ||
    document.querySelector('h1[class*="fontHeadline"]') ||
    document.querySelector('[role="main"] h1')
  );
}

function isOnPlacePage() {
  // URL 切換到 /place/ 代表 SPA 導航到地點頁
  if (location.pathname.includes('/maps/place/')) return true;
  return hasPlacePanel();
}

function hasSearchResults() {
  return !!(
    document.querySelector('[role="feed"] a.hfpxzc') ||
    document.querySelector('a.hfpxzc') ||
    document.querySelector('.Nv2PK') ||
    // Google Maps 搜尋結果的 feed
    document.querySelector('[aria-label*="搜尋結果"], [aria-label*="Search results"]')
  );
}

function getFirstResult() {
  return (
    document.querySelector('[role="feed"] a.hfpxzc') ||
    document.querySelector('a.hfpxzc') ||
    document.querySelector('.Nv2PK a') ||
    document.querySelector('[role="feed"] [tabindex="0"]') ||
    null
  );
}

function getSearchedName() {
  try {
    const m = location.pathname.match(/\/search\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}

// ─── 找 Save 按鈕 ─────────────────────────────────────────────────────────────

function findSaveButton() {
  // 從 HTML 確認：按鈕有 data-value="儲存" 和 aria-label="儲存"
  // 優先用 data-value（比 aria-label 更穩定）
  const byDataValue = document.querySelector(
    'button[data-value="儲存"], button[data-value="Save"], button[data-value="保存"]'
  );
  if (byDataValue && isVisible(byDataValue)) return byDataValue;

  // 備用：aria-label 精確匹配
  for (const label of ['儲存', '保存', 'Save', 'Bookmark', '저장']) {
    const el = document.querySelector(`button[aria-label="${label}"]`);
    if (el && isVisible(el)) return el;
  }

  return null;
}

// ─── 找 Save Panel ────────────────────────────────────────────────────────────

function snapshotDialogs() {
  return new Set(document.querySelectorAll('[role="menu"], [role="dialog"]'));
}

function findSavePanel(before) {
  // 從 HTML 確認：save panel 的結構是
  //   <div role="menu" aria-label="儲存至清單中" class="vij30 ...">
  //     <div role="menuitemradio" ...>清單名稱</div>
  //     ...
  //   </div>

  // 策略 1（最精確）：role="menu" + aria-label 含「儲存至清單」
  for (const el of document.querySelectorAll('[role="menu"]')) {
    const label = el.getAttribute('aria-label') || '';
    if (/儲存至清單|Save to list|保存到列表/i.test(label)) return el;
  }

  // 策略 2：新出現的 role="menu"（任何沒出現在 snapshot 裡的）
  for (const el of document.querySelectorAll('[role="menu"]')) {
    if (!before.has(el) && el.querySelectorAll('[role="menuitemradio"]').length > 0) return el;
  }

  // 策略 3：找 role="menuitemradio" 的父容器（清單項目本身）
  const firstItem = document.querySelector('[role="menuitemradio"]');
  if (firstItem) {
    let el = firstItem.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!el || el === document.body) break;
      if (el.querySelectorAll('[role="menuitemradio"]').length >= 2) return el;
      el = el.parentElement;
    }
  }

  return null;
}

// ─── 選清單 ───────────────────────────────────────────────────────────────────

async function selectList(dialog, targetName) {
  const items = getListItems(dialog);
  const available = items.map(getItemLabel);
  log(`Available lists: [${available.join(', ')}]`);

  const target = targetName.trim().toLowerCase();
  for (let i = 0; i < items.length; i++) {
    if (available[i].toLowerCase().includes(target) || target.includes(available[i].toLowerCase())) {
      log(`Clicking: "${available[i]}"`);
      fireClick(items[i]);
      await sleep(400); // 等 Maps 確認選取
      return { success: true };
    }
  }

  // Fallback：第一個清單
  if (items.length > 0) {
    log(`Fallback → "${available[0]}"`);
    fireClick(items[0]);
    await sleep(400);
    return {
      success: true,
      warning: `找不到清單「${targetName}」，已改存至「${available[0]}」。可用：${available.join('、')}`,
    };
  }

  return { success: false, error: `找不到清單「${targetName}」。可用：${available.join('、') || '（無法讀取）'}` };
}

function getListItems(dialog) {
  // 從 HTML 確認：清單項目的 role 是 menuitemradio
  const items = dialog.querySelectorAll('[role="menuitemradio"]');
  if (items.length > 0) return Array.from(items);

  // 備用：menuitem / option
  return Array.from(dialog.querySelectorAll('[role="menuitem"], [role="option"]'))
    .filter(el => isVisible(el));
}

function getItemLabel(el) {
  // 從 HTML 確認：清單名稱在 .mLuXec 這個 class 裡
  return (
    el.querySelector('.mLuXec')?.textContent ||
    el.getAttribute('aria-label') ||
    el.textContent || ''
  ).trim().split('\n')[0].trim();
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function waitUntil(fn, timeout = 8000) {
  return new Promise(resolve => {
    const r = fn();
    if (r) return resolve(r);
    const start = Date.now();
    const id = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(id); resolve(v); }
      else if (Date.now() - start >= timeout) { clearInterval(id); resolve(null); }
    }, 300);
  });
}

function isVisible(el) {
  if (!el) return false;
  if (el.disabled) return false;
  if (el.closest('[hidden]')) return false;

  // 背景分頁的 getBoundingClientRect 全是 0，不可靠
  // 改用 computed style 判斷
  try {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
  } catch { /* 安全失敗 */ }

  return true;
}

// jsaction 框架需要完整的滑鼠事件序列才能正確觸發
function fireClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mouseover',  opts));
  el.dispatchEvent(new MouseEvent('mousedown',  opts));
  el.dispatchEvent(new MouseEvent('mouseup',    opts));
  el.dispatchEvent(new MouseEvent('click',      opts));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg)  { console.log(`[MapSaver] ${msg}`); }
