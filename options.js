// options.js

document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey, geminiKey, groqKey, geminiModel, defaultList, extractMode } = await chrome.storage.sync.get([
    'apiKey', 'geminiKey', 'groqKey', 'geminiModel', 'defaultList', 'extractMode',
  ]);

  if (apiKey)      document.getElementById('api-key').value    = apiKey;
  if (geminiKey)   document.getElementById('gemini-key').value = geminiKey;
  if (groqKey)     document.getElementById('groq-key').value   = groqKey;
  if (defaultList) document.getElementById('default-list').value = defaultList;

  // Model 選擇
  const modelInput = document.getElementById('gemini-model');
  modelInput.value = geminiModel || 'gemini-2.0-flash';

  // 快捷 chips
  const MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-preview-04-17', 'gemini-1.5-pro'];
  const chipsContainer = document.getElementById('model-suggestions');
  MODELS.forEach(m => {
    const chip = document.createElement('span');
    chip.className = 'model-chip';
    chip.textContent = m;
    chip.addEventListener('click', () => { modelInput.value = m; });
    chipsContainer.appendChild(chip);
  });

  // Set mode
  const mode = extractMode || 'groq';
  const radio = document.querySelector(`input[name="extract-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  updateKeySection(mode);

  // Mode change
  document.querySelectorAll('input[name="extract-mode"]').forEach(r => {
    r.addEventListener('change', () => updateKeySection(r.value));
  });

  document.getElementById('btn-toggle-groq').addEventListener('click', () => {
    toggle('groq-key', 'btn-toggle-groq');
  });

  // Toggle Gemini key visibility
  document.getElementById('btn-toggle-gemini').addEventListener('click', () => {
    toggle('gemini-key', 'btn-toggle-gemini');
  });

  // Toggle Claude key visibility
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    toggle('api-key', 'btn-toggle-key');
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', async () => {
    const extractMode = document.querySelector('input[name="extract-mode"]:checked')?.value || 'groq';
    const groqKey     = document.getElementById('groq-key').value.trim();
    const geminiKey   = document.getElementById('gemini-key').value.trim();
    const geminiModel = document.getElementById('gemini-model').value.trim() || 'gemini-2.0-flash';
    const apiKey      = document.getElementById('api-key').value.trim();
    const defaultList = document.getElementById('default-list').value.trim();

    if (extractMode === 'groq' && !groqKey) {
      showAlert('請輸入 Groq API Key', 'error'); return;
    }
    if (extractMode === 'groq' && !groqKey.startsWith('gsk_')) {
      showAlert('Groq API Key 格式不正確，應以 gsk_ 開頭', 'error'); return;
    }
    if (extractMode === 'gemini' && !geminiKey) {
      showAlert('請輸入 Gemini API Key', 'error'); return;
    }
    if (extractMode === 'gemini' && !geminiKey.startsWith('AIza')) {
      showAlert('Gemini API Key 格式不正確，應以 AIza 開頭', 'error'); return;
    }
    if (extractMode === 'claude' && !apiKey) {
      showAlert('請輸入 Claude API Key', 'error'); return;
    }
    if (extractMode === 'claude' && !apiKey.startsWith('sk-ant-')) {
      showAlert('Claude API Key 格式不正確，應以 sk-ant- 開頭', 'error'); return;
    }

    await chrome.storage.sync.set({ apiKey, geminiKey, groqKey, geminiModel, defaultList, extractMode });
    showAlert('設定已儲存！', 'success');
  });

  document.getElementById('btn-cancel').addEventListener('click', () => window.close());
});

function updateKeySection(mode) {
  const groqSection   = document.getElementById('groq-key-section');
  const geminiSection = document.getElementById('gemini-key-section');
  const claudeSection = document.getElementById('claude-key-section');
  const card = document.getElementById('api-key-card');

  groqSection.style.display   = 'none';
  geminiSection.style.display = 'none';
  claudeSection.style.display = 'none';

  if (mode === 'local') {
    card.style.opacity = '0.4';
    card.style.pointerEvents = 'none';
  } else {
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';
    if (mode === 'groq')   groqSection.style.display   = 'block';
    if (mode === 'gemini') geminiSection.style.display = 'block';
    if (mode === 'claude') claudeSection.style.display = 'block';
  }
}

function toggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (input.type === 'password') { input.type = 'text';     btn.textContent = '隱藏'; }
  else                           { input.type = 'password'; btn.textContent = '顯示'; }
}

function showAlert(msg, type) {
  const el = document.getElementById('alert');
  el.textContent = type === 'success' ? '✅ ' + msg : '❌ ' + msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
