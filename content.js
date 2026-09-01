(() => {
  'use strict';

  const Core = globalThis.LiveProfanityCore;
  const nodeState = new WeakMap();
  const trackedNodes = new Set();
  const observedRoots = new WeakSet();
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE']);

  let settings = Core.defaultSettings();
  let compiledRules = Core.compileRules(settings);

  function effectiveEnabled() {
    return settings.enabled && !Core.isSiteDisabled(settings, location.hostname);
  }

  function shouldSkipTextNode(node) {
    if (!node?.parentElement) return true;
    let element = node.parentElement;
    while (element) {
      if (skipTags.has(element.tagName)) return true;
      if (element.isContentEditable) return true;
      if (element.getAttribute?.('data-live-profanity-filter-ignore') === 'true') return true;
      element = element.parentElement;
    }
    return false;
  }

  function originalFor(node) {
    const state = nodeState.get(node);
    return state ? state.original : node.nodeValue;
  }

  function setFiltered(node, original, filtered) {
    if (filtered === original) {
      const existing = nodeState.get(node);
      if (existing) {
        if (node.nodeValue !== original) node.nodeValue = original;
        nodeState.delete(node);
        trackedNodes.delete(node);
      }
      return;
    }

    const state = { original, filtered };
    nodeState.set(node, state);
    trackedNodes.add(node);
    if (node.nodeValue !== filtered) node.nodeValue = filtered;
  }

  function processTextNode(node, sourceOverride) {
    if (shouldSkipTextNode(node)) return;
    const original = sourceOverride ?? originalFor(node);
    if (!effectiveEnabled()) {
      setFiltered(node, original, original);
      return;
    }
    const filtered = Core.filterText(original, compiledRules, settings);
    setFiltered(node, original, filtered);
  }

  function walkRoot(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode;
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        processTextNode(current);
      } else if (current.nodeType === Node.ELEMENT_NODE && current.shadowRoot) {
        observeRoot(current.shadowRoot);
        walkRoot(current.shadowRoot);
      }
      current = walker.nextNode();
    }
  }

  function restoreTracked() {
    for (const node of [...trackedNodes]) {
      const state = nodeState.get(node);
      if (!state || !node.isConnected) {
        trackedNodes.delete(node);
        continue;
      }
      if (node.nodeValue !== state.original) node.nodeValue = state.original;
      nodeState.delete(node);
      trackedNodes.delete(node);
    }
  }

  function reprocessAll() {
    if (!effectiveEnabled()) {
      restoreTracked();
      return;
    }

    const originals = new Map();
    for (const node of trackedNodes) {
      const state = nodeState.get(node);
      if (state && node.isConnected) originals.set(node, state.original);
    }

    walkRoot(document.documentElement || document);
    for (const [node, original] of originals) {
      if (node.isConnected) processTextNode(node, original);
    }
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        const state = nodeState.get(node);
        if (state && node.nodeValue === state.filtered) continue;
        const freshOriginal = node.nodeValue;
        if (state) {
          nodeState.delete(node);
          trackedNodes.delete(node);
        }
        processTextNode(node, freshOriginal);
      } else if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => walkRoot(node));
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) trackedNodes.delete(node);
        });
      }
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    const observer = new MutationObserver(handleMutations);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get('settings');
    settings = Core.sanitizeSettings(stored.settings);
    compiledRules = Core.compileRules(settings);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    settings = Core.sanitizeSettings(changes.settings.newValue);
    compiledRules = Core.compileRules(settings);
    reprocessAll();
  });

  loadSettings().then(() => {
    observeRoot(document);
    if (document.documentElement) walkRoot(document.documentElement);
    else document.addEventListener('DOMContentLoaded', () => walkRoot(document.documentElement), { once: true });
  });
})();
