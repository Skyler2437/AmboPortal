import React, { useState, useRef } from 'react';
import {
  AccessibilityInfo,
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Divider,
  Avatar,
  Icon,
} from 'react-native-paper';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/providers/AuthProvider';
import { usePosts } from '@/hooks/usePosts';
import { useComments } from '@/hooks/useComments';
import { RoleBadge } from '@/components/RoleBadge';
import { LoadingScreen } from '@/components/LoadingScreen';
import { PostAttachments } from '@/components/PostAttachments';
import { UserListDialog, DialogUser } from '@/components/UserListDialog';
import { ComposerInput } from '@/components/ComposerInput';
import { LinkifiedText } from '@/components/LinkifiedText';
import { supabase } from '@/lib/supabase';
import { getInitials } from '@/lib/format';
import { sendDraft } from '@/lib/composer-state';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';
import type { UserRole } from '@ambo/database';
import type { AppRole } from '@/lib/roles';

function canModify(
  targetUserId: string,
  targetRole: UserRole,
  currentUserId: string,
  currentUserRole: UserRole
): boolean {
  if (currentUserId === targetUserId) return true;
  if (currentUserRole === 'superadmin') return true;
  if (currentUserRole === 'admin' && (targetRole === 'student' || targetRole === 'basic'))
    return true;
  return false;
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Post detail screen shared by the admin and student routes. Role only
 * determines the fallback used while the live `userRole` is still loading.
 */
export function PostDetailScreen({ role }: { role: AppRole }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { session, userRole } = useAuth();
  const userId = session?.user?.id || '';
  const currentRole = userRole || role;
  const insets = useSafeAreaInsets();

  const { posts, loading: postsLoading, editPost, deletePost, toggleLike } = usePosts();
  const {
    comments,
    loading: commentsLoading,
    createComment,
    editComment,
    deleteComment,
  } = useComments(id);

  const post = posts.find((p) => p.id === id);

  // Post edit state
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  // Comment input state
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const commentInputRef = useRef<RNTextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const commentComposerFocusedRef = useRef(false);
  const commentTextRef = useRef('');
  const commentPostInFlightRef = useRef(false);

  // Comment edit state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');

  const [likesOpen, setLikesOpen] = useState(false);
  const [likers, setLikers] = useState<DialogUser[] | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewers, setViewers] = useState<DialogUser[] | null>(null);

  const openLikers = async () => {
    setLikesOpen(true);
    setLikers(null);
    const { data } = await supabase
      .from('post_likes')
      .select('users(id, first_name, last_name, avatar_url)')
      .eq('post_id', id)
      .order('created_at', { ascending: false });
    setLikers(((data as any[]) || []).map((r) => r.users).filter(Boolean));
  };

  const openViewers = async () => {
    setViewsOpen(true);
    setViewers(null);
    const { data } = await supabase
      .from('post_views')
      .select('users(id, first_name, last_name, avatar_url)')
      .eq('post_id', id)
      .order('viewed_at', { ascending: false });
    setViewers(((data as any[]) || []).map((r) => r.users).filter(Boolean));
  };

  if (postsLoading && !post) return <LoadingScreen />;

  if (!post) {
    return (
      <>
        <Stack.Screen options={{ title: 'Post' }} />
        <View style={styles.centered}>
          <Text variant="bodyLarge" style={styles.notFoundText}>
            Post not found
          </Text>
          <Button mode="outlined" onPress={() => router.back()}>
            Go Back
          </Button>
        </View>
      </>
    );
  }

  const showActions = canModify(post.user_id, post.users.role, userId, currentRole);
  const initials = getInitials(post.users.first_name, post.users.last_name);

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await editPost(post.id, editText.trim());
      setEditing(false);
    } catch {
      Alert.alert('Error', 'Failed to edit post');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePost(post.id);
            router.back();
          } catch {
            Alert.alert('Error', 'Failed to delete post');
          }
        },
      },
    ]);
  };

  const handlePostComment = async () => {
    if (commentPostInFlightRef.current) return;
    const submittedDraft = commentTextRef.current;
    if (!submittedDraft.trim()) return;

    commentPostInFlightRef.current = true;
    setPosting(true);
    const result = await sendDraft(submittedDraft, (message) => createComment(userId, message));
    if (commentTextRef.current === submittedDraft) {
      commentTextRef.current = result.draft;
      setCommentText(result.draft);
    }
    commentPostInFlightRef.current = false;
    setPosting(false);

    if (result.sent) {
      commentInputRef.current?.focus();
    } else if (result.error) {
      Alert.alert('Error', 'Failed to post comment');
      AccessibilityInfo.announceForAccessibility('Failed to post comment.');
    }
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    if (!editCommentText.trim()) return;
    setSaving(true);
    try {
      await editComment(commentId, editCommentText.trim());
      setEditingCommentId(null);
    } catch {
      Alert.alert('Error', 'Failed to edit comment');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteComment = (commentId: string) => {
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(commentId);
          } catch {
            Alert.alert('Error', 'Failed to delete comment');
          }
        },
      },
    ]);
  };

  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 44 : 0;

  const scrollToNewestComment = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Post' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardOffset}
      >
        <ScrollView
          ref={scrollViewRef}
          testID="post-content-scroll"
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => {
            if (commentComposerFocusedRef.current) scrollToNewestComment();
          }}
        >
          {/* Author header */}
          <View style={styles.header}>
            {post.users.avatar_url ? (
              <Avatar.Image size={44} source={{ uri: post.users.avatar_url }} />
            ) : (
              <Avatar.Text size={44} label={initials} style={styles.avatarFallback} />
            )}
            <View style={styles.authorInfo}>
              <Text variant="titleMedium" style={styles.authorName}>
                {post.users.first_name} {post.users.last_name}
              </Text>
              <View style={styles.metaRow}>
                <RoleBadge role={post.users.role} />
                <Text variant="bodySmall" style={styles.timestamp}>
                  {formatTimeAgo(post.created_at)}
                </Text>
              </View>
            </View>
          </View>

          {/* Admin actions */}
          {showActions && (
            <View style={styles.adminActions}>
              <IconButton
                icon={editing ? 'close' : 'pencil'}
                mode="outlined"
                size={20}
                accessibilityLabel={editing ? 'Cancel editing post' : 'Edit post'}
                onPress={() => {
                  setEditing(!editing);
                  setEditText(post.content);
                }}
              />
              <IconButton
                icon="delete"
                mode="outlined"
                size={20}
                iconColor={tokens.statusBadFg}
                accessibilityLabel="Delete post"
                onPress={handleDelete}
              />
            </View>
          )}

          {/* Post content or edit form */}
          {editing ? (
            <View style={styles.editSection}>
              <TextInput
                mode="outlined"
                value={editText}
                onChangeText={setEditText}
                multiline
                dense
                style={styles.editInput}
              />
              <View style={styles.editActions}>
                <Button mode="text" onPress={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  onPress={handleSaveEdit}
                  loading={saving}
                  disabled={!editText.trim()}
                >
                  Save
                </Button>
              </View>
            </View>
          ) : (
            <>
              <LinkifiedText variant="bodyMedium" style={styles.content}>
                {post.content}
              </LinkifiedText>
              <PostAttachments attachments={post.attachments} variant="full" />
            </>
          )}

          <View style={styles.engagementRow}>
            <IconButton
              icon={post.liked ? 'heart' : 'heart-outline'}
              size={20}
              iconColor={post.liked ? tokens.statusBadFg : tokens.textSecondary}
              onPress={() => toggleLike(post.id).catch(() => {})}
              accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}
              style={{ margin: 0 }}
            />
            <Text variant="bodySmall" onPress={openLikers} style={[styles.engagementText, styles.likeCountTight]}>
              {post.like_count} {post.like_count === 1 ? 'like' : 'likes'}
            </Text>
            <Pressable onPress={openViewers} style={styles.engagementViews}>
              <Icon source="eye-outline" size={16} color={tokens.textSecondary} />
              <Text variant="bodySmall" style={styles.engagementText}>{post.view_count} seen</Text>
            </Pressable>
          </View>

          {/* Comments section */}
          <Divider style={styles.divider} />
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Comments ({comments.length})
          </Text>

          {commentsLoading ? (
            <Text variant="bodySmall" style={styles.loadingText}>
              Loading comments...
            </Text>
          ) : comments.length === 0 ? (
            <Text variant="bodySmall" style={styles.noComments}>
              No comments yet. Be the first to comment!
            </Text>
          ) : (
            comments.map((comment) => {
              const commentInitials = getInitials(comment.users.first_name, comment.users.last_name);
              const canActOnComment = canModify(
                comment.user_id,
                comment.users.role,
                userId,
                currentRole
              );
              const isEditingThis = editingCommentId === comment.id;

              return (
                <View key={comment.id} style={styles.commentRow}>
                  {comment.users.avatar_url ? (
                    <Avatar.Image
                      size={32}
                      source={{ uri: comment.users.avatar_url }}
                    />
                  ) : (
                    <Avatar.Text
                      size={32}
                      label={commentInitials}
                      style={styles.commentAvatar}
                      labelStyle={{ fontSize: fontSize.xs }}
                    />
                  )}
                  <View style={styles.commentBody}>
                    <View style={styles.commentHeader}>
                      <Text variant="labelMedium" style={styles.commentAuthor}>
                        {comment.users.first_name} {comment.users.last_name}
                      </Text>
                      <Text variant="bodySmall" style={styles.timestamp}>
                        {formatTimeAgo(comment.created_at)}
                      </Text>
                    </View>
                    {isEditingThis ? (
                      <View style={styles.editSection}>
                        <TextInput
                          mode="outlined"
                          value={editCommentText}
                          onChangeText={setEditCommentText}
                          dense
                          multiline
                        />
                        <View style={styles.editActions}>
                          <Button
                            mode="text"
                            onPress={() => setEditingCommentId(null)}
                            compact
                          >
                            Cancel
                          </Button>
                          <Button
                            mode="contained"
                            onPress={() => handleSaveCommentEdit(comment.id)}
                            loading={saving}
                            compact
                            disabled={!editCommentText.trim()}
                          >
                            Save
                          </Button>
                        </View>
                      </View>
                    ) : (
                      <LinkifiedText variant="bodyMedium" style={{ fontSize: fontSize.md }}>{comment.content}</LinkifiedText>
                    )}
                  </View>
                  {canActOnComment && !isEditingThis && (
                    <View style={styles.commentActions}>
                      <IconButton
                        icon="pencil-outline"
                        size={14}
                        onPress={() => {
                          setEditingCommentId(comment.id);
                          setEditCommentText(comment.content);
                        }}
                      />
                      <IconButton
                        icon="delete-outline"
                        size={14}
                        iconColor={tokens.statusBadFg}
                        onPress={() => handleDeleteComment(comment.id)}
                      />
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        <ComposerInput
          ref={commentInputRef}
          value={commentText}
          onChangeText={(value) => {
            commentTextRef.current = value;
            setCommentText(value);
          }}
          onSend={handlePostComment}
          placeholder="Add a comment..."
          sending={posting}
          accessibilityLabel="Comment"
          sendAccessibilityLabel="Post comment"
          onFocus={() => {
            commentComposerFocusedRef.current = true;
            scrollToNewestComment();
          }}
          onBlur={() => {
            commentComposerFocusedRef.current = false;
          }}
        />
      </KeyboardAvoidingView>
      <UserListDialog visible={likesOpen} title={`Liked by ${post.like_count}`} users={likers} onDismiss={() => setLikesOpen(false)} />
      <UserListDialog visible={viewsOpen} title={`Seen by ${post.view_count}`} users={viewers} onDismiss={() => setViewsOpen(false)} />
    </>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
  scrollContent: { padding: space.lg, paddingBottom: space.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.lg },
  notFoundText: { color: t.textSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  avatarFallback: { backgroundColor: t.surfaceVariant },
  authorInfo: { gap: space.xxs, flex: 1 },
  authorName: { fontWeight: fontWeight.bold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  timestamp: { color: t.textMuted, fontSize: fontSize.xs },
  adminActions: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  content: { lineHeight: 24, color: t.textPrimary },
  editSection: { gap: space.sm },
  editInput: { backgroundColor: t.surface },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  divider: { marginVertical: space.xl },
  sectionTitle: { fontWeight: fontWeight.semibold, marginBottom: space.md },
  loadingText: { color: t.textMuted, paddingVertical: space.sm },
  noComments: { color: t.textMuted, paddingVertical: space.sm },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginBottom: space.md,
  },
  commentAvatar: { backgroundColor: t.surfaceVariant },
  commentBody: { flex: 1 },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xxs,
  },
  commentAuthor: { fontWeight: fontWeight.semibold },
  commentActions: { flexDirection: 'row' },
  engagementRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  engagementText: { color: t.textSecondary },
  // Cancels part of the IconButton's internal padding so the count hugs the heart
  likeCountTight: { marginLeft: -space.xs },
  engagementViews: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: space.lg },
});
