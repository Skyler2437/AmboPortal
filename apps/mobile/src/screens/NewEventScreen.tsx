import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text, IconButton } from 'react-native-paper';
import { useRouter, Stack } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import { DEFAULT_EVENT_UNIFORM } from '@ambo/database';
import Constants from 'expo-constants';
import { EventDateTimePicker } from '@/components/EventDateTimePicker';
import { FormScreen, FormField } from '@/components/ui';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontWeight, type SemanticTokens } from '@/lib/theme';
import type { AppRole } from '@/lib/roles';

/**
 * New-event screen body shared by the admin and student routes. The only
 * role-specific difference is the color token used for the section labels
 * (admin: textPrimary, student: textSecondary).
 */
export function NewEventScreen({ role }: { role: AppRole }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { styles } = useThemedStyles(makeStyles);
  const labelColor = styles[role === 'admin' ? 'dateLabelAdmin' : 'dateLabelStudent'];
  const sectionLabelColor = styles[role === 'admin' ? 'sectionLabelAdmin' : 'sectionLabelStudent'];

  const defaultStart = new Date();
  defaultStart.setHours(0, 0, 0, 0);
  const defaultEnd = new Date();
  defaultEnd.setHours(23, 59, 0, 0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uniform, setUniform] = useState(DEFAULT_EVENT_UNIFORM);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [allDay, setAllDay] = useState(true);
  const [rsvpOptions, setRsvpOptions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required.');
      return;
    }

    setCreating(true);
    const { data: newEvent, error } = await supabase.from('events').insert({
      title: title.trim(),
      description: description.trim() || null,
      uniform: uniform.trim() || null,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      created_by: userId,
    }).select().single();

    if (error) {
      setCreating(false);
      Alert.alert('Error', error.message);
      return;
    }

    // Insert RSVP options if any
    const validOptions = rsvpOptions.filter(o => o.trim());
    let rsvpOptionsError: { message: string } | null = null;
    if (validOptions.length > 0 && newEvent) {
      const { error } = await supabase.from('event_rsvp_options').insert(
        validOptions.map((label, idx) => ({
          event_id: newEvent.id,
          label: label.trim(),
          sort_order: idx,
        }))
      );
      rsvpOptionsError = error;
    }

    // Sync to Google Calendars (admin + all connected users)
    let calendarSyncFailed = false;
    if (newEvent) {
      const webUrl = Constants.expoConfig?.extra?.webUrl || process.env.EXPO_PUBLIC_WEB_URL;
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (webUrl && currentSession?.access_token) {
        try {
          const syncRes = await fetch(`${webUrl}/api/mobile/sync-event`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentSession.access_token}`,
            },
            body: JSON.stringify({ eventId: newEvent.id }),
          });
          if (!syncRes.ok) {
            console.warn('[GCal] Sync failed:', syncRes.status);
            calendarSyncFailed = true;
          }
        } catch (err: unknown) {
          console.warn('[GCal] Sync error:', err instanceof Error ? err.message : err);
          calendarSyncFailed = true;
        }
      } else {
        calendarSyncFailed = true;
      }
    }

    setCreating(false);
    if (rsvpOptionsError || calendarSyncFailed) {
      const followUps = [
        rsvpOptionsError ? 'RSVP options were not saved' : null,
        calendarSyncFailed ? 'calendar sync failed' : null,
      ].filter(Boolean).join(', and ');
      Alert.alert(
        'Event created',
        `The event exists in AmboPortal, but ${followUps}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
      return;
    }

    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Create Event' }} />
      <FormScreen>
        <FormField label="Title *" value={title} onChangeText={setTitle} />
        <FormField
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
        />
        <FormField label="Uniform" value={uniform} onChangeText={setUniform} />

        <Text variant="labelMedium" style={[styles.dateLabel, labelColor]}>Date & Time</Text>
        <EventDateTimePicker
          startDate={startDate}
          endDate={endDate}
          allDay={allDay}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onAllDayChange={setAllDay}
        />

        <Text variant="labelMedium" style={[styles.sectionLabel, sectionLabelColor]}>RSVP Options (optional)</Text>
        <Text variant="bodySmall" style={styles.rsvpHint}>
          Add custom RSVP options. Leave empty for default Going/Maybe/Can't Go.
        </Text>
        {rsvpOptions.map((opt, idx) => (
          <View key={idx} style={styles.rsvpOptionRow}>
            <TextInput
              mode="outlined"
              value={opt}
              onChangeText={(text) => {
                const updated = [...rsvpOptions];
                updated[idx] = text;
                setRsvpOptions(updated);
              }}
              placeholder={`Option ${idx + 1}`}
              dense
              style={styles.rsvpOptionInput}
            />
            <IconButton
              icon="close"
              size={18}
              onPress={() => setRsvpOptions(rsvpOptions.filter((_, i) => i !== idx))}
            />
          </View>
        ))}
        {rsvpOptions.length < 10 && (
          <Button
            mode="text"
            icon="plus"
            onPress={() => setRsvpOptions([...rsvpOptions, ''])}
            compact
            style={styles.addOptionButton}
          >
            Add RSVP Option
          </Button>
        )}

        <Button
          mode="contained"
          onPress={handleCreate}
          loading={creating}
          disabled={!title.trim() || creating}
          style={styles.createButton}
        >
          Create Event
        </Button>
      </FormScreen>
    </>
  );
}

const makeStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    dateLabel: { fontWeight: fontWeight.semibold, marginBottom: space.xs, marginTop: space.xs },
    sectionLabel: { fontWeight: fontWeight.semibold, marginBottom: space.sm, marginTop: space.lg },
    // Role-specific label colors (admin: textPrimary, student: textSecondary)
    dateLabelAdmin: { color: t.textPrimary },
    dateLabelStudent: { color: t.textSecondary },
    sectionLabelAdmin: { color: t.textPrimary },
    sectionLabelStudent: { color: t.textSecondary },
    rsvpHint: { color: t.textMuted, marginBottom: space.sm, marginTop: -space.xs },
    rsvpOptionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xs },
    rsvpOptionInput: { flex: 1, backgroundColor: t.surface },
    addOptionButton: { alignSelf: 'flex-start', marginBottom: space.sm },
    createButton: { borderRadius: radius.sm, marginTop: space.sm },
  });
