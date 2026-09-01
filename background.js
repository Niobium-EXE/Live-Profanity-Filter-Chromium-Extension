'use strict';

importScripts('core.js');
const Core = globalThis.LiveProfanityCore;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: Core.defaultSettings() });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lpf-add-selection',
      title: 'Add selection to Live Profanity Filter',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'lpf-add-selection' || !info.selectionText) return;
  const result = await chrome.storage.local.get('settings');
  const settings = Core.sanitizeSettings(result.settings);
  const word = info.selectionText.trim();
  if (!word) return;
  if (settings.words.some((item) => item.word.toLowerCase() === word.toLowerCase())) return;

  settings.words.push(Core.normalizeWord({
    word,
    replacement: settings.defaultReplacement,
    match: 'exact'
  }));
  await chrome.storage.local.set({ settings });
});
