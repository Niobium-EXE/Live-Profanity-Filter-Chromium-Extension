# Live Profanity Filter

A Chrome / Chromium Manifest V3 extension that filters page text live, without requiring a page refresh after changing words or toggling filtering.

## Features

- Live on/off toggle; existing page text is restored when disabled.
- Watches dynamically loaded page content with `MutationObserver`.
- Periodic low-frequency safety rescans recover text on sites that aggressively recycle DOM nodes or attach shadow roots later.
- Cleans up state for removed DOM subtrees so long-running feeds/chats do not accumulate stale text-node references.
- The popup checks its connection to the current page and can automatically re-inject the filter if an unpacked extension reload left the page disconnected.
- Quick popup for adding a word or phrase, editing/deleting an existing filter, changing the default replacement, and toggling the current site.
- Full settings page for editing words, replacements, match modes, allowlist, and site exclusions.
- Replacements are surrounded with brackets by default, e.g. `[censored]`.
- Imports the JSON configuration exported by Advanced Profanity Filter (APF), including words, substitutions, common match modes, repeated-character matching, separator matching, allowlist, and selected general settings.
- Right-click selected text and choose “Add selection to Live Profanity Filter”.
- In Opera and Opera GX, the extension registers its settings page as an Opera sidebar panel. Chrome does not get a Chrome side panel because the extension only declares Opera's `sidebar_action` integration.

## Install locally in Chrome / Opera

1. Unzip this folder somewhere you plan to keep it.
2. Open your browser's extensions page and enable Developer mode.
3. Choose **Load unpacked** and select the `live-profanity-filter` folder.
4. Pin **Live Profanity Filter** if you want the popup in the toolbar.

Chrome/Opera block extensions from changing text on some protected browser pages and extension stores. Normal websites are supported.

## Opera / Opera GX sidebar

Opera provides a browser-specific `sidebar_action` extension API. When Opera recognizes that API, **Live Profanity Filter Settings** can be enabled from Opera's sidebar setup and opens the same full settings interface in the sidebar. Chromium browsers that do not implement Opera's sidebar action do not get this sidebar entry.

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
