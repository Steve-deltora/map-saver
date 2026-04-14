// options.js

document.addEventListener('DOMContentLoaded', async () => {
  const { groqKey, defaultList } = await chrome.storage.sync.get(['groqKey', 'defaultList']);

  if (groqKey)     document.getElementById('groq-key').value    = groqKey;
  if (defaultList) document.getElementById('default-list').value = defaultList;

  document.getElementById('btn-toggle-groq').addEventListener('click', () => {
    const input = document.getElementById('groq-key');
    const btn   = document.getElementById('btn-toggle-groq');
    if (input.type === 'password') { input.type = 'text';     btn.textContent = '隱藏'; }
    else                           { input.type = 'password'; btn.textContent = '顯示'; }
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const groqKey     = document.getElementById('groq-key').value.trim();
    const defaultList = document.getElementById('default-list').value.trim();

    if (!groqKey) {
      showAlert('請輸入 Groq API Key', 'error'); return;
    }
    if (!groqKey.startsWith('gsk_')) {
      showAlert('Groq API Key 格式不正確，應以 gsk_ 開頭', 'error'); return;
    }

    await chrome.storage.sync.set({ groqKey, defaultList, extractMode: 'groq' });
    showAlert('設定已儲存！', 'success');
  });

  document.getElementById('btn-cancel').addEventListener('click', () => window.close());
});

function showAlert(msg, type) {
  const el = document.getElementById('alert');
  el.textContent = type === 'success' ? '✅ ' + msg : '❌ ' + msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
