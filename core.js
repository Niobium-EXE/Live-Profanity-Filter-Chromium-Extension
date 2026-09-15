(() => {
  'use strict';

  const MATCH_NAMES = ['exact', 'partial', 'whole', 'regex'];

  const DEFAULT_WORDS = [
    { word: 'ass', replacement: 'butt', match: 'exact', repeated: true },
    { word: 'asshole', replacement: 'jerk', match: 'partial', repeated: true },
    { word: 'bastard', replacement: 'jerk', match: 'partial' },
    { word: 'bitch', replacement: 'jerk', match: 'partial', repeated: true },
    { word: 'damn', replacement: 'dang', match: 'partial' },
    { word: 'dammit', replacement: 'dangit', match: 'partial', separators: true },
    { word: 'dick', replacement: 'jerk', match: 'exact' },
    { word: 'fuck', replacement: 'fudge', match: 'partial', repeated: true },
    { word: 'fucking', replacement: 'freaking', match: 'partial', repeated: true },
    { word: 'motherfucker', replacement: 'jerk', match: 'partial', repeated: true, separators: true },
    { word: 'piss', replacement: 'pee', match: 'partial' },
    { word: 'shit', replacement: 'shoot', match: 'partial', repeated: true },
    { word: 'bullshit', replacement: 'nonsense', match: 'partial', repeated: true, separators: true }
  ];

  function uid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  function defaultSettings() {
    return {
      schemaVersion: 2,
      revision: 0,
      enabled: true,
      defaultReplacement: 'censored',
      surroundBrackets: true,
      preserveCase: true,
      words: DEFAULT_WORDS.map((entry) => normalizeWord(entry)),
      allowlist: [],
      disabledSites: []
    };
  }

  function normalizeWord(entry = {}) {
    const numericMatch = typeof entry.matchMethod === 'number' ? MATCH_NAMES[entry.matchMethod] : undefined;
    const word = String(entry.word ?? entry.value ?? '').trim();
    return {
      id: String(entry.id || uid()),
      word,
      replacement: String(entry.replacement ?? entry.sub ?? ''),
      match: ['exact', 'partial', 'whole', 'regex'].includes(entry.match) ? entry.match : (numericMatch || 'exact'),
      repeated: Boolean(entry.repeated ?? entry.repeat),
      separators: Boolean(entry.separators),
      caseSensitive: Boolean(entry.caseSensitive ?? entry.case),
      enabled: entry.enabled !== false
    };
  }

  function sanitizeSettings(raw) {
    const defaults = defaultSettings();
    if (!raw || typeof raw !== 'object') return defaults;

    const words = Array.isArray(raw.words)
      ? raw.words.map(normalizeWord).filter((w) => w.word)
      : defaults.words;

    return {
      schemaVersion: 2,
      revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      enabled: raw.enabled !== false,
      defaultReplacement: String(raw.defaultReplacement ?? defaults.defaultReplacement),
      surroundBrackets: raw.surroundBrackets !== false,
      preserveCase: raw.preserveCase !== false,
      words,
      allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.map(String).map((s) => s.trim()).filter(Boolean) : [],
      disabledSites: Array.isArray(raw.disabledSites) ? [...new Set(raw.disabledSites.map(String).map(normalizeHost).filter(Boolean))] : []
    };
  }

  function bumpRevision(raw) {
    const settings = sanitizeSettings(raw);
    settings.revision += 1;
    return settings;
  }

  function normalizeHost(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .replace(/^\.+|\.+$/g, '');
  }

  function disabledSiteMatches(settings, hostname) {
    const host = normalizeHost(hostname);
    if (!host) return [];
    return settings.disabledSites.filter((site) => host === site || host.endsWith(`.${site}`));
  }

  function isSiteDisabled(settings, hostname) {
    return disabledSiteMatches(settings, hostname).length > 0;
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function processedPhrase(word, repeated, separators) {
    const source = escapeRegex(word);
    let out = '';
    for (let i = 0; i < source.length; i += 1) {
      let ch = source[i];
      if (ch === '\\' && i + 1 < source.length) {
        ch += source[i + 1];
        i += 1;
      }
      out += ch;
      if (repeated) out += '+';
      if (separators && i < source.length - 1) out += '[-_ ]*';
    }
    return out;
  }

  function compileRule(rule) {
    const options = rule.caseSensitive ? 'g' : 'gi';
    try {
      if (rule.match === 'regex') {
        return { ...rule, regex: new RegExp(rule.word, options) };
      }

      const phrase = processedPhrase(rule.word, rule.repeated, rule.separators);
      let pattern;
      if (rule.match === 'partial') {
        pattern = phrase;
      } else if (rule.match === 'whole') {
        pattern = `\\b[\\w-]*${phrase}[\\w-]*\\b`;
      } else {
        pattern = `\\b${phrase}\\b`;
      }
      return { ...rule, regex: new RegExp(pattern, options) };
    } catch (error) {
      return { ...rule, regex: null, error: error.message };
    }
  }

  function compileRules(settings) {
    return settings.words
      .filter((w) => w.enabled && w.word)
      .slice()
      .sort((a, b) => b.word.length - a.word.length)
      .map(compileRule)
      .filter((r) => r.regex);
  }

  function applyCase(sample, replacement) {
    if (!replacement) return replacement;
    if (sample.toUpperCase() === sample && sample.toLowerCase() !== sample) return replacement.toUpperCase();
    const first = sample.charAt(0);
    if (first && first.toUpperCase() === first && first.toLowerCase() !== first) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  function chooseReplacement(rule, settings, matched) {
    const raw = rule.replacement || settings.defaultReplacement;
    const first = String(raw).split(';;').find((part) => part.length) ?? settings.defaultReplacement;
    const replacement = settings.preserveCase ? applyCase(matched, first) : first;
    return settings.surroundBrackets ? `[${replacement}]` : replacement;
  }

  function protectAllowlist(text, allowlist) {
    const saved = [];
    let protectedText = text;
    const phrases = allowlist.slice().sort((a, b) => b.length - a.length);
    phrases.forEach((phrase) => {
      if (!phrase) return;
      const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
      protectedText = protectedText.replace(regex, (match) => {
        const index = saved.push(match) - 1;
        return `\uE000LPF${index}\uE001`;
      });
    });
    return { protectedText, saved };
  }

  function restoreAllowlist(text, saved) {
    return text.replace(/\uE000LPF(\d+)\uE001/g, (_, index) => saved[Number(index)] ?? '');
  }

  function filterText(text, compiledRules, settings) {
    if (!settings.enabled || !text || !compiledRules.length) return text;
    const { protectedText, saved } = protectAllowlist(text, settings.allowlist);
    let output = protectedText;
    for (const rule of compiledRules) {
      rule.regex.lastIndex = 0;
      output = output.replace(rule.regex, (match) => chooseReplacement(rule, settings, match));
    }
    return restoreAllowlist(output, saved);
  }

  function findApfConfig(input) {
    if (!input || typeof input !== 'object') return null;
    if (input.words && !Array.isArray(input.words) && typeof input.words === 'object') return input;
    for (const key of ['config', 'settings', 'data']) {
      const candidate = input[key];
      if (candidate?.words && !Array.isArray(candidate.words) && typeof candidate.words === 'object') return candidate;
    }
    return null;
  }

  function parseApfConfig(input) {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    const apf = findApfConfig(parsed);
    if (!apf) throw new Error('Could not find an Advanced Profanity Filter "words" object in this JSON.');

    const separator = typeof apf.wordSubSeparator === 'string' && apf.wordSubSeparator ? apf.wordSubSeparator : ';;';
    const words = Object.entries(apf.words).map(([word, options]) => {
      const item = options && typeof options === 'object' ? options : {};
      let replacement = String(item.sub ?? apf.defaultSubstitution ?? 'censored');
      if (separator && replacement.includes(separator)) replacement = replacement.split(separator)[0];
      return normalizeWord({
        word,
        replacement,
        matchMethod: Number.isInteger(item.matchMethod) ? item.matchMethod : (Number.isInteger(apf.defaultWordMatchMethod) ? apf.defaultWordMatchMethod : 0),
        repeat: item.repeat ?? apf.defaultWordRepeat ?? 0,
        separators: item.separators ?? apf.defaultWordSeparators ?? 0,
        case: item.case ?? 0
      });
    }).filter((w) => w.word);

    return sanitizeSettings({
      enabled: apf.filterMethod !== 3,
      defaultReplacement: apf.defaultSubstitution ?? 'censored',
      surroundBrackets: true,
      preserveCase: apf.preserveCase !== false,
      words,
      allowlist: Array.isArray(apf.wordAllowlist) ? apf.wordAllowlist : [],
      disabledSites: []
    });
  }

  globalThis.LiveProfanityCore = {
    MATCH_NAMES,
    defaultSettings,
    sanitizeSettings,
    bumpRevision,
    normalizeWord,
    normalizeHost,
    disabledSiteMatches,
    isSiteDisabled,
    compileRules,
    filterText,
    parseApfConfig
  };
})();
