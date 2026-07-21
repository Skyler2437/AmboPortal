import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui';
import { ErrorState } from '@/components/ErrorState';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useEventAttendance } from '@/hooks/useEventAttendance';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DEMO_MODE, demoEvents } from '@/lib/demo';
import {
  ATTENDANCE_STATUS_CHOICES,
  attendanceStatusAccessibilityLabel,
  canManageEvent,
  type AttendanceRosterStudent,
  type AttendanceStatus,
} from '@/lib/event-attendance';
import type { AppRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { fontSize, fontWeight, radius, space, type SemanticTokens } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import type { UserRole } from '@ambo/database';

interface AttendanceEvent {
  id: string;
  title: string;
  created_by: string | null;
}

interface StatusChoice {
  label: string;
  value: AttendanceStatus | null;
  foreground: string;
  background: string;
  border: string;
}

function AttendanceStudentRow({
  student,
  choices,
  disabled,
  onChange,
}: {
  student: AttendanceRosterStudent;
  choices: StatusChoice[];
  disabled: boolean;
  onChange: (userId: string, status: AttendanceStatus | null) => void;
}) {
  const { styles, tokens } = useThemedStyles(makeStyles);

  return (
    <View style={styles.studentCard}>
      <View style={styles.studentIdentity}>
        <Avatar
          uri={student.avatarUrl}
          firstName={student.firstName}
          lastName={student.lastName}
          size={40}
        />
        <Text variant="titleSmall" style={styles.studentName}>
          {student.firstName} {student.lastName}
        </Text>
      </View>
      <View style={styles.statusRow} accessibilityRole="radiogroup">
        {choices.map((choice) => {
          const selected = student.attendanceStatus === choice.value;
          return (
            <Pressable
              key={choice.label}
              accessibilityRole="radio"
              accessibilityLabel={attendanceStatusAccessibilityLabel(student, choice.label)}
              accessibilityHint={choice.value === null ? 'Removes the stored attendance mark' : undefined}
              accessibilityState={{ selected }}
              disabled={disabled}
              onPress={() => onChange(student.id, choice.value)}
              style={({ pressed }) => [
                styles.statusButton,
                {
                  backgroundColor: selected ? choice.background : tokens.surface,
                  borderColor: selected ? choice.border : tokens.border,
                  opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                variant="labelSmall"
                numberOfLines={1}
                style={[
                  styles.statusButtonText,
                  { color: selected ? choice.foreground : tokens.textSecondary },
                ]}
              >
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Attendance manager shared by the admin and student-creator route groups. */
export function EventAttendanceScreen({ role }: { role: AppRole }) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, userRole, isLoading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const userId = session?.user.id || '';
  const effectiveRole: UserRole = userRole ?? 'applicant';
  const [event, setEvent] = useState<AttendanceEvent | null>(null);
  const [eventResultId, setEventResultId] = useState<string | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      if (!id || !userId) {
        if (active) {
          setEvent(null);
          setEventResultId(id || null);
          setEventError('Event not found.');
          setEventLoading(false);
        }
        return;
      }

      setEventLoading(true);
      setEventError(null);

      if (DEMO_MODE) {
        const demoEvent = demoEvents.find((candidate) => candidate.id === id);
        if (active) {
          setEvent(demoEvent
            ? { id: demoEvent.id, title: demoEvent.title, created_by: demoEvent.created_by }
            : null);
          setEventResultId(id);
          setEventError(demoEvent ? null : 'Event not found.');
          setEventLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('events')
        .select('id, title, created_by')
        .eq('id', id)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setEvent(null);
        setEventError(error.message);
      } else if (!data) {
        setEvent(null);
        setEventError('Event not found.');
      } else {
        setEvent(data as AttendanceEvent);
      }
      setEventResultId(id);
      setEventLoading(false);
    }

    if (!authLoading) void loadEvent();
    return () => {
      active = false;
    };
  }, [authLoading, id, userId]);

  const eventResultMatchesRoute = Boolean(id && eventResultId === id);
  const eventMatchesRoute = Boolean(eventResultMatchesRoute && event && event.id === id);
  const authorized = Boolean(
    eventMatchesRoute && event && canManageEvent(userId, effectiveRole, event.created_by),
  );
  const attendance = useEventAttendance(authorized ? id : '', { userId, role: effectiveRole });

  const statusChoices = useMemo<StatusChoice[]>(() => ATTENDANCE_STATUS_CHOICES.map((choice) => {
    if (choice.value === 'present') {
      return {
        ...choice,
        foreground: tokens.statusGoodFg,
        background: tokens.statusGoodBg,
        border: tokens.statusGoodBorder,
      };
    }
    if (choice.value === 'absent') {
      return {
        ...choice,
        foreground: tokens.statusBadFg,
        background: tokens.statusBadBg,
        border: tokens.statusBadBorder,
      };
    }
    if (choice.value === 'excused_absent') {
      return {
        ...choice,
        foreground: tokens.statusWarnFg,
        background: tokens.statusWarnBg,
        border: tokens.statusWarnBorder,
      };
    }
    return {
      ...choice,
      foreground: tokens.textSecondary,
      background: tokens.surfaceVariant,
      border: tokens.border,
    };
  }), [tokens]);

  const filteredSections = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return attendance.sections;
    return attendance.sections
      .map((section) => ({
        ...section,
        data: section.data.filter((student) =>
          `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(query)),
      }))
      .filter((section) => section.data.length > 0);
  }, [attendance.sections, search]);

  const handleSave = async () => {
    const saved = await attendance.save();
    if (saved) Alert.alert('Attendance saved', 'All attendance changes were saved.');
  };

  if (authLoading || eventLoading || (Boolean(id) && !eventResultMatchesRoute)) {
    return <LoadingScreen />;
  }
  if (eventError || !event) return <ErrorState message={eventError || 'Event not found.'} />;
  if (!authorized) {
    return <ErrorState message="You don't have permission to manage this event's attendance." />;
  }
  if (attendance.loading && attendance.students.length === 0) return <LoadingScreen />;
  if (attendance.error && attendance.students.length === 0) {
    return <ErrorState message={attendance.error} onRetry={attendance.refetch} />;
  }

  const summaryCards = [
    { label: 'Present', value: attendance.summary.present, foreground: tokens.statusGoodFg, background: tokens.statusGoodBg, border: tokens.statusGoodBorder },
    { label: 'Absent', value: attendance.summary.absent, foreground: tokens.statusBadFg, background: tokens.statusBadBg, border: tokens.statusBadBorder },
    { label: 'Excused Absent', value: attendance.summary.excused_absent, foreground: tokens.statusWarnFg, background: tokens.statusWarnBg, border: tokens.statusWarnBorder },
    { label: 'Unmarked', value: attendance.summary.unmarked, foreground: tokens.textSecondary, background: tokens.surfaceVariant, border: tokens.border },
  ];

  return (
    <View
      style={styles.container}
      accessibilityLabel={role === 'admin' ? 'Admin attendance manager' : 'Student organizer attendance manager'}
    >
      <Stack.Screen options={{ title: 'Attendance' }} />
      <SectionList
        sections={filteredSections}
        keyExtractor={(student) => student.id}
        keyboardShouldPersistTaps="handled"
        refreshing={attendance.loading}
        onRefresh={attendance.refetch}
        stickySectionHeadersEnabled
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + space.xxl * 3 },
        ]}
        ListHeaderComponent={
          <View>
            <Text variant="headlineSmall" style={styles.eventTitle}>{event.title}</Text>
            <Text variant="bodyMedium" style={styles.rosterCount}>
              {attendance.students.length} {attendance.students.length === 1 ? 'student' : 'students'}
            </Text>
            <View style={styles.summaryGrid}>
              {summaryCards.map((card) => (
                <View
                  key={card.label}
                  style={[
                    styles.summaryCard,
                    { backgroundColor: card.background, borderColor: card.border },
                  ]}
                >
                  <Text variant="headlineSmall" style={[styles.summaryValue, { color: card.foreground }]}>
                    {card.value}
                  </Text>
                  <Text variant="labelMedium" style={{ color: card.foreground }}>{card.label}</Text>
                </View>
              ))}
            </View>
            <TextInput
              mode="outlined"
              label="Search students"
              placeholder="First or last name"
              value={search}
              onChangeText={setSearch}
              left={<TextInput.Icon icon="magnify" />}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search attendance roster"
              style={styles.searchInput}
            />
            {attendance.error && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text variant="bodyMedium" style={styles.errorText}>
                  {attendance.error} Your selections are still here. Try saving again.
                </Text>
              </View>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="titleSmall" style={styles.sectionTitle}>{section.title}</Text>
            <Text variant="labelMedium" style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <AttendanceStudentRow
            student={item}
            choices={statusChoices}
            disabled={!attendance.canEdit}
            onChange={attendance.setStatus}
          />
        )}
        ListEmptyComponent={
          <Text variant="bodyMedium" style={styles.emptyText}>
            {search.trim() ? 'No students match your search.' : 'No students are available.'}
          </Text>
        }
      />
      <View style={[styles.saveBar, { paddingBottom: insets.bottom + space.sm }]}>
        <Button
          mode="contained"
          icon="content-save-outline"
          onPress={handleSave}
          disabled={!attendance.dirty || !attendance.canEdit}
          loading={attendance.saving}
          contentStyle={styles.saveButtonContent}
          style={styles.saveButton}
          accessibilityLabel="Save attendance changes"
        >
          Save Attendance
        </Button>
      </View>
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.lg },
  eventTitle: { color: t.textPrimary, fontWeight: fontWeight.bold },
  rosterCount: { color: t.textSecondary, marginTop: space.xs },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.lg,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  summaryValue: { fontWeight: fontWeight.bold },
  searchInput: { marginTop: space.lg, backgroundColor: t.surface },
  errorBanner: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: t.statusBadBorder,
    backgroundColor: t.statusBadBg,
  },
  errorText: { color: t.statusBadFg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.xl,
    paddingBottom: space.sm,
    backgroundColor: t.background,
  },
  sectionTitle: { color: t.textPrimary, fontWeight: fontWeight.semibold },
  sectionCount: { color: t.textSecondary },
  studentCard: {
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    backgroundColor: t.surface,
  },
  studentIdentity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  studentName: { color: t.textPrimary, fontWeight: fontWeight.semibold, flex: 1 },
  statusRow: { flexDirection: 'row', gap: space.xs, marginTop: space.md },
  statusButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.xxs,
  },
  statusButtonText: { fontWeight: fontWeight.semibold, fontSize: fontSize.xxs },
  emptyText: { color: t.textSecondary, textAlign: 'center', paddingVertical: space.xxl },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.surfaceElevated,
  },
  saveButton: { borderRadius: radius.md },
  saveButtonContent: { minHeight: 48 },
});
