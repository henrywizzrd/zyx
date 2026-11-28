<div align="center">

<img src="assets/icon.png" width="128" alt="ZYX app icon" />

# ZYX

**A music player for iPhone and Android that cares how your music looks as much as how it sounds.**

[![Download](https://img.shields.io/github/v/release/henrywizzrd/zyx?label=Download&style=for-the-badge&color=8B5A2B)](https://github.com/henrywizzrd/zyx/releases/latest)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/stmhyUDurQ)
![Platforms](https://img.shields.io/badge/iOS%20%7C%20Android-1f1f1f?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-3d3d3d?style=for-the-badge)](LICENSE)

</div>

<p align="center">
  <img src="docs/donate.png" width="100%" alt="Enjoying ZYX? Buy me a coffee: Vietcombank QR code for Vietnam, PayPal QR code for everywhere else" />
</p>
<p align="center">
  <a href="https://paypal.me/Tysonneee"><img src="https://img.shields.io/badge/Donate-PayPal-0070BA?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/portrait.png" width="100%" alt="ZYX home, vinyl player and library screens" />
</p>
<p align="center">
  <img src="docs/screenshots/landscape-player.png" width="80%" alt="Vinyl player with synced lyrics in landscape" />
</p>
<p align="center">
  <img src="docs/screenshots/landscape-home.png" width="49%" alt="Home screen in landscape with the vertical dock" />
  <img src="docs/screenshots/landscape-library.png" width="49%" alt="Library in landscape" />
</p>

---

## Features

- **Vinyl player** — the album spins on a record, with a curved time bar around it and a smoke background tinted by the album art.
- **Live themes** — Smoke, Snow, Sakura, Aurora, Rain, Neon, Starry and more, each with its own moving background.
- **Apple Music–style dock** — a glass tab bar with a sliding highlight, and a vertical dock with a pill-shaped mini player when you turn your phone sideways.
- **Lyrics** while you listen.
- **Offline listening** — download a whole album or playlist with one tap. The button turns green once everything is saved.
- **Built-in log** — send a bug report in a few taps.

## Install

Get the files from the [latest release](https://github.com/henrywizzrd/zyx/releases/latest).

### Android
1. Download `Zyx.apk` on your phone.
2. Open it and tap **Install**. If Android asks, allow your browser to install apps.

### iPhone
ZYX isn't on the App Store yet, so you sign the app yourself:
1. Download `Zyx-unsigned.ipa`.
2. Sign and install it with ESign, [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io).

After the first install, updates arrive inside the app — close and reopen it to apply them.

> Used a test build before v1.1.0? Uninstall it first, then install the new version.

## Report a bug

1. In the app, open **Settings › Log**.
2. Tap share and post the log with a short description of what happened in our [Discord](https://discord.gg/stmhyUDurQ).

## Build from source

You'll need Node.js 22. iOS builds need a Mac with Xcode; Android builds need JDK 17 and the Android SDK.

```bash
git clone https://github.com/henrywizzrd/zyx.git
cd zyx
npm ci
npx expo run:ios       # or: npx expo run:android
```

ZYX is built with Expo and React Native. Pull requests are welcome — for big changes, please open an issue first so we can talk it through.

## License

[MIT](LICENSE) © Henry Wizzrd. You're free to use and change the code, as long as you keep the copyright notice.
