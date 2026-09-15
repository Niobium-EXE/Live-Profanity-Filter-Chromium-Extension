(() => {
  'use strict';

  const Core = globalThis.LiveProfanityCore;
  let settings = Core.defaultSettings();
  let saveTimer = 0;
  let pendingPatch = {};
  const pendingWordUpdates = new Map();
  let suppressAutoRenderUntil = 0;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    enabled: $('#enabled'),
    defaultReplacement: $('#defaultReplacement'),
    surroundBrackets: $('#surroundBrackets'),
    preserveCase: $('#preserveCase'),
    disabledSites: $('#disabledSites'),
    allowlist: $('#allowlist'),
    search: $('#search'),
    newWord: $('#newWord'),
    newReplacement: $('#newReplacement'),
    newMatch: $('#newMatch'),
    newRepeated: $('#newRepeated'),
    newSeparators: $('#newSeparators'),
    addWord: $('#addWord'),
    wordRows: $('#wordRows'),
    apfFile: $('#apfFile'),
    apfJson: $('#apfJson'),
    importApf: $('#importApf'),
    exportSettings: $('#exportSettings'),
    importMessage: $('#importMessage'),
    resetDefaults: $('#resetDefaults')
  };

  async function getSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'lpf:get-settings' });
    if (!response?.ok) throw new Error(response?.error || 'Could not load settings.');
    settings = Core.sanitizeSettings(response.settings);
    return settings;
  }

  async function mutate(operation) {
    suppressAutoRenderUntil = Date.now() + 400;
    const response = await chrome.runtime.sendMessage({ type: 'lpf:mutate-settings', operation });
    if (!response?.ok) throw new Error(response?.error || 'Could not save settings.');
    settings = Core.sanitizeSettings(response.settings);
    return settings;
  }

  function hasPending() {
    return Object.keys(pendingPatch).length > 0 || pendingWordUpdates.size > 0;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      flushPending().catch((error) => {
        els.importMessage.textContent = `Save failed: ${error.message}`;
      });
    }, 140);
  }

  async function flushPending() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!hasPending()) return settings;

    const patch = pendingPatch;
    const wordUpdates = [...pendingWordUpdates.entries()].map(([id, rulePatch]) => ({ id, patch: rulePatch }));
    pendingPatch = {};
    pendingWordUpdates.clear();

    return mutate({ kind: 'batch', patch, wordUpdates });
  }

  function queuePatch(key, value) {
    pendingPatch[key] = value;
    settings[key] = value;
    scheduleSave();
  }

  function queueWordUpdate(id, patch) {
    const existing = pendingWordUpdates.get(id) || {};
    pendingWordUpdates.set(id, { ...existing, ...patch });
    const local = settings.words.find((rule) => rule.id === id);
    if (local) Object.assign(local, patch);
    scheduleSave();
  }

  function renderBasics() {
    if (document.activeElement !== els.enabled) els.enabled.checked = settings.enabled;
    if (document.activeElement !== els.defaultReplacement) els.defaultReplacement.value = settings.defaultReplacement;
    if (document.activeElement !== els.surroundBrackets) els.surroundBrackets.checked = settings.surroundBrackets;
    if (document.activeElement !== els.preserveCase) els.preserveCase.checked = settings.preserveCase;
    if (document.activeElement !== els.disabledSites) els.disabledSites.value = settings.disabledSites.join('\n');
    if (document.activeElement !== els.allowlist) els.allowlist.value = settings.allowlist.join('\n');
  }

  function rowFor(rule) {
    const tr = document.createElement('tr');
    tr.dataset.id = rule.id;
    tr.innerHTML = `
      <td data-label="On"><input class="row-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}></td>
      <td data-label="Word / phrase"><input class="row-word" type="text"></td>
      <td data-label="Replacement"><input class="row-replacement" type="text" placeholder="default"></td>
      <td data-label="Match"><select class="row-match"><option value="exact">Exact</option><option value="partial">Partial</option><option value="whole">Whole</option><option value="regex">Regex</option></select></td>
      <td data-label="Repeat"><input class="row-repeated" type="checkbox" ${rule.repeated ? 'checked' : ''}></td>
      <td data-label="Separators"><input class="row-separators" type="checkbox" ${rule.separators ? 'checked' : ''}></td>
      <td data-label=""><button class="delete" title="Delete">Delete</button></td>`;
    tr.querySelector('.row-word').value = rule.word;
    tr.querySelector('.row-replacement').value = rule.replacement;
    tr.querySelector('.row-match').value = rule.match;

    const captureRow = () => {
      queueWordUpdate(rule.id, {
        enabled: tr.querySelector('.row-enabled').checked,
        word: tr.querySelector('.row-word').value.trim(),
        replacement: tr.querySelector('.row-replacement').value,
        match: tr.querySelector('.row-match').value,
        repeated: tr.querySelector('.row-repeated').checked,
        separators: tr.querySelector('.row-separators').checked
      });
    };

    tr.addEventListener('input', captureRow);
    tr.addEventListener('change', captureRow);
    tr.querySelector('.delete').addEventListener('click', async () => {
      await flushPending();
      await mutate({ kind: 'deleteWord', id: rule.id });
      renderRows();
    });
    return tr;
  }

  function renderRows() {
    const query = els.search.value.trim().toLowerCase();
    els.wordRows.textContent = '';
    settings.words
      .filter((rule) => !query || rule.word.toLowerCase().includes(query) || rule.replacement.toLowerCase().includes(query))
      .forEach((rule) => els.wordRows.appendChild(rowFor(rule)));
  }

  function renderAll() {
    renderBasics();
    renderRows();
  }

  function userIsEditing() {
    const active = document.activeElement;
    if (!active) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && active !== els.search;
  }

  async function init() {
    await getSettings();
    renderAll();
  }

  els.enabled.addEventListener('change', () => queuePatch('enabled', els.enabled.checked));
  els.defaultReplacement.addEventListener('input', () => queuePatch('defaultReplacement', els.defaultReplacement.value || 'censored'));
  els.surroundBrackets.addEventListener('change', () => queuePatch('surroundBrackets', els.surroundBrackets.checked));
  els.preserveCase.addEventListener('change', () => queuePatch('preserveCase', els.preserveCase.checked));
  els.disabledSites.addEventListener('input', () => {
    queuePatch('disabledSites', els.disabledSites.value.split(/\r?\n/).map(Core.normalizeHost).filter(Boolean));
  });
  els.allowlist.addEventListener('input', () => {
    queuePatch('allowlist', els.allowlist.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  });
  els.search.addEventListener('input', renderRows);

  els.addWord.addEventListener('click', async () => {
    const word = els.newWord.value.trim();
    if (!word) return;
    await flushPending();
    if (settings.words.some((rule) => rule.word.toLowerCase() === word.toLowerCase())) {
      els.importMessage.textContent = 'That word or phrase is already in the filter list.';
      return;
    }
    await mutate({
      kind: 'addWord',
      entry: {
        word,
        replacement: els.newReplacement.value,
        match: els.newMatch.value,
        repeated: els.newRepeated.checked,
        separators: els.newSeparators.checked
      }
    });
    els.newWord.value = '';
    els.newReplacement.value = '';
    els.newMatch.value = 'exact';
    els.newRepeated.checked = false;
    els.newSeparators.checked = false;
    renderRows();
  });

  els.apfFile.addEventListener('change', async () => {
    const file = els.apfFile.files?.[0];
    if (file) els.apfJson.value = await file.text();
  });

  els.importApf.addEventListener('click', async () => {
    try {
      await flushPending();
      const imported = Core.parseApfConfig(els.apfJson.value);
      await mutate({ kind: 'replaceSettings', settings: imported });
      renderAll();
      els.importMessage.textContent = `Imported ${settings.words.length} APF word entries. Changes are already live on open pages.`;
    } catch (error) {
      els.importMessage.textContent = `Import failed: ${error.message}`;
    }
  });

  els.exportSettings.addEventListener('click', async () => {
    await flushPending();
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'live-profanity-filter-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  els.resetDefaults.addEventListener('click', async () => {
    pendingPatch = {};
    pendingWordUpdates.clear();
    clearTimeout(saveTimer);
    await mutate({ kind: 'reset' });
    renderAll();
    els.importMessage.textContent = 'Defaults restored.';
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    settings = Core.sanitizeSettings(changes.settings.newValue);
    if (Date.now() < suppressAutoRenderUntil || userIsEditing() || hasPending()) return;
    renderAll();
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!userIsEditing() && !hasPending() && Date.now() >= suppressAutoRenderUntil) renderBasics();
    }, 0);
  });

  init().catch((error) => {
    els.importMessage.textContent = `Could not load settings: ${error.message}`;
  });
})();
