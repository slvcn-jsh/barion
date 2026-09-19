# Running Barion for iOS and iPadOS from Windows

Barion cannot use Apple's local iOS Simulator on Windows. This project instead supports a
cloud-built iOS Simulator app through Expo Application Services (EAS).

## What is configured

- `development-simulator`: a Barion development client for native debugging and Fast Refresh.
- `preview-simulator`: a standalone native simulator build for browser-streaming services such
  as Appetize.
- iPhone and iPad layouts. `ios.supportsTablet` remains enabled.
- Bundle identifier `com.barion.medstudy` for native build identity.

Neither profile creates an App Store/device `.ipa`. Simulator builds do not require an Apple
Developer Program membership.

## One-time Expo setup

The Expo account owner must run these commands interactively:

```powershell
npm run eas:login
npm run eas:link
```

Do not commit Expo access tokens or `.env.eas-simulator`. The latter is ignored by Git.

## Preferred: EAS remote iOS Simulator

First check whether the signed-in Expo account has early access:

```powershell
npm run ios:cloud:check
```

If access is enabled:

1. Create the native development build:

   ```powershell
   npm run ios:build:development
   ```

2. Start Barion's development server from Windows:

   ```powershell
   npm run start:mobile
   ```

3. Start an EAS iOS simulator using the completed build ID and the development URL printed by
   Expo CLI. Follow the connection command printed by `eas simulator:start`; EAS Simulator is
   experimental and its CLI surface may change.

The development client only needs rebuilding after native dependencies, Expo configuration, or
the Expo SDK changes. TypeScript, JavaScript, styles, and images update through Fast Refresh.

Always stop the cloud simulator after testing so it does not consume unnecessary session time:

```powershell
npx eas-cli@latest simulator:stop
```

## Available fallback: Appetize browser simulator

If EAS Simulator is not enabled for the account:

1. Build the standalone iOS Simulator app:

   ```powershell
   npm run ios:build:preview
   ```

2. Download the completed `.app` archive from the EAS build page.
3. Upload the archive to Appetize.
4. Select an iPad device profile and test Barion in the browser stream.

The preview build is production-like but does not use live Fast Refresh. Create another preview
build when the native/JavaScript bundle must be updated. Use the development profile instead if
the streaming provider needs a development client connected to the Expo tunnel.

### Live changes through Appetize

Use the development-client archive when iterating on screens:

1. Build it once, and upload its `.tar.gz` archive to Appetize:

   ```powershell
   npm run ios:build:development
   ```

2. Start the public Metro tunnel and leave that terminal running:

   ```powershell
   npm run start:mobile
   ```

3. Open the development-client build in the Appetize iPad, choose **Enter URL manually**, and
   paste the development URL printed by Expo CLI.
4. Save a TypeScript, JavaScript, style, or image change. Fast Refresh updates the streamed app.

Rebuild and re-upload the development client only after changing native dependencies, Expo
plugins, the app identifier, or other native configuration. Tunnel URLs are public and temporary;
stop Expo CLI with `Ctrl+C` after the session.

## Important testing boundaries

- A simulator is the correct environment for iOS layout, navigation, SQLite, file picking, and
  most offline workflows, but it is not a physical-device performance test.
- Web and iOS use separate local SQLite databases. Use **Manage Library → Data & Backup** to move
  representative learning data between environments.
- Native PDF extraction currently requires `EXPO_PUBLIC_BARION_INGESTION_URL`. Without it, test
  TXT/Markdown imports or restore a backup containing extracted evidence and cards.
- Source files and medical learning data are uploaded to an external service only when a build or
  simulator workflow is explicitly started.
