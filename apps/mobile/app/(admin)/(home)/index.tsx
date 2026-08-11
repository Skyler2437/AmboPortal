import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Card, Text, ActivityIndicator } from 'react-native-paper';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAdminDashboardStats } from '@/hooks/useDashboardStats';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontWeight } from '@/lib/theme';
import type { SemanticTokens } from '@/lib/theme';

export default function AdminDashboard() {
  const router = useRouter();
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { pendingCount, userCount, applicationCount, submissionCount, loaded, refreshing, onRefresh } =
    useAdminDashboardStats();

  if (!loaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.statsGrid}>
        <Pressable style={[styles.statCard, pendingCount > 0 && styles.pendingCard]} onPress={() => router.push('/(admin)/(home)/submissions')}>
          <Card elevation={0} style={styles.cardInner}>
            <Card.Content style={styles.statContent}>
              <MaterialCommunityIcons name="file-clock-outline" size={22} color={pendingCount > 0 ? tokens.statusWarnFg : tokens.textMuted} />
              <Text variant="titleMedium" style={styles.statLabel}>Pending Reviews</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{pendingCount}</Text>
            </Card.Content>
          </Card>
        </Pressable>
        <Pressable style={styles.statCard} onPress={() => router.push('/(admin)/(home)/users')}>
          <Card elevation={0} style={styles.cardInner}>
            <Card.Content style={styles.statContent}>
              <MaterialCommunityIcons name="account-group-outline" size={22} color={tokens.textPrimary} />
              <Text variant="titleMedium" style={styles.statLabel}>Users</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{userCount}</Text>
            </Card.Content>
          </Card>
        </Pressable>
        <Pressable style={[styles.statCard, applicationCount > 0 && styles.applicationCard]} onPress={() => router.push('/(admin)/(home)/applications')}>
          <Card elevation={0} style={styles.cardInner}>
            <Card.Content style={styles.statContent}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={22} color={applicationCount > 0 ? tokens.statusInfoFg : tokens.textMuted} />
              <Text variant="titleMedium" style={styles.statLabel}>Applications</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{applicationCount}</Text>
            </Card.Content>
          </Card>
        </Pressable>
        <Pressable style={styles.statCard} onPress={() => router.push('/(admin)/(home)/submissions')}>
          <Card elevation={0} style={styles.cardInner}>
            <Card.Content style={styles.statContent}>
              <MaterialCommunityIcons name="file-document-outline" size={22} color={tokens.textPrimary} />
              <Text variant="titleMedium" style={styles.statLabel}>Submissions</Text>
              <Text variant="headlineMedium" style={styles.statValue}>{submissionCount}</Text>
            </Card.Content>
          </Card>
        </Pressable>
        <Pressable style={styles.statCard} onPress={() => router.push('/(admin)/(home)/resources')}>
          <Card elevation={0} style={styles.cardInner}>
            <Card.Content style={styles.statContent}>
              <MaterialCommunityIcons name="folder-outline" size={22} color={tokens.statusGoodFg} />
              <Text variant="titleMedium" style={styles.statLabel}>Resources</Text>
              <Text variant="headlineMedium" style={styles.statValue}>&mdash;</Text>
            </Card.Content>
          </Card>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: t.background, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  statsGrid: { gap: space.md },
  statCard: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, overflow: 'hidden' },
  cardInner: { backgroundColor: 'transparent' },
  pendingCard: { backgroundColor: t.statusWarnBg },
  applicationCard: { backgroundColor: t.statusInfoBg },
  statContent: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  statValue: { fontWeight: fontWeight.bold },
  statLabel: { flex: 1, color: t.textPrimary, fontWeight: fontWeight.medium },
});
