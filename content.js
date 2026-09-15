(() => {
  'use strict';

  // Re-injection is intentional: if the extension has been reloaded or a previous
  // content instance got unhealthy, tear it down and replace it with a fresh one.
  try { globalThis.__LIVE_PROFANITY_FILTER_MANAGER__?.shutdown?.(); } catch (_) {}

  const Core = globalThis.LiveProfanityCore;
  if (!Core) return;

  const VERSION = '1.1.0';
  const SAFETY_SWEEP_MS = 20000;
  const nodeState = new WeakMap();
  const trackedNodes = new Set();
  const observedRoots = new WeakSet();
  const observers = new Set();
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE']);

  let settings = Core.defaultSettings();
  let compiledRules = Core.compileRules(settings);
  let stopped = false;
  let sweepTimer = 0;
  let sweepPending = false;

  function effectiveEnabled() {
    return settings.enabled && !Core.isSiteDisabled(settings, location.hostname);
  }

  function nextAncestor(element) {
    if (!element) return null;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return root?.host instanceof Element ? root.host : null;
  }

  function shouldSkipTextNode(node) {
    if (!node?.parentElement) return true;
    let element = node.parentElement;
    while (element) {
      if (skipTags.has(element.tagName)) return true;
      if (element.isContentEditable) return true;
      if (element.getAttribute?.('data-live-profanity-filter-ignore') === 'true') return true;
      element = nextAncestor(element);
    }
    return false;
  }

  function originalFor(node) {
    const state = nodeState.get(node);
    return state ? state.original : node.nodeValue;
  }

  function forgetNode(node) {
    nodeState.delete(node);
    trackedNodes.delete(node);
  }

  function setFiltered(node, original, filtered) {
    if (filtered === original) {
      const existing = nodeState.get(node);
      if (existing) {
        if (node.nodeValue !== original) node.nodeValue = original;
        forgetNode(node);
      }
      return;
    }

    const existing = nodeState.get(node);
    if (!existing || existing.original !== original || existing.filtered !== filtered) {
      nodeState.set(node, { original, filtered });
      trackedNodes.add(node);
    }
    if (node.nodeValue !== filtered) node.nodeValue = filtered;
  }

  function processTextNode(node, sourceOverride) {
    if (!node || shouldSkipTextNode(node)) return;
    const original = sourceOverride ?? originalFor(node);
    if (!effectiveEnabled()) {
      setFiltered(node, original, original);
      return;
    }
    const filtered = Core.filterText(original, compiledRules, settings);
    setFiltered(node, original, filtered);
  }

  function walkRoot(root) {
    if (!root || stopped) return;
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

  function forgetSubtree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      forgetNode(root);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode;
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        forgetNode(current);
      } else if (current.nodeType === Node.ELEMENT_NODE && current.shadowRoot) {
        forgetSubtree(current.shadowRoot);
      }
      current = walker.nextNode();
    }
  }

  function restoreTracked() {
    for (const node of [...trackedNodes]) {
      const state = nodeState.get(node);
      if (!state || !node.isConnected) {
        forgetNode(node);
        continue;
      }
      if (node.nodeValue !== state.original) node.nodeValue = state.original;
      forgetNode(node);
    }
  }

  function pruneTracked() {
    for (const node of [...trackedNodes]) {
      if (!node.isConnected || !nodeState.has(node)) forgetNode(node);
    }
  }

  function reprocessAll() {
    if (stopped) return;
    if (!effectiveEnabled()) {
      restoreTracked();
      return;
    }
    walkRoot(document.documentElement || document);
    pruneTracked();
  }

  function handleMutations(mutations) {
    if (stopped) return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        const state = nodeState.get(node);
        // MutationObservers report the node's current value, so ignore our own
        // writes only when it still exactly matches the filtered value we set.
        if (state && node.nodeValue === state.filtered) continue;
        const freshOriginal = node.nodeValue;
        if (state) forgetNode(node);
        processTextNode(node, freshOriginal);
      } else if (mutation.type === 'childList') {
        mutation.removedNodes.forEach(forgetSubtree);
        mutation.addedNodes.forEach(walkRoot);
      }
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root) || stopped) return;
    observedRoots.add(root);
    const observer = new MutationObserver(handleMutations);
    observer.observe(root, {
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true
    });
    observers.add(observer);
  }

  function scheduleSafetySweep(immediate = false) {
    if (stopped || sweepPending || document.hidden) return;
    sweepPending = true;
    const run = () => {
      sweepPending = false;
      if (!stopped) reprocessAll();
    };
    if (immediate) {
      queueMicrotask(run);
    } else if ('requestIdleCallback' in globalThis) {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 0);
    }
  }

  function applySettings(nextSettings, force = false) {
    const next = Core.sanitizeSettings(nextSettings);
    if (!force && next.revision < settings.revision) return;
    settings = next;
    compiledRules = Core.compileRules(settings);
    reprocessAll();
  }

  async function loadSettings(force = false) {
    try {
      const stored = await chrome.storage.local.get('settings');
      applySettings(stored.settings, force);
    } catch (_) {
      // If an unpacked extension was reloaded, this old content context may lose
      // access to chrome.runtime. Opening the popup will re-inject a fresh copy.
    }
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes.settings) return;
    applySettings(changes.settings.newValue);
  }

  function onRuntimeMessage(message, _sender, sendResponse) {
    if (!message || stopped) return undefined;
    if (message.type === 'lpf:ping') {
      sendResponse({
        ok: true,
        version: VERSION,
        revision: settings.revision,
        enabled: effectiveEnabled(),
        hostname: location.hostname,
        tracked: trackedNodes.size
      });
      return false;
    }
    if (message.type === 'lpf:force-rescan') {
      loadSettings(true).then(() => {
        scheduleSafetySweep(true);
        sendResponse({ ok: true, revision: settings.revision });
      });
      return true;
    }
    return undefined;
  }

  function onVisibilityChange() {
    if (!document.hidden) scheduleSafetySweep(true);
  }

  const onPageShow = () => scheduleSafetySweep(true);

  function shutdown() {
    if (stopped) return;
    // Put the page back to its original text before replacing this manager.
    // This keeps recovery/re-injection reversible instead of treating the old
    // filtered output as the new original text.
    restoreTracked();
    stopped = true;
    if (sweepTimer) clearInterval(sweepTimer);
    for (const observer of observers) observer.disconnect();
    observers.clear();
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch (_) {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
  }

  globalThis.__LIVE_PROFANITY_FILTER_MANAGER__ = { shutdown, version: VERSION };

  try { chrome.storage.onChanged.addListener(onStorageChanged); } catch (_) {}
  try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch (_) {}
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);

  loadSettings(true).then(() => {
    if (stopped) return;
    observeRoot(document);
    if (document.documentElement) walkRoot(document.documentElement);
    else document.addEventListener('DOMContentLoaded', () => {
      observeRoot(document);
      walkRoot(document.documentElement);
    }, { once: true });

    // A low-frequency idle sweep is a safety net for sites that heavily recycle
    // DOM nodes or attach open shadow roots after their hosts are already mounted.
    sweepTimer = setInterval(() => scheduleSafetySweep(false), SAFETY_SWEEP_MS);
  });
})();
