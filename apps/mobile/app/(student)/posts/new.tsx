import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Avatar } from 'react-native-paper';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/providers/AuthProvider';
import { usePosts } from '@/hooks/usePosts';
import { supabase } from '@/lib/supabase';
import { PostAttachmentBar } from '@/components/PostAttachmentBar';
import { type PickedAsset } from '@/lib/attachments';
import { getInitials } from '@/lib/format';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';

export default function NewPost() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { createPost } = usePosts();
  const insets = useSafeAreaInsets();
  const { styles, tokens } = useThemedStyles(makeStyles);

  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<PickedAsset[]>([]);
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<{ first_name: string; last_name: string; avatar_url?: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('users')
      .select('first_name, last_name, avatar_url')
      .eq('id', userId)
      .single()
      .then(({ data }) => { if (data) setMe(data as typeof me); });
  }, [userId]);

  const canPost = (content.trim().length > 0 || attachments.length > 0) && !posting;

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      await createPost(userId, content.trim(), attachments);
      router.back();
    } catch (error) {
      Alert.alert('Could not post', error instanceof Error ? error.message : 'Your draft is still here. Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const initials = getInitials(me?.first_name, me?.last_name);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Go back" style={styles.backBtn}>
          <ChevronLeft size={28} color={tokens.accent} />
        </Pressable>
        <Pressable
          onPress={handlePost}
          disabled={!canPost}
          accessibilityLabel="Post"
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>Post</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {me?.avatar_url ? (
          <Avatar.Image size={36} source={{ uri: me.avatar_url }} />
        ) : (
          <Avatar.Text size={36} label={initials} style={styles.avatarFallback} />
        )}
        <TextInput
          editable={!posting}
          placeholder="Share an update…"
          placeholderTextColor={tokens.textMuted}
          value={content}
          onChangeText={setContent}
          multiline
          autoFocus
          style={styles.input}
        />
      </View>

      <PostAttachmentBar disabled={posting} attachments={attachments} onChange={setAttachments} />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.md,
      paddingBottom: space.sm,
      backgroundColor: t.surfaceElevated,
    },
    backBtn: { padding: space.xs },
    postBtn: { backgroundColor: t.accentSolid, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
    postBtnDisabled: { opacity: 0.4 },
    postBtnText: { color: t.onAccent, fontWeight: fontWeight.semibold, fontSize: fontSize.md },
    body: { flex: 1, flexDirection: 'row', gap: space.md, padding: space.lg },
    avatarFallback: { backgroundColor: t.surfaceVariant },
    input: { flex: 1, fontSize: fontSize.lg, color: t.textPrimary, paddingTop: space.sm, textAlignVertical: 'top' },
  });
