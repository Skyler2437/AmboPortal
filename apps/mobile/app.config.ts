import { ExpoConfig, ConfigContext } from 'expo/config';

// In a monorepo, expo-notifications is hoisted to the root node_modules
// but Expo resolves plugins relative to apps/mobile where it doesn't exist.
// We try to resolve it, and gracefully skip if unavailable (e.g. during eas init).
function tryResolvePlugin(
  packageName: string,
  options: Record<string, unknown>
): [string, Record<string, unknown>] | null {
  try {
    const resolved = require.resolve(`${packageName}/app.plugin.js`);
    return [resolved, options];
  } catch {
    // Not resolvable from this context — skip the plugin
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const notificationsPlugin = tryResolvePlugin('expo-notifications', {
    icon: './assets/icon.png',
    color: '#111827',
  });

  const sentryPlugin: [string, Record<string, unknown>] = [
    '@sentry/react-native/expo',
    {
      organization: process.env.SENTRY_ORG || '127makes',
      project: process.env.SENTRY_PROJECT || 'amboportal-mobile',
    },
  ];

  return {
    ...config,
    name: config.name!,
    slug: config.slug!,
    plugins: [
      ...(config.plugins || []),
      ...(notificationsPlugin ? [notificationsPlugin] : []),
      sentryPlugin,
      '@react-native-community/datetimepicker',
    ],
    extra: {
      ...config.extra,
      webUrl: process.env.EXPO_PUBLIC_WEB_URL,
    },
  };
};
