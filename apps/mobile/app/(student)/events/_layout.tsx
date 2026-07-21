import { Stack } from 'expo-router';
import { useStackScreenOptions } from '@/lib/navigation';

export default function EventsLayout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: 'Events' }} />
      <Stack.Screen name="new" options={{ title: 'Create Event' }} />
      <Stack.Screen name="[id]" options={{ title: 'Event Details' }} />
      <Stack.Screen name="attendance/[id]" options={{ title: 'Attendance' }} />
    </Stack>
  );
}
