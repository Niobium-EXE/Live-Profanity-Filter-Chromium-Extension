# Live Profanity Filter

A Chrome / Chromium Manifest V3 extension that filters page text live, without requiring a page refresh after changing words or toggling filtering.

## Features

- Live on/off toggle; existing page text is restored when disabled.
- Watches dynamically loaded page content with `MutationObserver`.
- Quick popup for adding a word or phrase and changing the default replacement.
- Full settings page for editing words, replacements, match modes, allowlist, and site exclusions.
- Replacements are surrounded with brackets by default, e.g. `[censored]`.
- Imports the JSON configuration exported by Advanced Profanity Filter (APF), including words, substitutions, common match modes, repeated-character matching, separator matching, allowlist, and selected general settings.
- Right-click selected text and choose “Add selection to Live Profanity Filter”.

## Install locally in Chrome

1. Unzip this folder somewhere you plan to keep it.
2. Open `chrome://extensions/` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the `live-profanity-filter` folder.
6. Pin **Live Profanity Filter** from Chrome's Extensions menu.

Chrome blocks extensions from changing text on some protected browser pages (such as `chrome://` pages and the Chrome Web Store). Normal websites are supported.

## Import Advanced Profanity Filter settings

1. Open Advanced Profanity Filter's Options page.
2. Go to its **Config** section and export/copy the JSON configuration.
3. Open **Live Profanity Filter → Full settings**.
4. Under **Import from Advanced Profanity Filter**, choose the JSON file or paste the JSON.
5. Click **Import APF settings**.

APF can store multiple substitutions separated by its configured separator. This version imports the first substitution for each word so the replacement remains stable when a page is reprocessed.

## Match modes

- **Exact**: only the exact word or phrase.
- **Partial**: match the text anywhere, similar to APF Partial mode.
- **Whole**: match a whole word containing the configured text.
- **Regex**: treat the word field as a JavaScript regular expression pattern.

## Privacy

All settings are stored locally using `chrome.storage.local`. The extension does not send page contents or settings to a server.
