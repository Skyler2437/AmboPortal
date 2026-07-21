import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        inline: ['react-test-renderer'],
      },
    },
  },
  resolve: {
    alias: {
      '@expo/vector-icons/MaterialCommunityIcons': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      'react-native-paper': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      'react-native-safe-area-context': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      'expo-router': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/providers/AuthProvider': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/hooks/useEventDetail': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/hooks/useEventViews': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/lib/supabase': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/lib/chat': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/lib/theme': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/components/LoadingScreen': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/components/EventDateTimePicker': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/components/UserListDialog': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      '@/hooks/useThemedStyles': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      'react-native': path.resolve(__dirname, './tests/event-detail-dependencies.mock.ts'),
      'react': path.resolve(__dirname, '../../node_modules/react'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
