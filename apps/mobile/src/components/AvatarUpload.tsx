import React, { useState } from 'react';
import { Pressable, StyleSheet, Alert } from 'react-native';
import { Avatar, ActivityIndicator } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { updateMobileProfile } from '@/lib/mobileProfile';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { SemanticTokens } from '@/lib/theme';

interface AvatarUploadProps {
  userId: string;
  avatarUrl?: string;
  initials: string;
  size?: number;
  onUploaded: (newUrl: string) => void;
}

export function AvatarUpload({ userId, avatarUrl, initials, size = 80, onUploaded }: AvatarUploadProps) {
  const { styles } = useThemedStyles(makeStyles);
  const [uploading, setUploading] = useState(false);

  const handlePress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant photo library access to upload an avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const fileName = `${userId}.jpg`;

      // Read the picked image's real bytes. In React Native, fetch(uri).blob()
      // yields an empty/opaque blob that supabase-js uploads as a 0-byte file,
      // which then renders as a blank (blue) avatar.
      const bytes = await new File(asset.uri).bytes();

      // Upload to avatars bucket
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(fileName, bytes, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;

      // Get public URL
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('You must be signed in to update your profile photo');
      }

      const profile = await updateMobileProfile(session.access_token, {
        avatarUrl: publicUrl,
      });

      onUploaded(profile.avatar_url || publicUrl);
    } catch (error: unknown) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to upload avatar',
      );
    } finally {
      setUploading(false);
    }
  };

  if (uploading) {
    return (
      <Pressable style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
        <ActivityIndicator size="small" />
      </Pressable>
    );
  }

  return (
    <Pressable onPress={handlePress} accessibilityLabel="Change profile photo" accessibilityRole="button">
      {avatarUrl ? (
        <Avatar.Image size={size} source={{ uri: avatarUrl }} />
      ) : (
        <Avatar.Text size={size} label={initials} style={styles.fallback} />
      )}
    </Pressable>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: {
    backgroundColor: t.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    backgroundColor: t.surfaceVariant,
  },
});
