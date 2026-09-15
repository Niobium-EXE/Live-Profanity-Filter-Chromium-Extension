'use strict';

importScripts('core.js');
const Core = globalThis.LiveProfanityCore;
let settingsQueue = Promise.resolve();

async function readSettings() {
  const result = await chrome.storage.local.get('settings');
  return Core.sanitizeSettings(result.settings);
}

function patchWord(rule, patch) {
  return Core.normalizeWord({
    ...rule,
    ...patch,
    id: rule.id
  });
}

function applyOperation(current, operation = {}) {
  let next = Core.sanitizeSettings(current);
  const kind = operation.kind;

  if (kind === 'patch') {
    const allowed = ['enabled', 'defaultReplacement', 'surroundBrackets', 'preserveCase', 'allowlist', 'disabledSites'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(operation.patch || {}, key)) next[key] = operation.patch[key];
    }
  } else if (kind === 'batch') {
    next = applyOperation(next, { kind: 'patch', patch: operation.patch || {} });
    const updates = Array.isArray(operation.wordUpdates) ? operation.wordUpdates : [];
    for (const update of updates) {
      const index = next.words.findIndex((rule) => rule.id === update.id);
      if (index !== -1) next.words[index] = patchWord(next.words[index], update.patch || {});
    }
  } else if (kind === 'addWord') {
    const entry = Core.normalizeWord(operation.entry || {});
    if (entry.word && !next.words.some((item) => item.word.toLowerCase() === entry.word.toLowerCase())) {
      next.words.push(entry);
    }
  } else if (kind === 'updateWord') {
    const index = next.words.findIndex((rule) => rule.id === operation.id);
    if (index !== -1) next.words[index] = patchWord(next.words[index], operation.patch || {});
  } else if (kind === 'deleteWord') {
    next.words = next.words.filter((rule) => rule.id !== operation.id);
  } else if (kind === 'toggleSite') {
    const host = Core.normalizeHost(operation.hostname);
    if (host) {
      const matches = Core.disabledSiteMatches(next, host);
      if (matches.length) {
        next.disabledSites = next.disabledSites.filter((site) => !matches.includes(site));
      } else {
        next.disabledSites = [...next.disabledSites, host];
      }
    }
  } else if (kind === 'replaceSettings') {
    next = Core.sanitizeSettings(operation.settings);
  } else if (kind === 'reset') {
    next = Core.defaultSettings();
  }

  next = Core.sanitizeSettings(next);
  next.revision = current.revision + 1;
  return next;
}

function mutateSettings(operation) {
  settingsQueue = settingsQueue.then(async () => {
    const current = await readSettings();
    const next = applyOperation(current, operation);
    await chrome.storage.local.set({ settings: next });
    return next;
  });
  return settingsQueue;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: Core.defaultSettings() });
  } else {
    await chrome.storage.local.set({ settings: Core.sanitizeSettings(existing.settings) });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lpf-add-selection',
      title: 'Add selection to Live Profanity Filter',
      contexts: ['selection']
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === 'lpf:get-settings') {
    readSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'lpf:mutate-settings') {
    mutateSettings(message.operation)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return undefined;
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'lpf-add-selection' || !info.selectionText) return;
  const word = info.selectionText.trim();
  if (!word) return;
  const current = await readSettings();
  await mutateSettings({
    kind: 'addWord',
    entry: {
      word,
      replacement: current.defaultReplacement,
      match: 'exact'
    }
  });
});
