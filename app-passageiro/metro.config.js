const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_SHIMS = {
  '@rnmapbox/maps': path.resolve(__dirname, 'src/web-shims/rnmapbox-maps.web.tsx'),
  '@sentry/react-native': path.resolve(__dirname, 'src/web-shims/sentry-react-native.web.tsx'),
  'expo-secure-store': path.resolve(__dirname, 'src/web-shims/expo-secure-store.web.tsx'),
  'expo-notifications': path.resolve(__dirname, 'src/web-shims/expo-notifications.web.tsx'),
  'expo-keep-awake': path.resolve(__dirname, 'src/web-shims/expo-native-shims.web.tsx'),
  'expo-speech': path.resolve(__dirname, 'src/web-shims/expo-native-shims.web.tsx'),
  'expo-haptics': path.resolve(__dirname, 'src/web-shims/expo-native-shims.web.tsx'),
  'expo-file-system': path.resolve(__dirname, 'src/web-shims/expo-native-shims.web.tsx'),
  'expo-file-system/legacy': path.resolve(__dirname, 'src/web-shims/expo-native-shims.web.tsx'),
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return {
      filePath: WEB_SHIMS[moduleName],
      type: 'sourceFile',
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
