import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert, Linking, Platform, ActionSheetIOS, Share } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/useProfile';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { RoleBadge } from '@/components/RoleBadge';
import { LoadingScreen } from '@/components/LoadingScreen';
import { AvatarUpload } from '@/components/AvatarUpload';
import { supabase } from '@/lib/supabase';
import { updateMobileProfile } from '@/lib/mobileProfile';
import Constants from 'expo-constants';
import { ChangePasswordCard } from '@/components/ChangePasswordCard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { getInitials } from '@/lib/format';
import { space, fontWeight, type SemanticTokens } from '@/lib/theme';
import { ProfileFieldsForm } from '@/components/profile/ProfileFieldsForm';
import { PushNotificationsCard } from '@/components/profile/PushNotificationsCard';
import { NotificationPreferencesCard } from '@/components/profile/NotificationPreferencesCard';
import { CalendarSubscribeCard } from '@/components/profile/CalendarSubscribeCard';
import { SupportCard } from '@/components/profile/SupportCard';
import { AccountActions } from '@/components/profile/AccountActions';

export default function AdminProfile() {
  const { styles } = useThemedStyles(makeStyles);
  const { session, signOut } = useAuth();
  const userId = session?.user?.id || '';
  const { user, loading, refetch } = useProfile(userId);
  const { prefs, loading: prefsLoading, updatePref } = useNotificationPreferences(userId);
  const { permissionStatus, loading: pushLoading, requestPermission } = usePushNotifications(userId);
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

  // Track changes
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
          Alert.alert('Email Update Failed', data.error || 'Please try again.');
          return;
        }
      } catch (err: any) {
        setSaving(false);
        Alert.alert('Email Update Failed', err.message || 'Please try again.');
        return;
      }
    }

    setSaving(false);
    Alert.alert('Success', 'Profile updated.');
    refetch();
  };

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

  const handleDeleteAccount = useCallback(() => {
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

  if (loading) return <LoadingScreen />;

  const initials = user
    ? getInitials(user.first_name, user.last_name)
    : '?';

  const displayAvatar = avatarUrl || user?.avatar_url;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Avatar & Role */}
      <View style={styles.avatarSection}>
        <AvatarUpload
          userId={userId}
          avatarUrl={displayAvatar}
          initials={initials}
          onUploaded={(url) => { setAvatarUrl(url); refetch(); }}
        />
        {user?.role && <RoleBadge role={user.role} />}
      </View>

      <Divider style={styles.divider} />

      {/* Editable Profile Fields */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Profile Information</Text>
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

      {/* Notification Permission */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Notifications</Text>
      <PushNotificationsCard
        permissionStatus={permissionStatus}
        pushLoading={pushLoading}
        onRequestPermission={requestPermission}
        defaultSubtitle="Enable to receive alerts for messages, posts, and events"
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
      <Text variant="titleMedium" style={styles.sectionTitle}>Integrations</Text>
      <CalendarSubscribeCard onSubscribe={handleSubscribeCalendar} cardStyle={styles.gcalCard} />

      <Divider style={styles.divider} />

      {/* Appearance */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Appearance</Text>
      <ThemeToggle cardStyle={styles.appearanceCard} />

      <Divider style={styles.divider} />

      {/* Change Password */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Security</Text>
      <ChangePasswordCard />

      <Divider style={styles.divider} />

      {/* Support */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Support</Text>
      <SupportCard cardStyle={styles.supportCard} />

      <Divider style={styles.divider} />

      {/* Sign Out + Delete Account */}
      <AccountActions onSignOut={signOut} onDeleteAccount={handleDeleteAccount} deleting={deleting} />

      <Text variant="bodySmall" style={styles.versionText}>
        AmboPortal v{Constants.expoConfig?.version || '1.0.0'}
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  content: { padding: space.lg, paddingBottom: space.xxl },
  avatarSection: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  divider: { marginVertical: space.lg },
  sectionTitle: { fontWeight: fontWeight.semibold, marginBottom: space.md },
  pushCard: { backgroundColor: t.surfaceVariant, marginBottom: space.md },
  prefsLabel: { fontWeight: fontWeight.semibold, marginBottom: space.sm, color: t.textSecondary },
  prefsCard: { backgroundColor: t.surfaceVariant },
  gcalCard: { backgroundColor: t.surfaceVariant },
  appearanceCard: { backgroundColor: t.surfaceVariant },
  supportCard: { backgroundColor: t.surfaceVariant },
  versionText: { color: t.textMuted, textAlign: 'center', marginTop: space.lg },
});
