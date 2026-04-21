# Build your own APK — Bhasha Bridge

This guide walks you through producing a sideloadable **Android APK** of Bhasha Bridge using [EAS Build](https://docs.expo.dev/build/introduction/) from your own machine.

> Android package name: `com.riti.bashabridge`
> Bundle identifier (iOS): `com.riti.bashabridge`

---

## 1. Get the code out of Emergent

Use Emergent's **Save to GitHub** feature (top-right of the builder UI) to push this project to a GitHub repo you own. Then on your local machine:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>/frontend
```

## 2. Install prerequisites (one-time)

```bash
# Node 20+ and npm/yarn
node -v      # should be >= 20

# EAS CLI (Expo's build tool)
npm install -g eas-cli

# Frontend dependencies
yarn install    # or: npm install
```

## 3. Create a free Expo account & log in

```bash
eas login
# follow prompts or sign up at https://expo.dev first
```

## 4. Link the project to EAS (one-time)

From inside the `frontend/` folder:

```bash
eas init
```

This will create a project on your Expo account and write its `projectId` into `app.json` (keep the commit).

## 5. Build the APK

```bash
eas build --platform android --profile preview
```

- First build takes ~10–15 min (EAS provisions a keystore for you automatically — say "yes" when prompted).
- When it finishes you'll get a URL like `https://expo.dev/accounts/<you>/projects/bhasha-bridge/builds/<id>` with an **Install / Download APK** button.
- Send that link (or the APK) to any Android tester.

### Installing the APK
On the Android device:
1. Download the `.apk`.
2. Allow "Install unknown apps" for your browser.
3. Tap the file to install.
4. Open **Bhasha Bridge**, grant microphone permission, and start translating.

## 6. (Optional) Production App Bundle for Play Store

```bash
eas build --platform android --profile production
```

Outputs an `.aab` suitable for the Play Store. Requires a Play Console account ($25 one-time fee).

---

## Backend URL notes

The APK points to the backend at **`EXPO_PUBLIC_BACKEND_URL`**, currently baked into `eas.json`:

```
https://speak-translate-chat.preview.emergentagent.com
```

That preview URL is tied to this workspace and may go offline. For a stable APK:

1. In Emergent, click **Deploy** to get a permanent backend URL (e.g. `https://bhasha-bridge.emergent.host`).
2. Edit `frontend/eas.json` and replace the two `EXPO_PUBLIC_BACKEND_URL` values with your deployed URL.
3. Rebuild with `eas build -p android --profile preview`.

## Troubleshooting

- **"Invalid package name"** → make sure `app.json > android.package` is `com.riti.bashabridge` (already set).
- **Build fails on `expo-audio` permission** → ensure `app.json` includes the `expo-audio` plugin block (already set).
- **Translations fail inside the APK** → the baked-in `EXPO_PUBLIC_BACKEND_URL` is unreachable. Re-check step "Backend URL notes".
- **Mic does nothing** → Android Settings → Apps → Bhasha Bridge → Permissions → enable Microphone.

---

## Quick reference

```bash
# APK for testing (sideload)
eas build -p android --profile preview

# AAB for Play Store
eas build -p android --profile production

# iOS (needs Apple Developer account, $99/year)
eas build -p ios --profile preview
```
