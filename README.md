<!-- #Lalittesting -->
# Clean Volume Booster Chrome Extension

A lightweight Manifest V3 Chrome extension that boosts audio for the current tab only. It uses Chrome's `tabCapture` API after the user opens the extension popup and enables boosting.

## Features

- Per-tab volume boosting from 100% to 500%
- Quick presets for 100%, 150%, 200%, 300%, and one-click reset
- Bass boost toggle
- Basic 3-band equalizer for bass, mid, and treble
- Limiter toggle for distortion protection
- Optional per-website setting storage
- Dark/light popup UI
- Safety warning for high volume

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open a media tab, click the extension, and turn the booster on.

## Notes

Chrome requires a user gesture before tab audio can be captured. Saved website settings are loaded into the popup automatically, but boosting starts only after the user enables the extension for the tab.
