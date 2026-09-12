import React from 'react';
import { PostPoll } from '@/components/PostPoll';
import { View, StyleSheet, Pressable, Share } from 'react-native';
import { Avatar, Text, IconButton, Icon } from 'react-native-paper';
import type { UserRole } from '@ambo/database';
import { PostAttachments } from '@/components/PostAttachments';
import type { Attachment } from '@/hooks/usePosts';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { getInitials } from '@/lib/format';
import { type SemanticTokens, space, radius, fontSize, fontWeight } from '@/lib/theme';

interface PostCardProps {
  isPoll?: boolean;
  id: string;
  content: string;
  createdAt: string;
  author: {
    first_name: string;
    last_name: string;
    avatar_url?: string;
    role: UserRole;
  };
  commentCount: number;
  likeCount: number;
  viewCount: number;
  attachments?: Attachment[];
  liked: boolean;
  onToggleLike: () => void;
  onPress: () => void;
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

export function PostCard({ id, isPoll, content, createdAt, author, commentCount, likeCount, viewCount, liked, attachments, onToggleLike, onPress }: PostCardProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const initials = getInitials(author.first_name, author.last_name);

  return (
    <Pressable accessible={!isPoll} onPress={onPress} style={styles.card} accessibilityLabel={`Post by ${author.first_name} ${author.last_name}, ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`} accessibilityRole="button">
      <View style={styles.header}>
        {author.avatar_url ? (
          <Avatar.Image size={36} source={{ uri: author.avatar_url }} />
        ) : (
          <Avatar.Text size={36} label={initials} style={styles.avatarFallback} />
        )}
        <View style={styles.authorInfo}>
          <Text variant="bodyMedium" style={styles.authorName}>
            {author.first_name} {author.last_name}
          </Text>
          <Text variant="bodySmall" style={styles.timestamp}>
            {formatTimeAgo(createdAt)}
          </Text>
        </View>
      </View>
      <Text variant="bodyMedium" style={styles.content} numberOfLines={3}>
        {content}
      </Text>
      {isPoll && <PostPoll postId={id} />}
      {attachments && attachments.length > 0 && (
        <PostAttachments attachments={attachments} variant="compact" />
      )}
      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.likeGroup}>
            <IconButton
              icon={liked ? 'heart' : 'heart-outline'}
              size={18}
              iconColor={liked ? tokens.statusBadFg : tokens.textMuted}
              accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
              style={styles.iconBtn}
              onPress={(e) => { e.stopPropagation?.(); onToggleLike(); }}
            />
            {likeCount > 0 && <Text variant="bodySmall" style={styles.likeCountText}>{likeCount}</Text>}
          </View>
          <Text accessibilityRole="button" onPress={onPress} variant="bodySmall" style={styles.commentCount}>
            {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </Text>
        </View>
        <View style={styles.footerRight}>
          <Icon source="eye-outline" size={14} color={tokens.textSecondary} />
          <Text variant="bodySmall" style={styles.metaText}>{viewCount}</Text>
          <IconButton
            icon="share-variant-outline"
            size={18}
            iconColor={tokens.textMuted}
            accessibilityLabel="Share post"
            style={styles.iconBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              Share.share({
                message: `${author.first_name} ${author.last_name}: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`,
              });
            }}
          />
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: t.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatarFallback: { backgroundColor: t.surfaceVariant },
  authorInfo: { gap: space.xxs, flex: 1 },
  authorName: { fontWeight: fontWeight.semibold },
  timestamp: { color: t.textMuted, fontSize: fontSize.xs },
  content: { marginTop: space.md, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The IconButton renders the 18px heart in a 34px touch target (8px of
  // internal padding per side); the negative margin pulls the count back
  // against the glyph so it reads as one unit, separate from the comments.
  likeGroup: { flexDirection: 'row', alignItems: 'center' },
  likeCountText: { color: t.textSecondary, marginLeft: -space.sm },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  iconBtn: { margin: 0 },
  metaText: { color: t.textSecondary },
  commentCount: { color: t.textSecondary, fontWeight: fontWeight.medium },
});
