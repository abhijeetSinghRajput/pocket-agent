import type { ExpoConfig } from 'expo/config';

/**
 * Pocket Agent for Android and iOS.
 *
 * EXPO_PUBLIC_API_URL: the API this build talks to (default: the hosted one).
 * POCKET_AGENT_ALLOW_HTTP=1: allow plain http (a local API on an emulator); never for a release.
 * GOOGLE_SERVICES_JSON: path to the Firebase config that turns on push on Android.
 */
const allowHttp = process.env.POCKET_AGENT_ALLOW_HTTP === '1';
const BRAND = '#ee6a1b';

const config: ExpoConfig = {
  name: 'Pocket Agent',
  slug: 'pocket-agent',
  owner: 'pocket-agents-team',
  version: '2.3.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'pocketagent',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.mrcodium.pocketagent',
    supportsTablet: false,
  },
  android: {
    package: 'com.mrcodium.pocketagent',
    versionCode: 6,
    // Firebase config for push (Firebase console → project settings → the Android app). Locally:
    // GOOGLE_SERVICES_JSON=./google-services.json; on EAS: a file environment variable of that name.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    adaptiveIcon: {
      backgroundColor: BRAND,
      foregroundImage: './assets/images/adaptive-foreground.png',
    },
    softwareKeyboardLayoutMode: 'resize',
    // Added by libraries but never used: no drawing over other apps, no writing to shared storage
    // (photos are picked with the system picker). The microphone is used only while you dictate a
    // message (modules/speech-input), and asked for the first time you tap the mic.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: '#0a0a0b', image: './assets/images/splash-icon.png', imageWidth: 96 },
    ],
    'expo-secure-store',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: allowHttp,
          // Release builds are shrunk by R8. The home-screen widget is driven by Android (receiver,
          // WorkManager job, headless JS service) and names itself by its class name, so its code
          // must stay as it is.
          extraProguardRules: [
            '-keep class com.reactnativeandroidwidget.** { *; }',
            '-keep class com.mrcodium.pocketagent.widget.** { *; }',
          ].join('\n'),
        },
      },
    ],
    // Push: the server sends through Firebase; Android needs google-services.json next to this
    // file (Firebase console → project settings → the Android app). Without it the app still
    // works, only the phone's own notifications are off.
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: BRAND }],
    // "Continue with Google" (uses the Firebase project's OAuth clients from google-services.json).
    '@react-native-google-signin/google-signin',
    // Reading a PC's pairing QR code (Devices → Scan the PC's QR code). The microphone stays
    // available for dictation (recordAudioAndroid), not for the camera.
    [
      'expo-camera',
      {
        cameraPermission: 'Pocket Agent uses the camera to scan the QR code your PC shows when connecting.',
        recordAudioAndroid: true,
      },
    ],
    // Attaching photos to a message (the chat's + button).
    [
      'expo-image-picker',
      {
        photosPermission: 'Pocket Agent sends the photos you pick to Claude on your PC.',
        cameraPermission: 'Pocket Agent sends the photos you take to Claude on your PC.',
        // Photos only, never video. (The microphone is for dictation: modules/speech-input.)
      },
    ],
    // The home-screen widget (Android): Claude usage of your PC.
    [
      'react-native-android-widget',
      {
        fonts: [
          './node_modules/@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf',
          './node_modules/@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf',
          './node_modules/@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf',
        ],
        widgets: [
          {
            name: 'Usage',
            label: 'Claude usage',
            description: 'Your Claude plan usage: the session and weekly limits of your PC.',
            minWidth: '250dp',
            minHeight: '210dp',
            targetCellWidth: 4,
            targetCellHeight: 3,
            // Taller than its meters need only looks empty: stops a little past the roomy layout.
            maxResizeHeight: '260dp',
            resizeMode: 'horizontal|vertical',
            updatePeriodMillis: 30 * 60 * 1000,
            // What the widget picker shows: a picture of the widget.
            previewImage: './assets/images/widget-preview.png',
          },
        ],
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  // The Expo (EAS) project the cloud builds belong to.
  extra: { eas: { projectId: '8fd9b55c-b6d6-49c4-840d-1cafbcbd2822' } },
};

export default config;
