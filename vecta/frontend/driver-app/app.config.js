/* eslint-disable @typescript-eslint/no-require-imports */
const mapboxPlugin = require('@rnmapbox/maps/app.plugin.js');
const withMapbox = mapboxPlugin.default ?? mapboxPlugin;

module.exports = ({ config }) =>
  withMapbox(
    {
      ...config,
      name: 'Vecta Driver',
      slug: 'vecta-driver',
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      splash: { backgroundColor: '#001F3F', image: './assets/splash.png', resizeMode: 'contain' },
      ios: {
        bundleIdentifier: 'io.vecta.driver',
        infoPlist: {
          NSLocationAlwaysAndWhenInUseUsageDescription:
            'Vecta Driver needs your location to match you with riders.',
          NSLocationWhenInUseUsageDescription: 'Vecta Driver needs your location to match you with riders.',
          NSCameraUsageDescription: 'Used to upload driver documents.',
        },
      },
      android: {
        package: 'io.vecta.driver',
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#001F3F',
        },
        permissions: [
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.ACCESS_COARSE_LOCATION',
          'android.permission.ACCESS_BACKGROUND_LOCATION',
          'android.permission.CAMERA',
          'android.permission.FOREGROUND_SERVICE',
          'android.permission.FOREGROUND_SERVICE_LOCATION',
        ],
      },
      plugins: [
        'expo-router',
        'expo-font',
        [
          'expo-location',
          {
            locationAlwaysAndWhenInUsePermission: 'Allow Vecta Driver to use your location.',
            isIosBackgroundLocationEnabled: true,
            isAndroidBackgroundLocationEnabled: true,
          },
        ],
        [
          'expo-notifications',
          {
            icon: './assets/icon.png',
            color: '#001F3F',
            sounds: [],
          },
        ],
        'expo-task-manager',
      ],
      scheme: 'vecta-driver',
      extra: {
        router: { origin: false },
        // After `npx eas init`, set EAS_PROJECT_ID or add eas.projectId here for Expo push + EAS Build.
        ...(process.env.EAS_PROJECT_ID
          ? { eas: { projectId: process.env.EAS_PROJECT_ID } }
          : {}),
      },
    },
    {
      RNMapboxMapsDownloadToken:
        process.env.MAPBOX_SECRET_TOKEN ?? process.env.MAPBOX_DOWNLOADS_TOKEN ?? '',
    },
  );
