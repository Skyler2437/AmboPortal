import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, Avatar } from 'react-native-paper';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/providers/AuthProvider';
import { usePosts } from '@/hooks/usePosts';
import { supabase } from '@/lib/supabase';
import { PostDraftControls } from '@/components/PostDraftControls';
import { communityRequest, validatePostDraft, type PostDraft } from '@/lib/communityPosts';
import { PostAttachmentBar } from '@/components/PostAttachmentBar';
import { type PickedAsset } from '@/lib/attachments';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { getInitials } from '@/lib/format';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';

export default function NewPost() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { createPost } = usePosts();
  const insets = useSafeAreaInsets();
  const { styles, tokens } = useThemedStyles(makeStyles);

  const [draft, setDraft] = useState<PostDraft>({ content: '', publish_at: null, poll: null });
  const content = draft.content;
  const setContent = (content: string) => setDraft(previous => ({ ...previous, content }));
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
      if (draft.poll || draft.publish_at) {
        if (attachments.length) throw new Error('Remove attachments before scheduling or adding a poll.');
        const validation = validatePostDraft(draft);
        if (validation) throw new Error(validation);
        const { data } = await supabase.auth.getSession();
        const result = await communityRequest<{ id: string }>(data.session?.access_token || '', '', 'POST', draft);
        if (!result.id) throw new Error('The server did not confirm your post. Refresh to check before trying again.');
      } else {
        await createPost(userId, content.trim(), attachments);
      }
      router.back();
    } catch (error) {
      Alert.alert('Could not post', error instanceof Error ? error.message : 'Failed to create post. Please try again.');
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
          accessibilityLabel={draft.publish_at ? "Schedule post" : "Post"}
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>{posting ? "Saving…" : draft.publish_at ? "Schedule" : "Post"}</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}>
      <View style={styles.body}>
        {me?.avatar_url ? (
          <Avatar.Image size={36} source={{ uri: me.avatar_url }} />
        ) : (
          <Avatar.Text size={36} label={initials} style={styles.avatarFallback} />
        )}
        <TextInput
          placeholder={draft.poll ? "Ask a poll question…" : "Share an update…"}
          accessibilityLabel={draft.poll ? "Poll question" : "Post text"}
          editable={!posting}
          placeholderTextColor={tokens.textMuted}
          value={content}
          onChangeText={setContent}
          multiline
          autoFocus
          style={styles.input}
        />
      </View>

      <PostDraftControls draft={draft} onChange={setDraft} disabled={posting || attachments.length > 0} />
      <Text style={{ paddingHorizontal: space.lg }}>Scheduled posts and polls support text only. {attachments.length > 0 ? 'Remove attachments to enable these options.' : ''}</Text>
      {!draft.poll && !draft.publish_at && <PostAttachmentBar attachments={attachments} onChange={setAttachments} />}
      </ScrollView>
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
    body: { minHeight: 180, flexDirection: 'row', gap: space.md, padding: space.lg },
    avatarFallback: { backgroundColor: t.surfaceVariant },
    input: { flex: 1, fontSize: fontSize.lg, color: t.textPrimary, paddingTop: space.sm, textAlignVertical: 'top' },
  });
