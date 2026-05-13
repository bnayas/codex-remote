# Codex Remote — Android App

React Native Android app (full native rewrite) for controlling Codex CLI sessions over Tailscale.

## Structure

```
codex-remote-android/
├── App.tsx                          # Root: navigation + credential bootstrap
├── index.js                         # RN entry point
├── src/
│   ├── types.ts                     # Shared types (mirrors backend)
│   ├── theme.ts                     # Colors, fonts, radius tokens
│   ├── api.ts                       # Typed fetch client (AsyncStorage-backed)
│   ├── useSessionStream.ts          # Auto-reconnecting WebSocket hook
│   ├── utils.ts                     # Time helpers, ANSI stripper
│   ├── components/
│   │   ├── ui.tsx                   # StatusDot, AccentButton, CtrlButton, Badge…
│   │   ├── Terminal.tsx             # FlatList-based terminal (2000-line ring buffer)
│   │   ├── InputBar.tsx             # Native keyboard-aware input bar
│   │   ├── ControlBar.tsx           # Interrupt / Stop / Kill Tree (haptics + confirm)
│   │   ├── FilesPanel.tsx           # Changed files with inline lazy diff viewer
│   │   └── PlanEditor.tsx           # Plan save/edit/send with quick actions
│   └── screens/
│       ├── SetupScreen.tsx          # URL + token entry
│       ├── ProjectsScreen.tsx       # Project list + recent sessions
│       ├── ProjectDetailScreen.tsx  # Session list + new session bottom sheet
│       └── SessionScreen.tsx        # Core: Terminal/Files/Plan tabs
```

## Differences vs PWA

| | PWA | Android |
|---|---|---|
| Storage | `localStorage` | `AsyncStorage` |
| Terminal | DOM + `div` | `FlatList` (virtualized, high perf) |
| Navigation | custom state machine | `@react-navigation/native-stack` |
| Kill controls | tap-to-confirm in DOM | tap-to-confirm + **haptic feedback** |
| Input | HTML `textarea` | `TextInput` with `KeyboardAvoidingView` |
| Scrollback | DOM array | Ring buffer via `useImperativeHandle` |
| Back navigation | JS `onBack` prop | Native Android back gesture |
| Install | PWA manifest | APK / Play Store |

## Setup

### 1. Bootstrap a new RN project

```bash
npx react-native init codexremote \
  --template react-native-template-typescript \
  --version 0.73.6
```

### 2. Replace source files

```bash
# Copy all files from this directory into the init'd project
cp -r codex-remote-android/src/ codexremote/src/
cp codex-remote-android/App.tsx codexremote/
cp codex-remote-android/package.json codexremote/
```

### 3. Install dependencies

```bash
cd codexremote
npm install
```

### 4. Android manifest tweaks

Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.VIBRATE" />
```

### 5. Network security (release builds only)

Create `android/app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">localhost</domain>
  </domain-config>
  <!-- Allow Tailscale CGNAT range -->
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

Add to `<application>` in manifest:
```xml
android:networkSecurityConfig="@xml/network_security_config"
```

For local HTTP over Tailscale in debug mode, cleartext is permitted by default.

### 6. Vector icons

Add to `android/app/build.gradle` (before `dependencies`):
```gradle
apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"
```

### 7. Run

```bash
# Start Metro
npm start

# In another terminal
npm run android
```

## Key native behaviors

**Terminal** (`Terminal.tsx`)
- `FlatList` with `removeClippedSubviews` and `maxToRenderPerBatch=40` for smooth scrolling of 2000+ lines
- `useImperativeHandle` exposes `appendOutput`, `setScrollback`, `appendLine` to parent
- ANSI escape codes stripped before render
- Auto-scroll to bottom on new output, paused when user scrolls up

**Control bar** (`ControlBar.tsx`)
- Three distinct controls: Interrupt (`Ctrl+C`), Stop Codex (`SIGTERM`), Kill Tree (`SIGKILL`)
- Each requires a second tap to confirm
- Confirms auto-cancel after 3 seconds
- `react-native-haptic-feedback`: medium impact on first tap, heavy on confirm

**Session screen** (`SessionScreen.tsx`)
- Terminal tab is always mounted (keeps output buffer alive) but hidden via `position: absolute / opacity: 0` when another tab is active
- Files tab and Plan tab are lazily mounted
- WebSocket reconnects automatically with 2.5s backoff

**Navigation**
- Native stack navigator (`@react-navigation/native-stack`) for hardware back button support
- Slide-from-right animation
- `useFocusEffect` for refresh-on-focus in list screens

## Connecting to backend

The backend URL should be your laptop's **Tailscale IP**:
```
http://100.x.x.x:3742
```

Token is printed on backend startup and stored in `~/.codex-remote/config.yaml`.
