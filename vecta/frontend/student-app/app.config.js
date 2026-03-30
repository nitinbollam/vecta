/* eslint-disable @typescript-eslint/no-require-imports */
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    plugins: [
      ...(appJson.expo.plugins || []),
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken:
            process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_DOWNLOADS_TOKEN || 'your_mapbox_secret_token',
        },
      ],
    ],
  },
};
