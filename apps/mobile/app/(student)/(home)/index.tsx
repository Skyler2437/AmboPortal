import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Card, Text, Button, Divider } from 'react-native-paper';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAuth } from '@/providers/AuthProvider';
import { useSubmissions } from '@/hooks/useSubmissions';
import { useStudentDashboardStats } from '@/hooks/useDashboardStats';
import { DashboardSkeleton } from '@/components/SkeletonLoader';
import { hapticMedium } from '@/lib/haptics';
import { ErrorState } from '@/components/ErrorState';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';

export default function StudentDashboard() {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { submissions, loading, error, refetch } = useSubmissions(userId);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);
  const router = useRouter();
  const { upcomingEvents, resourceCount, refresh: refreshDash } = useStudentDashboardStats();

  if (!loading && !initialLoadDone.current) {
    initialLoadDone.current = true;
  }

  // Silent refetch when screen regains focus (e.g. after submitting activity)
  useFocusEffect(useCallback(() => {
    if (initialLoadDone.current) {
      refetch();
      refreshDash();
    }
  }, [refetch, refreshDash]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refreshDash()]);
    hapticMedium();
    setRefreshing(false);
  }, [refetch, refreshDash]);

  const stats = useMemo(() => {
    const approved = submissions.filter((s) => s.status === 'Approved');
    const totalHours = approved.reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
    const totalCredits = approved.reduce((sum, s) => sum + (Number(s.credits) || 0), 0);
    return { totalHours, totalCredits, totalSubmissions: submissions.length };
  }, [submissions]);

  if (loading && submissions.length === 0 && !initialLoadDone.current) return <DashboardSkeleton />;
  if (error && submissions.length === 0) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.header}>
          {/* Stats */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <MaterialCommunityIcons name="clock-outline" size={22} color={tokens.accent} />
              <Text variant="titleMedium" style={styles.statLabel}>Approved Hours</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{stats.totalHours.toFixed(1)}</Text>
            </View>
            <View style={styles.statCard}>
              <MaterialCommunityIcons name="medal-outline" size={22} color={tokens.accent} />
              <Text variant="titleMedium" style={styles.statLabel}>Credits</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{stats.totalCredits.toFixed(1)}</Text>
            </View>
            <Pressable style={styles.statCard} onPress={() => router.push('/(student)/(home)/submissions')}>
              <MaterialCommunityIcons name="file-document-outline" size={22} color={tokens.textPrimary} />
              <Text variant="titleMedium" style={styles.statLabel}>Submissions</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{stats.totalSubmissions}</Text>
            </Pressable>
            <Pressable style={styles.statCard} onPress={() => router.push('/(student)/(home)/resources')}>
              <MaterialCommunityIcons name="folder-outline" size={22} color={tokens.statusGoodFg} />
              <Text variant="titleMedium" style={styles.statLabel}>Resources</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{resourceCount}</Text>
            </Pressable>
          </View>

          {/* Quick Action */}
          <Button
            mode="contained"
            icon="plus-circle-outline"
            onPress={() => router.push('/(student)/(home)/new-submission')}
            style={styles.actionButton}
          >
            Log New Activity
          </Button>

          {/* Upcoming Events */}
          {upcomingEvents.length > 0 && (
            <>
              <Divider style={styles.divider} />
              <View style={styles.sectionHeader}>
                <Text variant="titleMedium" style={styles.sectionTitle}>Upcoming Events</Text>
                <Pressable onPress={() => router.push('/(student)/events')}>
                  <Text variant="bodySmall" style={styles.seeAllText}>See All</Text>
                </Pressable>
              </View>
              {upcomingEvents.map((event) => {
                const d = new Date(event.start_time);
                return (
                  <Pressable
                    key={event.id}
                    onPress={() => router.push({ pathname: '/(student)/events/[id]', params: { id: event.id } })}
                  >
                    <Card elevation={0} style={styles.eventCard}>
                      <Card.Content style={styles.eventContent}>
                        <View style={styles.eventDate}>
                          <Text variant="labelLarge" style={styles.eventMonth}>
                            {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                          </Text>
                          <Text variant="headlineSmall" style={styles.eventDay}>
                            {d.getDate()}
                          </Text>
                        </View>
                        <View style={styles.eventInfo}>
                          <Text variant="bodyMedium" style={styles.eventTitle} numberOfLines={1}>
                            {event.title}
                          </Text>
                          <View style={styles.eventMeta}>
                            <MaterialCommunityIcons name="clock-outline" size={14} color={tokens.textSecondary} />
                            <Text variant="bodySmall" style={styles.eventMetaText}>
                              {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </Text>
                          </View>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.textMuted} />
                      </Card.Content>
                    </Card>
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.lg, marginBottom: space.sm },
  statsGrid: { gap: space.md },
  statCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingVertical: space.lg, paddingHorizontal: space.lg, overflow: 'hidden' },
  statValue: { fontWeight: fontWeight.bold },
  statLabel: { flex: 1, color: t.textPrimary, fontWeight: fontWeight.medium },
  actionButton: { borderRadius: radius.md },
  divider: { marginVertical: space.xs },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontWeight: fontWeight.semibold },
  seeAllText: { color: t.accent, fontWeight: fontWeight.medium },
  eventCard: { marginBottom: space.sm, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  eventContent: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  eventDate: { alignItems: 'center', width: 44 },
  eventMonth: { color: t.statusBadFg, fontSize: fontSize.xxs, fontWeight: fontWeight.bold },
  eventDay: { fontWeight: fontWeight.bold, color: t.textPrimary, lineHeight: 28 },
  eventInfo: { flex: 1 },
  eventTitle: { fontWeight: fontWeight.semibold, marginBottom: space.xs },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  eventMetaText: { color: t.textSecondary },
});
