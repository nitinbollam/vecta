/* eslint-disable @typescript-eslint/no-require-imports */
const mapboxPlugin = require('@rnmapbox/maps/app.plugin.js');
const withMapbox = mapboxPlugin.default ?? mapboxPlugin;

module.exports = ({ config }) =>
  withMapbox(
    {
      ...config,
      name: 'Vecta',
      slug: 'vecta',
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'light',
      splash: {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#001F3F',
      },
      assetBundlePatterns: ['**/*'],
      ios: {
        supportsTablet: false,
        bundleIdentifier: 'io.vecta.app',
        infoPlist: {
          NFCReaderUsageDescription: 'Vecta uses NFC to read your passport chip.',
          NSFaceIDUsageDescription: 'Vecta uses Face ID for secure authentication.',
          NSCameraUsageDescription: 'Vecta uses your camera for liveness checks.',
          NSLocationWhenInUseUsageDescription: 'Vecta needs your location to find nearby drivers.',
        },
        entitlements: {
          'com.apple.developer.nfc.readersession.formats': ['TAG', 'NDEF'],
        },
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#001F3F',
        },
        package: 'io.vecta.app',
        permissions: [
          'android.permission.NFC',
          'android.permission.CAMERA',
          'android.permission.USE_BIOMETRIC',
          'android.permission.USE_FINGERPRINT',
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.ACCESS_COARSE_LOCATION',
        ],
      },
      web: {
        favicon: './assets/favicon.png',
      },
      plugins: [
        'expo-router',
        'expo-font',
        [
          'expo-splash-screen',
          {
            backgroundColor: '#001F3F',
            image: './assets/splash.png',
            imageWidth: 200,
          },
        ],
        [
          'expo-location',
          {
            locationWhenInUsePermission: 'Vecta needs your location to find nearby drivers.',
          },
        ],
        [
          'expo-notifications',
          {
            icon: './assets/icon.png',
            color: '#001F3F',
          },
        ],
      ],
      experiments: { typedRoutes: true },
      scheme: 'vecta',
      extra: {
        eas: {
          projectId: '83c101ab-e818-4558-b7b6-10d47c1eedf7',
        },
        router: { origin: false },
      },
      owner: 'nitin1005',
    },
    {
      RNMapboxMapsDownloadToken:
        process.env.MAPBOX_SECRET_TOKEN ?? process.env.MAPBOX_DOWNLOADS_TOKEN ?? '',
    },
  );
