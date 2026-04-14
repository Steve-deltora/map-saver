// popup.js - Main popup logic

let currentPlaces = [];
let sessionId = Date.now().toString();

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await init();
});

async function init() {
  // 填入目前分頁 URL，使用者可以清掉後貼上別的連結
  const tab = await getActiveTab();
  if (tab) {
    const urlInput = document.getElementById('input-url');
    urlInput.value = tab.url || '';
    urlInput.title = tab.url || '';

    // Show platform badge
    const platform = detectPlatform(tab.url || '');
    if (platform) {
      const badge = document.getElementById('platform-badge');
      badge.textContent = platform;
      badge.classList.remove('hidden');
    }

    // 貼上新連結時更新 platform badge
    urlInput.addEventListener('input', () => {
      const p = detectPlatform(urlInput.value);
      const badge = document.getElementById('platform-badge');
      if (p) { badge.textContent = p; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    });
  }

  // Check API key and mode
  const { apiKey, geminiKey, groqKey, defaultList, extractMode } = await chrome.storage.sync.get(['apiKey', 'geminiKey', 'groqKey', 'defaultList', 'extractMode']);
  const mode = extractMode || 'groq';

  const needsKey = (mode === 'claude' && !apiKey) || (mode === 'gemini' && !geminiKey) || (mode === 'groq' && !groqKey);
  if (needsKey) {
    document.getElementById('api-key-warning').classList.remove('hidden');
  }

  // 顯示目前模式
  const badge = document.getElementById('platform-badge');
  if (badge && !badge.classList.contains('hidden')) {
    // badge already showing platform name
  }
  const modeTag = document.getElementById('mode-tag');
  if (modeTag) {
    const labels = { local: '本地模式', groq: 'Groq AI', gemini: 'Gemini AI', claude: 'Claude AI' };
    const colors  = { local: '#5f6368', groq: '#f55036', gemini: '#1a73e8', claude: '#7c4dff' };
    modeTag.textContent = labels[mode] || mode;
    modeTag.style.background = colors[mode] || '#5f6368';
  }

  if (defaultList) {
    document.getElementById('list-name').value = defaultList;
  }

  // ── Toggle 啟用狀態 ──────────────────────────────────────
  const { extensionEnabled } = await chrome.storage.sync.get('extensionEnabled');
  const enabled = extensionEnabled !== false; // 預設開啟
  updateToggle(enabled);
  document.getElementById('btn-toggle').addEventListener('click', async () => {
    const cur = document.getElementById('btn-toggle').classList.contains('enabled');
    const next = !cur;
    await chrome.storage.sync.set({ extensionEnabled: next });
    updateToggle(next);
  });

  // ── Groq 用量顯示 ────────────────────────────────────────
  if (mode === 'groq') {
    const { groqUsage } = await chrome.storage.local.get('groqUsage');
    const today = new Date().toISOString().slice(0, 10);
    if (groqUsage?.date === today) updateUsageBar(groqUsage.tokens);
    document.getElementById('usage-bar').classList.remove('hidden');
    // 即時更新（分析完成後 background 會寫 storage）
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.groqUsage) {
        const u = changes.groqUsage.newValue;
        if (u?.date === today) updateUsageBar(u.tokens);
      }
    });
  }

  // 偵測選取文字：先查 pendingSelection（浮動按鈕觸發），再查當前分頁選取
  let hasSelection = false;
  const { pendingSelection } = await chrome.storage.local.get('pendingSelection');
  if (pendingSelection && Date.now() - pendingSelection.ts < 30000) {
    chrome.storage.local.remove('pendingSelection');
    showSelectionPreview(pendingSelection.text);
    hasSelection = true;
    // 浮動按鈕已點擊，直接自動分析，不需使用者再按一次
    setTimeout(() => onAnalyzeSelection(), 50);
  } else if (tab) {
    const selText = await getTabSelection(tab.id);
    if (selText && selText.length >= 10) {
      showSelectionPreview(selText);
      hasSelection = true;
    }
  }
  // 沒有選取時，「分析網址頁面」升為主要按鈕
  if (!hasSelection) {
    const btnExtract = document.getElementById('btn-extract');
    btnExtract.classList.remove('btn-outline');
    btnExtract.classList.add('btn-primary');
  }

  // Bind events
  document.getElementById('btn-extract').addEventListener('click', onExtract);
  document.getElementById('btn-analyze-selection').addEventListener('click', onAnalyzeSelection);
  document.getElementById('btn-reset').addEventListener('click', onReset);
  document.getElementById('btn-save').addEventListener('click', onSave);
  document.getElementById('btn-done').addEventListener('click', onDone);
  document.getElementById('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('btn-go-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('chk-select-all').addEventListener('change', onSelectAll);
}

// ─── Selection helpers ────────────────────────────────────────────────────────

function showSelectionPreview(text) {
  const section = document.getElementById('selection-section');
  const preview = document.getElementById('selection-preview');
  preview.textContent = text.length > 300 ? text.slice(0, 300) + '…' : text;
  section.dataset.selectionText = text;
  section.classList.remove('hidden');
}

async function getTabSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection().toString().trim(),
    });
    return results?.[0]?.result || '';
  } catch { return ''; }
}

async function onAnalyzeSelection() {
  const text = document.getElementById('selection-section').dataset.selectionText;
  if (!text) return;

  const { apiKey, geminiKey, groqKey, extractMode } = await chrome.storage.sync.get(['apiKey', 'geminiKey', 'groqKey', 'extractMode']);
  const mode = extractMode || 'groq';
  const modeLabel = { local: '本地', groq: 'Groq AI', gemini: 'Gemini AI', claude: 'Claude AI' }[mode] || mode;

  showLoading(`正在用 ${modeLabel} 分析選取內容...`);
  try {
    const activeKey = mode === 'groq' ? (groqKey || '') : mode === 'gemini' ? (geminiKey || '') : (apiKey || '');
    const result = await chrome.runtime.sendMessage({
      action: 'extractPlaces',
      text,
      apiKey: activeKey,
      mode,
    });
    hideLoading();
    if (!result.success) { alert(`分析失敗：${result.error}`); return; }
    currentPlaces = (result.places || []).filter(p => p.confidence >= 0.3);
    renderPlaces(currentPlaces);
  } catch (err) {
    hideLoading();
    alert(`錯誤：${err.message}`);
  }
}

// ─── Extract ───────────────────────────────────────────────────────────────────

async function onExtract() {
  const { apiKey, geminiKey, groqKey, extractMode } = await chrome.storage.sync.get(['apiKey', 'geminiKey', 'groqKey', 'extractMode']);
  const mode = extractMode || 'groq';

  if (mode === 'claude' && !apiKey) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const tab = await getActiveTab();
  const inputUrl = document.getElementById('input-url').value.trim();
  const currentTabUrl = tab?.url || '';
  const useCurrentTab = !inputUrl || inputUrl === currentTabUrl;

  try {
    let contentResult;

    if (useCurrentTab) {
      showLoading('正在讀取貼文內容...');
      contentResult = await injectAndExtract(tab.id);
      if (!contentResult || !contentResult.hasContent) {
        hideLoading();
        alert('無法讀取貼文內容。請確認你在社群媒體貼文頁面，並重新嘗試。');
        return;
      }
    } else {
      showLoading('正在開啟連結並讀取內容...');
      contentResult = await chrome.runtime.sendMessage({ action: 'extractFromUrl', url: inputUrl });
      if (!contentResult || !contentResult.hasContent) {
        hideLoading();
        alert(contentResult?.error || '無法讀取連結內容。請直接在瀏覽器開啟該頁面後再抽取。');
        return;
      }
    }

    const modeLabel = { local: '本地', groq: 'Groq AI', gemini: 'Gemini AI', claude: 'Claude AI' }[mode] || mode;
    updateLoadingText(`正在用 ${modeLabel} 分析 ${contentResult.platform || ''} 的內容...`);

    // AI 抽取
    const activeKey = mode === 'groq' ? (groqKey || '') : mode === 'gemini' ? (geminiKey || '') : (apiKey || '');
    const result = await chrome.runtime.sendMessage({
      action: 'extractPlaces',
      text: contentResult.text,
      apiKey: activeKey,
      mode,
    });

    hideLoading();

    if (!result.success) {
      alert(`分析失敗：${result.error}`);
      return;
    }

    currentPlaces = (result.places || []).filter(p => p.confidence >= 0.3);
    renderPlaces(currentPlaces);

  } catch (err) {
    hideLoading();
    alert(`錯誤：${err.message}`);
  }
}

async function injectAndExtract(tabId) {
  // Inject the content extractor script and call it
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content_extractor.js'],
  });

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'extractContent' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Render Places ─────────────────────────────────────────────────────────────

function renderPlaces(places) {
  const list = document.getElementById('places-list');
  const emptyState = document.getElementById('places-empty');
  const selectAllRow = document.getElementById('select-all-row');
  const totalCount = document.getElementById('total-count');
  const selectedCount = document.getElementById('selected-count');

  list.innerHTML = '';

  if (places.length === 0) {
    emptyState.classList.remove('hidden');
    selectAllRow.classList.add('hidden');
    document.getElementById('section-places').classList.remove('hidden');
    document.getElementById('section-save').classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  selectAllRow.classList.remove('hidden');
  totalCount.textContent = places.length;

  // 預設只勾選高信心度的地點（>= 0.7），若全部都低則只勾最高的那個
  const maxConf = Math.max(...places.map(p => p.confidence));
  const threshold = maxConf >= 0.7 ? 0.7 : maxConf;

  places.forEach((place, index) => {
    const item = document.createElement('div');
    const preChecked = place.confidence >= threshold;
    item.className = preChecked ? 'place-item selected' : 'place-item';
    item.dataset.index = index;

    const confidenceClass = place.confidence >= 0.8 ? 'confidence-high' :
                            place.confidence >= 0.5 ? 'confidence-med' : 'confidence-low';
    const confidenceText = Math.round(place.confidence * 100) + '%';

    const typeLabels = {
      restaurant: '🍽️ 餐廳', cafe: '☕ 咖啡廳', bar: '🍺 酒吧',
      shop: '🛍️ 商店', attraction: '🏛️ 景點', hotel: '🏨 住宿', other: '📍 地點'
    };
    const typeLabel = typeLabels[place.type] || typeLabels.other;

    const locationTag = place.location ? ` · ${escapeHtml(place.location)}` : '';
    item.innerHTML = `
      <input type="checkbox" ${preChecked ? 'checked' : ''} data-index="${index}" />
      <div class="place-info">
        <div class="place-name">${escapeHtml(place.name)}</div>
        <div class="place-type">${typeLabel}${locationTag}</div>
      </div>
      <span class="place-confidence ${confidenceClass}">${confidenceText}</span>
    `;

    // Toggle selection on click
    item.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return; // handled by checkbox
      const chk = item.querySelector('input[type="checkbox"]');
      chk.checked = !chk.checked;
      updateSelection();
    });

    item.querySelector('input').addEventListener('change', updateSelection);
    list.appendChild(item);
  });

  updateSelection();

  document.getElementById('section-places').classList.remove('hidden');
  document.getElementById('section-save').classList.remove('hidden');
}

function updateSelection() {
  const checkboxes = document.querySelectorAll('#places-list input[type="checkbox"]');
  const selectedItems = Array.from(checkboxes).filter(c => c.checked);

  document.getElementById('selected-count').textContent = selectedItems.length;
  document.getElementById('chk-select-all').checked = selectedItems.length === checkboxes.length;
  document.getElementById('chk-select-all').indeterminate =
    selectedItems.length > 0 && selectedItems.length < checkboxes.length;

  // Update visual state
  document.querySelectorAll('.place-item').forEach((item, i) => {
    const chk = item.querySelector('input[type="checkbox"]');
    item.classList.toggle('selected', chk.checked);
  });

  // Enable/disable save button
  document.getElementById('btn-save').disabled = selectedItems.length === 0;
}

function onSelectAll(e) {
  document.querySelectorAll('#places-list input[type="checkbox"]').forEach(chk => {
    chk.checked = e.target.checked;
  });
  updateSelection();
}

// ─── Save ──────────────────────────────────────────────────────────────────────

async function onSave() {
  const listName = document.getElementById('list-name').value.trim();
  if (!listName) {
    document.getElementById('list-name').focus();
    document.getElementById('list-name').style.borderColor = '#ea4335';
    setTimeout(() => document.getElementById('list-name').style.borderColor = '', 2000);
    return;
  }

  // Get selected places
  const selectedPlaces = [];
  document.querySelectorAll('#places-list input[type="checkbox"]').forEach((chk, i) => {
    if (chk.checked && currentPlaces[i]) {
      selectedPlaces.push(currentPlaces[i]);
    }
  });

  if (selectedPlaces.length === 0) return;

  // Save default list name
  await chrome.storage.sync.set({ defaultList: listName });

  // Show progress section
  document.getElementById('section-extract').classList.add('hidden');
  document.getElementById('section-places').classList.add('hidden');
  document.getElementById('section-save').classList.add('hidden');

  sessionId = Date.now().toString();
  renderProgress(selectedPlaces);
  document.getElementById('section-progress').classList.remove('hidden');

  // Start saving (fire-and-forget + polling)
  startSaving(selectedPlaces, listName);
}

function renderProgress(places) {
  const list = document.getElementById('progress-list');
  list.innerHTML = '';
  places.forEach((place, i) => {
    const item = document.createElement('div');
    item.className = 'progress-item';
    item.id = `progress-item-${i}`;
    item.innerHTML = `
      <span class="progress-name">${escapeHtml(place.name)}</span>
      <span class="progress-status status-pending" id="progress-status-${i}">⏳ 等待中</span>
    `;
    list.appendChild(item);
  });
}

async function startSaving(places, listName) {
  // 不等回應，直接 fire-and-forget（開 Maps tab 會讓 popup 失焦）
  chrome.runtime.sendMessage({ action: 'savePlaces', places, listName, sessionId });

  // 改用 polling 從 storage 讀進度
  pollProgress(places.length);
}

function pollProgress(total) {
  const key = `progress_${sessionId}`;
  let stuckCount = 0;
  let lastJson = '';

  const timer = setInterval(async () => {
    const data = await chrome.storage.local.get(key);
    const progress = data[key];
    if (!progress) {
      stuckCount++;
      if (stuckCount > 60) { // 30 秒無反應
        clearInterval(timer);
        showSummary([], total);
      }
      return;
    }

    // 有更新才重繪
    const json = JSON.stringify(progress);
    if (json !== lastJson) {
      lastJson = json;
      stuckCount = 0;
      updateProgressUI(progress);
    }

    // 全部完成
    const allDone = progress.every(p => p.status !== 'pending' && p.status !== 'saving');
    if (allDone) {
      clearInterval(timer);
      chrome.storage.local.remove(key); // 清理
      showSummary(progress, total);
    } else {
      stuckCount++;
      if (stuckCount > 120) { // 60 秒無進度變化
        clearInterval(timer);
        showSummary(progress, total);
      }
    }
  }, 500);
}

function showSummary(progress, total) {
  const done = progress.filter(p => p.status === 'done').length;
  const summary = document.getElementById('progress-summary');
  const doneBtn = document.getElementById('btn-done');
  summary.textContent = `完成 ${done}/${total} 個地點`;
  summary.classList.remove('hidden');
  doneBtn.classList.remove('hidden');
}

function updateProgressUI(progress) {
  progress.forEach((item, i) => {
    const statusEl = document.getElementById(`progress-status-${i}`);
    if (!statusEl) return;

    statusEl.className = `progress-status status-${item.status}`;
    if (item.status === 'pending') statusEl.textContent = '⏳ 等待中';
    else if (item.status === 'saving') statusEl.textContent = '🔄 儲存中';
    else if (item.status === 'done') statusEl.textContent = '✅ 完成';
    else if (item.status === 'error') {
      statusEl.textContent = '❌ 失敗';
      const itemEl = document.getElementById(`progress-item-${i}`);
      if (itemEl && item.error) {
        const errDiv = document.createElement('div');
        errDiv.className = 'progress-error';
        errDiv.textContent = item.error;
        itemEl.appendChild(errDiv);
      }
    }
  });
}

function onDone() {
  // 清理此 session 的 storage
  chrome.storage.local.remove(`progress_${sessionId}`);
  window.close();
}

// ─── Reset ─────────────────────────────────────────────────────────────────────

function onReset() {
  currentPlaces = [];
  document.getElementById('places-list').innerHTML = '';
  document.getElementById('section-places').classList.add('hidden');
  document.getElementById('section-save').classList.add('hidden');
  document.getElementById('section-progress').classList.add('hidden');
  document.getElementById('section-extract').classList.remove('hidden');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0] || null));
  });
}

function detectPlatform(url) {
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('facebook.com')) return 'Facebook';
  if (url.includes('youtube.com')) return 'YouTube';
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'Twitter / X';
  if (url.includes('threads.net')) return 'Threads';
  return null;
}

function showLoading(text) {
  document.getElementById('loading-text').textContent = text || '處理中...';
  document.getElementById('loading').classList.remove('hidden');
}

function updateLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateToggle(enabled) {
  const btn = document.getElementById('btn-toggle');
  btn.classList.toggle('enabled',  enabled);
  btn.classList.toggle('disabled', !enabled);
  btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
  btn.title = enabled ? '浮動按鈕：開啟（點擊關閉）' : '浮動按鈕：關閉（點擊開啟）';
}

function updateUsageBar(tokens) {
  const LIMIT = 100000;
  const pct = Math.min(tokens / LIMIT * 100, 100);
  const fill = document.getElementById('usage-fill');
  const text = document.getElementById('usage-text');
  fill.style.width = pct + '%';
  fill.className = 'usage-fill-bar' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : '');
  const k = (tokens / 1000).toFixed(1);
  text.textContent = `${k}k / 100k`;
}
