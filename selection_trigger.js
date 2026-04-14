// selection_trigger.js
// 在支援的社群媒體頁面上，反白文字後顯示浮動「存地圖」按鈕

(function () {
  if (window.__mapSaverTrigger) return;
  window.__mapSaverTrigger = true;

  // 不在 Google Maps 頁面執行
  if (location.hostname.includes('google.com') && location.pathname.startsWith('/maps')) return;

  let btn = null;
  let isEnabled = true;

  // 讀取初始狀態
  chrome.storage.sync.get('extensionEnabled', ({ extensionEnabled }) => {
    isEnabled = extensionEnabled !== false;
  });
  // 即時更新（popup 切換時同步）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'extensionEnabled' in changes) {
      isEnabled = changes.extensionEnabled.newValue !== false;
      if (!isEnabled) hideBtn();
    }
  });

  document.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('keyup',   onSelectionChange);

  document.addEventListener('mousedown', (e) => {
    if (btn && !btn.contains(e.target)) hideBtn();
  });

  function onSelectionChange() {
    if (!isEnabled) return;
    const text = window.getSelection()?.toString().trim() || '';
    if (text.length >= 10) showBtn(text);
    else hideBtn();
  }

  function showBtn(text) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = '__mapsaver_sel_btn__';
      btn.textContent = '📍 存地圖';
      Object.assign(btn.style, {
        position:   'fixed',
        zIndex:     '2147483647',
        background: '#1a73e8',
        color:      'white',
        border:     'none',
        padding:    '5px 13px',
        borderRadius: '16px',
        fontSize:   '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: '500',
        cursor:     'pointer',
        boxShadow:  '0 2px 10px rgba(0,0,0,0.28)',
        userSelect: 'none',
        lineHeight: '1.5',
        transition: 'opacity 0.15s',
      });
      btn.addEventListener('click', () => {
        const t = window.getSelection()?.toString().trim() || text;
        chrome.runtime.sendMessage({
          action: 'analyzeSelection',
          text: t,
          url: location.href,
          ts: Date.now(),
        });
        hideBtn();
      });
      document.body.appendChild(btn);
    }

    // 定位到選取範圍左側，垂直置中
    try {
      const sel = window.getSelection();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const btnW = 100; // 按鈕寬度估算
      const gap  = 8;
      let x = rect.left - btnW - gap;
      // 若左側空間不足，改顯示在右側
      if (x < 4) x = rect.right + gap;
      // 超出右側邊界則回到左上角
      if (x + btnW > window.innerWidth - 4) x = Math.max(4, rect.left);
      const y = Math.max(4, rect.top + rect.height / 2 - 16);
      btn.style.left    = x + 'px';
      btn.style.top     = y + 'px';
      btn.style.opacity = '1';
      btn.style.display = 'block';
    } catch {
      btn.style.display = 'block';
    }
  }

  function hideBtn() {
    if (btn) btn.style.display = 'none';
  }
})();
