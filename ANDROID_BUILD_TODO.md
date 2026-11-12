# Android AAB build — Coolerup

## 1. Toolchain
- [ ] Install JDK 17
- [ ] Install Android cmdline-tools + platform-tools + platforms;android-34 + build-tools;34.0.0
- [ ] Accept SDK licenses

## 2. Capacitor
- [ ] Install @capacitor/core, cli, android
- [ ] Add capacitor.config.ts (appId com.coolerup.app, appName Coolerup)
- [ ] npm run build
- [ ] npx cap add android
- [ ] npx cap copy / sync

## 3. Branding & metadata
- [ ] Generate launcher icons (all densities) from 512x512 PNG
- [ ] Generate adaptive icon + splash
- [ ] Feature graphic 1024x500
- [ ] versionName 1.0.0, versionCode 1
- [ ] Release notes text

## 4. Signing
- [ ] Create coolerup.keystore (RSA 2048, 10000 days)
- [ ] Store credentials safely, document them
- [ ] Wire signingConfigs into app/build.gradle

## 5. Build
- [ ] ./gradlew bundleRelease -> app-release.aab
- [ ] ./gradlew assembleRelease -> app-release.apk
- [ ] Verify AAB with bundletool / aapt
- [ ] Publish download links
