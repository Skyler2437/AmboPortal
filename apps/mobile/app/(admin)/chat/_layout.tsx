import { Stack } from 'expo-router';
import { useStackScreenOptions } from '@/lib/navigation';

export default function ChatLayout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: 'Chat' }} />
      <Stack.Screen name="[id]" dangerouslySingular options={{ title: 'Loading...' }} />
      <Stack.Screen name="new" options={{ title: 'New Chat' }} />
      <Stack.Screen name="edit" options={{ title: 'Chat Settings' }} />
    </Stack>
  );
}
