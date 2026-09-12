import { Stack } from 'expo-router';
import { useStackScreenOptions } from '@/lib/navigation';

export default function PostsLayout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: 'Posts' }} />
      <Stack.Screen name="[id]" options={{ title: 'Post' }} />
      <Stack.Screen name="scheduled" options={{ title: 'Scheduled posts' }} />
      <Stack.Screen name="new" options={{ title: 'New Post' }} />
    </Stack>
  );
}
