import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert, Linking, Platform, ActionSheetIOS, Share } from 'react-native';
import { Card, Text, Divider, Switch } from 'react-native-paper';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/useProfile';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { RoleBadge } from '@/components/RoleBadge';
import { LoadingScreen } from '@/components/LoadingScreen';
import { AvatarUpload } from '@/components/AvatarUpload';
import { supabase } from '@/lib/supabase';
import { updateMobileProfile } from '@/lib/mobileProfile';
import Constants from 'expo-constants';
import { hapticSuccess, hapticError, hapticWarning } from '@/lib/haptics';
import { useBiometricLock } from '@/hooks/useBiometricLock';
import { ChangePasswordCard } from '@/components/ChangePasswordCard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getInitials } from '@/lib/format';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, fontWeight, type SemanticTokens } from '@/lib/theme';
import { ProfileFieldsForm } from '@/components/profile/ProfileFieldsForm';
import { PushNotificationsCard } from '@/components/profile/PushNotificationsCard';
import { NotificationPreferencesCard } from '@/components/profile/NotificationPreferencesCard';
import { CalendarSubscribeCard } from '@/components/profile/CalendarSubscribeCard';
import { SupportCard } from '@/components/profile/SupportCard';
import { AccountActions } from '@/components/profile/AccountActions';

export default function StudentProfile() {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { session, signOut } = useAuth();
  const userId = session?.user?.id || '';
  const { user, loading, refetch } = useProfile(userId);
  const { permissionStatus, loading: pushLoading, requestPermission } = usePushNotifications(userId);
  const { prefs, loading: prefsLoading, updatePref } = useNotificationPreferences(userId);
  const { isAvailable: biometricAvailable, isEnabled: biometricEnabled, toggle: toggleBiometric } = useBiometricLock();
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

  // Editable fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const changed =
      firstName !== (user.first_name || '') ||
      lastName !== (user.last_name || '') ||
      email !== (user.email || '') ||
      phone !== (user.phone || '');
    setHasChanges(changed);
  }, [firstName, lastName, email, phone, user]);

  const handleSave = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!firstName.trim()) {
      Alert.alert('Invalid Name', 'First name is required.');
      return;
    }
    if (phone && !/^\d{10}$/.test(phone)) {
      Alert.alert('Invalid Phone', 'Phone number must be exactly 10 digits.');
      return;
    }

    setSaving(true);

    const emailChanged = email.trim().toLowerCase() !== user?.email;

    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) {
      setSaving(false);
      hapticError();
      Alert.alert('Error', 'You must be signed in to update your profile.');
      return;
    }

    try {
      await updateMobileProfile(currentSession.access_token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
      });
    } catch (error: unknown) {
      setSaving(false);
      hapticError();
      Alert.alert(
        'Profile Update Failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
      return;
    }

    // Email changes go through a server-side endpoint that atomically
    // updates both auth.users and public.users using the admin client
    // (bypasses RLS and the broken confirmation-link flow).
    if (emailChanged) {
      const baseUrl = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_BASE_URL;
      if (!baseUrl) {
        setSaving(false);
        hapticError();
        Alert.alert('Error', 'Unable to update email. Please try again.');
        return;
      }
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/mobile/update-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentSession.access_token}`,
          },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSaving(false);
          hapticError();
          Alert.alert('Email Update Failed', data.error || 'Please try again.');
          return;
        }
      } catch (err: any) {
        setSaving(false);
        hapticError();
        Alert.alert('Email Update Failed', err.message || 'Please try again.');
        return;
      }
    }

    setSaving(false);
    hapticSuccess();
    Alert.alert('Success', 'Profile updated.');
    refetch();
  };

  const handleDeleteAccount = useCallback(() => {
    hapticWarning();
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data including submissions, posts, comments, and messages. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const { data: { session: currentSession } } = await supabase.auth.getSession();
              const accessToken = currentSession?.access_token;
              if (!accessToken) {
                Alert.alert('Error', 'You must be signed in to delete your account.');
                setDeleting(false);
                return;
              }

              const baseUrl = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_BASE_URL;
              if (!baseUrl) {
                Alert.alert('Error', 'Server URL is not configured.');
                setDeleting(false);
                return;
              }

              const res = await fetch(`${baseUrl}/api/mobile/delete-account`, {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
              });

              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to delete account');
              }

              // Sign out after successful deletion
              await signOut();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete account. Please try again.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  }, [signOut]);

  const handleSubscribeCalendar = () => {
    const webUrl = process.env.EXPO_PUBLIC_WEB_URL || 'https://ambo-portal.vercel.app';
    const feedUrl = `${webUrl}/api/calendar/feed`;
    const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`;

    const copyLink = async () => {
      await Share.share({ message: feedUrl, title: 'AmboPortal Calendar Feed' });
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Apple Calendar', 'Google Calendar', 'Share Link'],
          cancelButtonIndex: 0,
          title: 'Subscribe to Calendar',
          message: 'Choose your calendar app to subscribe to ambassador events.',
        },
        (buttonIndex) => {
          if (buttonIndex === 1) Linking.openURL(webcalUrl);
          else if (buttonIndex === 2) Linking.openURL(googleUrl);
          else if (buttonIndex === 3) copyLink();
        }
      );
    } else {
      Alert.alert('Subscribe to Calendar', 'Choose your calendar app', [
        { text: 'Google Calendar', onPress: () => Linking.openURL(googleUrl) },
        { text: 'Share Link', onPress: copyLink },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  if (loading) return <LoadingScreen />;

  const initials = user
    ? getInitials(user.first_name, user.last_name)
    : '?';

  const displayAvatar = avatarUrl || user?.avatar_url;
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Avatar & Name */}
      <View style={styles.avatarSection}>
        <AvatarUpload
          userId={userId}
          avatarUrl={displayAvatar}
          initials={initials}
          onUploaded={(url) => { setAvatarUrl(url); refetch(); }}
        />
        <Text variant="headlineSmall" style={styles.name}>
          {user?.first_name} {user?.last_name}
        </Text>
        {user?.role && <RoleBadge role={user.role} />}
      </View>

      <Divider style={styles.divider} />

      {/* Editable Profile Fields */}
      <Text variant="titleSmall" style={styles.sectionLabel}>PROFILE INFORMATION</Text>
      <ProfileFieldsForm
        firstName={firstName}
        onChangeFirstName={setFirstName}
        lastName={lastName}
        onChangeLastName={setLastName}
        email={email}
        onChangeEmail={setEmail}
        phone={phone}
        onChangePhone={setPhone}
        hasChanges={hasChanges}
        saving={saving}
        onSave={handleSave}
      />

      <Divider style={styles.divider} />

      {/* Push Notifications */}
      <Text variant="titleSmall" style={styles.sectionLabel}>NOTIFICATIONS</Text>
      <PushNotificationsCard
        permissionStatus={permissionStatus}
        pushLoading={pushLoading}
        onRequestPermission={requestPermission}
        defaultSubtitle="Enable to receive alerts for messages and events"
        cardStyle={styles.pushCard}
      />

      {/* Notification Preferences */}
      <Text variant="titleSmall" style={styles.prefsLabel}>Notification Types</Text>
      <NotificationPreferencesCard
        prefs={prefs}
        updatePref={updatePref}
        cardStyle={styles.prefsCard}
      />

      <Divider style={styles.divider} />

      {/* Calendar Subscription */}
      <Text variant="titleSmall" style={styles.sectionLabel}>INTEGRATIONS</Text>
      <CalendarSubscribeCard onSubscribe={handleSubscribeCalendar} cardStyle={styles.gcalCard} />

      <Divider style={styles.divider} />

      {/* Appearance */}
      <Text variant="titleSmall" style={styles.sectionLabel}>APPEARANCE</Text>
      <ThemeToggle />

      <Divider style={styles.divider} />

      {/* Security */}
      <Text variant="titleSmall" style={styles.sectionLabel}>SECURITY</Text>
      <ChangePasswordCard />

      {/* Biometric Lock */}
      {biometricAvailable && (
        <Card elevation={0} style={[styles.card, { marginTop: space.md }]}>
          <Card.Content>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ fontWeight: fontWeight.semibold }}>Biometric Lock</Text>
                <Text variant="bodySmall" style={{ color: tokens.textSecondary }}>
                  Require Face ID or fingerprint when returning to the app
                </Text>
              </View>
              <Switch value={biometricEnabled} onValueChange={toggleBiometric} />
            </View>
          </Card.Content>
        </Card>
      )}

      <Divider style={styles.divider} />

      {/* Support & About */}
      <Text variant="titleSmall" style={styles.sectionLabel}>SUPPORT</Text>
      <SupportCard cardStyle={styles.supportCard} />

      <Divider style={styles.divider} />

      {/* Sign Out + Delete Account */}
      <AccountActions onSignOut={signOut} onDeleteAccount={handleDeleteAccount} deleting={deleting} />

      <Text variant="bodySmall" style={styles.versionText}>
        AmboPortal v{appVersion}
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  // eslint-disable-next-line no-restricted-syntax -- intentional
  content: { padding: space.lg, paddingBottom: 48 },
  avatarSection: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  name: { fontWeight: fontWeight.bold },
  divider: { marginVertical: space.lg },
  sectionLabel: {
    color: t.textMuted,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: space.md,
  },
  pushCard: { backgroundColor: t.surface },
  prefsLabel: { fontWeight: fontWeight.semibold, marginBottom: space.sm, marginTop: space.md, color: t.textMuted, letterSpacing: 0.8 },
  prefsCard: { backgroundColor: t.surface },
  gcalCard: { backgroundColor: t.surface },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  card: { backgroundColor: t.surface },
  supportCard: { backgroundColor: t.surface },
  versionText: { color: t.textMuted, textAlign: 'center', marginTop: space.lg },
});
