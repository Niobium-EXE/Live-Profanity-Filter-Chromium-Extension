(() => {
  'use strict';

  const Core = globalThis.LiveProfanityCore;
  let settings;
  let hostname = '';

  const enabledToggle = document.querySelector('#enabledToggle');
  const statusText = document.querySelector('#statusText');
  const wordInput = document.querySelector('#wordInput');
  const replacementInput = document.querySelector('#replacementInput');
  const defaultReplacement = document.querySelector('#defaultReplacement');
  const addButton = document.querySelector('#addButton');
  const message = document.querySelector('#message');
  const siteToggle = document.querySelector('#siteToggle');
  const openOptions = document.querySelector('#openOptions');

  async function save() {
    settings = Core.sanitizeSettings(settings);
    await chrome.storage.local.set({ settings });
    renderStatus();
  }

  function renderStatus() {
    enabledToggle.checked = settings.enabled;
    defaultReplacement.value = settings.defaultReplacement;
    replacementInput.placeholder = settings.defaultReplacement;
    const siteDisabled = hostname && Core.isSiteDisabled(settings, hostname);
    statusText.textContent = !settings.enabled ? 'Off everywhere' : (siteDisabled ? `Off on ${hostname}` : 'Filtering live — no refresh needed');
    siteToggle.textContent = siteDisabled ? 'Enable on this site' : 'Disable on this site';
    siteToggle.disabled = !hostname;
  }

  async function init() {
    const stored = await chrome.storage.local.get('settings');
    settings = Core.sanitizeSettings(stored.settings);
    if (!stored.settings) await chrome.storage.local.set({ settings });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { hostname = tab?.url ? new URL(tab.url).hostname : ''; } catch { hostname = ''; }
    renderStatus();
  }

  enabledToggle.addEventListener('change', async () => {
    settings.enabled = enabledToggle.checked;
    await save();
  });

  defaultReplacement.addEventListener('change', async () => {
    settings.defaultReplacement = defaultReplacement.value || 'censored';
    await save();
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
    settings.words.push(Core.normalizeWord({
      word,
      replacement: replacementInput.value || settings.defaultReplacement,
      match: 'exact'
    }));
    await save();
    wordInput.value = '';
    replacementInput.value = '';
    message.textContent = 'Added. Existing pages update immediately.';
  });

  siteToggle.addEventListener('click', async () => {
    if (!hostname) return;
    const normalized = Core.normalizeHost(hostname);
    const exists = settings.disabledSites.includes(normalized);
    settings.disabledSites = exists
      ? settings.disabledSites.filter((site) => site !== normalized)
      : [...settings.disabledSites, normalized];
    await save();
  });

  openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  init();
})();
