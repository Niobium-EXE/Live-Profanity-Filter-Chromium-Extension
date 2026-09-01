(() => {
  'use strict';

  const Core = globalThis.LiveProfanityCore;
  let settings;
  let saveTimer;

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

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  }

  async function save() {
    settings = Core.sanitizeSettings(settings);
    await chrome.storage.local.set({ settings });
  }

  function renderBasics() {
    els.enabled.checked = settings.enabled;
    els.defaultReplacement.value = settings.defaultReplacement;
    els.surroundBrackets.checked = settings.surroundBrackets;
    els.preserveCase.checked = settings.preserveCase;
    els.disabledSites.value = settings.disabledSites.join('\n');
    els.allowlist.value = settings.allowlist.join('\n');
  }

  function rowFor(rule) {
    const tr = document.createElement('tr');
    tr.dataset.id = rule.id;
    tr.innerHTML = `
      <td><input class="row-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}></td>
      <td><input class="row-word" type="text"></td>
      <td><input class="row-replacement" type="text" placeholder="default"></td>
      <td><select class="row-match"><option value="exact">Exact</option><option value="partial">Partial</option><option value="whole">Whole</option><option value="regex">Regex</option></select></td>
      <td><input class="row-repeated" type="checkbox" ${rule.repeated ? 'checked' : ''}></td>
      <td><input class="row-separators" type="checkbox" ${rule.separators ? 'checked' : ''}></td>
      <td><button class="delete" title="Delete">Delete</button></td>`;
    tr.querySelector('.row-word').value = rule.word;
    tr.querySelector('.row-replacement').value = rule.replacement;
    tr.querySelector('.row-match').value = rule.match;

    tr.addEventListener('input', () => {
      const target = settings.words.find((item) => item.id === rule.id);
      if (!target) return;
      target.enabled = tr.querySelector('.row-enabled').checked;
      target.word = tr.querySelector('.row-word').value.trim();
      target.replacement = tr.querySelector('.row-replacement').value;
      target.match = tr.querySelector('.row-match').value;
      target.repeated = tr.querySelector('.row-repeated').checked;
      target.separators = tr.querySelector('.row-separators').checked;
      scheduleSave();
    });
    tr.addEventListener('change', () => tr.dispatchEvent(new Event('input')));
    tr.querySelector('.delete').addEventListener('click', () => {
      settings.words = settings.words.filter((item) => item.id !== rule.id);
      renderRows();
      scheduleSave();
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

  async function init() {
    const stored = await chrome.storage.local.get('settings');
    settings = Core.sanitizeSettings(stored.settings);
    if (!stored.settings) await chrome.storage.local.set({ settings });
    renderAll();
  }

  els.enabled.addEventListener('change', () => { settings.enabled = els.enabled.checked; scheduleSave(); });
  els.defaultReplacement.addEventListener('input', () => { settings.defaultReplacement = els.defaultReplacement.value || 'censored'; scheduleSave(); });
  els.surroundBrackets.addEventListener('change', () => { settings.surroundBrackets = els.surroundBrackets.checked; scheduleSave(); });
  els.preserveCase.addEventListener('change', () => { settings.preserveCase = els.preserveCase.checked; scheduleSave(); });
  els.disabledSites.addEventListener('input', () => {
    settings.disabledSites = els.disabledSites.value.split(/\r?\n/).map(Core.normalizeHost).filter(Boolean);
    scheduleSave();
  });
  els.allowlist.addEventListener('input', () => {
    settings.allowlist = els.allowlist.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    scheduleSave();
  });
  els.search.addEventListener('input', renderRows);

  els.addWord.addEventListener('click', () => {
    const word = els.newWord.value.trim();
    if (!word) return;
    settings.words.push(Core.normalizeWord({
      word,
      replacement: els.newReplacement.value,
      match: els.newMatch.value,
      repeated: els.newRepeated.checked,
      separators: els.newSeparators.checked
    }));
    els.newWord.value = '';
    els.newReplacement.value = '';
    els.newMatch.value = 'exact';
    els.newRepeated.checked = false;
    els.newSeparators.checked = false;
    renderRows();
    scheduleSave();
  });

  els.apfFile.addEventListener('change', async () => {
    const file = els.apfFile.files?.[0];
    if (file) els.apfJson.value = await file.text();
  });

  els.importApf.addEventListener('click', async () => {
    try {
      const imported = Core.parseApfConfig(els.apfJson.value);
      settings = imported;
      await save();
      renderAll();
      els.importMessage.textContent = `Imported ${settings.words.length} APF word entries. Changes are already live on open pages.`;
    } catch (error) {
      els.importMessage.textContent = `Import failed: ${error.message}`;
    }
  });

  els.exportSettings.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'live-profanity-filter-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  els.resetDefaults.addEventListener('click', async () => {
    settings = Core.defaultSettings();
    await save();
    renderAll();
    els.importMessage.textContent = 'Defaults restored.';
  });

  init();
})();
