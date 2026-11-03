<p align="center">
  <img src="docs/assets/ervo-symbol.svg" alt="" width="84">
  <br>
  <img src="docs/assets/ervo-wordmark.svg" alt="Ervo" width="150">
</p>

<p align="center"><b>Your AI helper, for your life and your business.</b></p>

<p align="center">
  <a href="https://erickb2021-lgtm.github.io/Ervo/">Website</a> ·
  <a href="https://github.com/erickb2021-lgtm/Ervo/releases/latest">Download for Android</a> ·
  <a href="https://erickb2021-lgtm.github.io/Ervo/privacy.html">Privacy</a> ·
  <a href="https://erickb2021-lgtm.github.io/Ervo/terms.html">Terms</a>
</p>

---

Ervo comes as two separate products:

- **Ervo Personal** (personal use only): plans your week, books things, shops and handles your own returns.
- **Ervo for Business** (business use only): answers customer tickets, handles refunds by your policy and keeps your team's schedule on track.

> **Preview:** Ervo isn't connected to real accounts or an AI service yet. Sign-up stays on your device, and Ervo's chat replies are samples.

## Install on Android

1. Open the [latest release](https://github.com/erickb2021-lgtm/Ervo/releases/latest) on your Android phone.
2. Download **Ervo.apk** and open it.
3. If asked, allow installs from your browser or files app, then tap **Install**.

iPhone, Google Play and the App Store are planned for later.

## What's in this repo

| Folder | What it is |
|---|---|
| [`docs/`](docs) | The website, served by GitHub Pages |
| [`android/`](android) | The Android app (Kotlin + the app screens in `app/src/main/assets/www`) |
| [`brand/`](brand) | Logos, the app icon, Ervo's characters and design explorations |
| [`.github/workflows/`](.github/workflows) | Builds the Android app automatically |

## Run the website locally

```bash
python -m http.server 5173 --directory docs
```

Then open http://localhost:5173.

## Build the Android app

You don't need Android Studio: GitHub builds it for you.

- Every push that changes `android/` builds a new APK. Find it under **Actions → Build Android app → Artifacts**.
- To publish a download for everyone, push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

To build on your own computer instead, install [Android Studio](https://developer.android.com/studio), open the `android` folder and press **Run**.

## Credits

Music in the website video: "Ever Changing" by Infraction.

© 2026 Erick S. Bardales. All rights reserved.
