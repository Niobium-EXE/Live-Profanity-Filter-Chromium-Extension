(() => {
  'use strict';

  const Core = globalThis.LiveProfanityCore;
  let settings = Core.defaultSettings();
  let hostname = '';
  let activeTab = null;
  let connectionState = 'checking';

  const enabledToggle = document.querySelector('#enabledToggle');
  const statusText = document.querySelector('#statusText');
  const wordInput = document.querySelector('#wordInput');
  const replacementInput = document.querySelector('#replacementInput');
  const defaultReplacement = document.querySelector('#defaultReplacement');
  const addButton = document.querySelector('#addButton');
  const message = document.querySelector('#message');
  const siteToggle = document.querySelector('#siteToggle');
  const openOptions = document.querySelector('#openOptions');
  const editRuleSelect = document.querySelector('#editRuleSelect');
  const editFields = document.querySelector('#editFields');
  const editWord = document.querySelector('#editWord');
  const editReplacement = document.querySelector('#editReplacement');
  const editMatch = document.querySelector('#editMatch');
  const editEnabled = document.querySelector('#editEnabled');
  const editRepeated = document.querySelector('#editRepeated');
  const editSeparators = document.querySelector('#editSeparators');
  const saveEdit = document.querySelector('#saveEdit');
  const deleteEdit = document.querySelector('#deleteEdit');
  const filterCount = document.querySelector('#filterCount');

  async function getSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'lpf:get-settings' });
    if (!response?.ok) throw new Error(response?.error || 'Could not load settings.');
    settings = Core.sanitizeSettings(response.settings);
    return settings;
  }

  async function mutate(operation) {
    const response = await chrome.runtime.sendMessage({ type: 'lpf:mutate-settings', operation });
    if (!response?.ok) throw new Error(response?.error || 'Could not save settings.');
    settings = Core.sanitizeSettings(response.settings);
    renderStatus();
    await forceActivePageRescan();
    return settings;
  }

  function isEditableFocused() {
    const active = document.activeElement;
    return active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
  }

  function renderStatus() {
    enabledToggle.checked = settings.enabled;
    if (document.activeElement !== defaultReplacement) {
      defaultReplacement.value = settings.defaultReplacement;
    }
    replacementInput.placeholder = settings.defaultReplacement;

    const siteDisabled = hostname && Core.isSiteDisabled(settings, hostname);
    if (!settings.enabled) {
      statusText.textContent = 'Off everywhere';
    } else if (siteDisabled) {
      statusText.textContent = `Off on ${hostname}`;
    } else if (connectionState === 'unsupported') {
      statusText.textContent = 'This browser page cannot be filtered';
    } else if (connectionState === 'disconnected') {
      statusText.textContent = 'Reconnecting page filter…';
    } else if (connectionState === 'connected') {
      statusText.textContent = 'Filtering live — connected';
    } else {
      statusText.textContent = 'Checking page filter…';
    }

    siteToggle.textContent = siteDisabled ? 'Enable on this site' : 'Disable on this site';
    siteToggle.disabled = !hostname;
  }

  function renderRuleSelect(preserveSelection = true) {
    const previous = preserveSelection ? editRuleSelect.value : '';
    const rules = settings.words.slice().sort((a, b) => a.word.localeCompare(b.word));
    editRuleSelect.textContent = '';
    filterCount.textContent = `${rules.length} total`;

    if (!rules.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No filters yet';
      editRuleSelect.appendChild(option);
      editRuleSelect.disabled = true;
      editFields.hidden = true;
      return;
    }

    editRuleSelect.disabled = false;
    for (const rule of rules) {
      const option = document.createElement('option');
      option.value = rule.id;
      option.textContent = rule.word;
      editRuleSelect.appendChild(option);
    }

    const selected = rules.some((rule) => rule.id === previous) ? previous : rules[0].id;
    editRuleSelect.value = selected;
    editFields.hidden = false;
    loadSelectedRule();
  }

  function loadSelectedRule() {
    const rule = settings.words.find((item) => item.id === editRuleSelect.value);
    if (!rule) {
      editFields.hidden = true;
      return;
    }
    editFields.hidden = false;
    editWord.value = rule.word;
    editReplacement.value = rule.replacement;
    editMatch.value = rule.match;
    editEnabled.checked = rule.enabled;
    editRepeated.checked = rule.repeated;
    editSeparators.checked = rule.separators;
  }

  function isSupportedPage(url) {
    try {
      const parsed = new URL(url || '');
      return ['http:', 'https:', 'file:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  function pingActivePage() {
    return new Promise((resolve) => {
      if (!activeTab?.id) return resolve(null);
      chrome.tabs.sendMessage(activeTab.id, { type: 'lpf:ping' }, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    });
  }

  async function ensureActivePageConnection() {
    if (!activeTab?.id || !isSupportedPage(activeTab.url)) {
      connectionState = 'unsupported';
      renderStatus();
      return;
    }

    let response = await pingActivePage();
    if (response?.ok) {
      connectionState = 'connected';
      renderStatus();
      return;
    }

    connectionState = 'disconnected';
    renderStatus();
    try {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id, allFrames: true },
          files: ['core.js', 'content.js']
        });
      } catch (_) {
        // Some pages contain frames that reject injection even when the top page
        // is accessible. Fall back to repairing the top frame in that case.
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['core.js', 'content.js']
        });
      }
      response = await pingActivePage();
      connectionState = response?.ok ? 'connected' : 'disconnected';
    } catch (_) {
      connectionState = 'disconnected';
    }
    renderStatus();
  }

  async function forceActivePageRescan() {
    if (!activeTab?.id || !isSupportedPage(activeTab.url)) return;
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'lpf:force-rescan' });
      if (response?.ok) connectionState = 'connected';
    } catch (_) {
      await ensureActivePageConnection();
    }
    renderStatus();
  }

  async function init() {
    await getSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    try { hostname = tab?.url ? new URL(tab.url).hostname : ''; } catch { hostname = ''; }
    renderStatus();
    renderRuleSelect(false);
    await ensureActivePageConnection();
  }

  enabledToggle.addEventListener('change', async () => {
    await mutate({ kind: 'patch', patch: { enabled: enabledToggle.checked } });
  });

  defaultReplacement.addEventListener('change', async () => {
    await mutate({ kind: 'patch', patch: { defaultReplacement: defaultReplacement.value || 'censored' } });
  });

  addButton.addEventListener('click', async () => {
    const word = wordInput.value.trim();
    if (!word) {
      message.textContent = 'Enter a word or phrase first.';
      return;
    }
    if (settings.words.some((item) => item.word.toLowerCase() === word.toLowerCase())) {
      message.textContent = 'That word is already in the list.';
      return;
    }
    await mutate({
      kind: 'addWord',
      entry: {
        word,
        replacement: replacementInput.value || settings.defaultReplacement,
        match: 'exact'
      }
    });
    wordInput.value = '';
    replacementInput.value = '';
    message.textContent = 'Added. Existing pages update immediately.';
    renderRuleSelect(false);
  });

  editRuleSelect.addEventListener('change', loadSelectedRule);

  saveEdit.addEventListener('click', async () => {
    const id = editRuleSelect.value;
    const word = editWord.value.trim();
    if (!id || !word) {
      message.textContent = 'The filter needs a word or phrase.';
      return;
    }
    const duplicate = settings.words.some((item) => item.id !== id && item.word.toLowerCase() === word.toLowerCase());
    if (duplicate) {
      message.textContent = 'Another filter already uses that word or phrase.';
      return;
    }
    await mutate({
      kind: 'updateWord',
      id,
      patch: {
        word,
        replacement: editReplacement.value,
        match: editMatch.value,
        enabled: editEnabled.checked,
        repeated: editRepeated.checked,
        separators: editSeparators.checked
      }
    });
    renderRuleSelect(true);
    message.textContent = 'Filter updated.';
  });

  deleteEdit.addEventListener('click', async () => {
    const id = editRuleSelect.value;
    if (!id) return;
    await mutate({ kind: 'deleteWord', id });
    renderRuleSelect(false);
    message.textContent = 'Filter deleted.';
  });

  siteToggle.addEventListener('click', async () => {
    if (!hostname) return;
    await mutate({ kind: 'toggleSite', hostname });
  });

  openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    settings = Core.sanitizeSettings(changes.settings.newValue);
    renderStatus();
    if (!isEditableFocused()) renderRuleSelect(true);
  });

  init().catch((error) => {
    statusText.textContent = `Extension error: ${error.message}`;
  });
})();
