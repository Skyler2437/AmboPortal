import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Alert } from 'react-native';
import { Portal, Snackbar, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { Star } from 'lucide-react-native';
import { useChatGroups, ChatGroupWithMeta } from '@/hooks/useChatGroups';
import { SwipeableChatRow } from '@/components/SwipeableChatRow';
import { ChatGroupAvatar } from '@/components/ChatGroupAvatar';
import { ChatListSkeleton } from '@/components/SkeletonLoader';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Fab } from '@/components/ui';
import { useListScreen } from '@/hooks/useListScreen';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatChatListDate } from '@/lib/format';
import {
  dismissActiveChatFeedback,
  enqueueChatFeedback,
  getChatPreview,
  getGroupDisplayName,
  type ChatListFeedback,
} from '@/lib/chat-list-state';
import { space, radius, fontWeight, type SemanticTokens } from '@/lib/theme';
import type { AppRole } from '@/lib/roles';

/** Chat list shared by the admin and student routes. */
export function ChatListScreen({ role }: { role: AppRole }) {
  const router = useRouter();
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { groups, loading, error, refetch, toggleStar, deleteChat, restoreChat } = useChatGroups(userId);
  const { isInitialLoading, listError, refreshControl } = useListScreen({ data: groups, loading, error, refetch });
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [feedbackQueue, setFeedbackQueue] = useState<ChatListFeedback<ChatGroupWithMeta>[]>([]);
  const feedbackIdRef = useRef(0);
  const activeFeedback = feedbackQueue[0];

  useEffect(() => {
    setOpenRowId(null);
    setFeedbackQueue([]);
  }, [userId]);

  const nextFeedbackId = () => {
    feedbackIdRef.current += 1;
    return `chat-feedback-${feedbackIdRef.current}`;
  };

  const enqueueError = (message: string) => {
    const id = nextFeedbackId();
    setFeedbackQueue((current) => enqueueChatFeedback(current, {
      id,
      kind: 'error',
      message,
    }));
  };

  const closeRow = (rowId: string) => {
    setOpenRowId((current) => current === rowId ? null : current);
  };

  const handleToggleStar = async (groupId: string, starred: boolean) => {
    const updated = await toggleStar(groupId, starred);
    if (!updated) enqueueError("Couldn't update that chat. Try again.");
  };

  const confirmDelete = (groupId: string, name: string) => {
    Alert.alert(
      'Delete chat',
      `Remove "${name}" from your chats? It will come back if there's a new message.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteChat(groupId).then((result) => {
              if (result.status === 'superseded') return;
              if (result.status === 'failed') {
                enqueueError("Couldn't remove the chat. Try again.");
                return;
              }
              const feedbackId = nextFeedbackId();
              setFeedbackQueue((current) => enqueueChatFeedback(current, {
                id: feedbackId,
                kind: 'delete',
                message: `${name} was removed.`,
                chatName: name,
                snapshot: result.snapshot,
              }));
            });
          },
        },
      ],
    );
  };

  const undoDelete = () => {
    if (activeFeedback?.kind !== 'delete') return;
    const { chatName, snapshot } = activeFeedback;
    void restoreChat(snapshot).then((restored) => {
      if (!restored) enqueueError(`Couldn't restore ${chatName}. Try again.`);
    });
  };

  const dismissFeedback = () => {
    setFeedbackQueue(dismissActiveChatFeedback);
  };

  if (isInitialLoading) return <ChatListSkeleton />;
  if (listError) return <ErrorState message={listError} onRetry={refetch} />;

  const renderGroup = ({ item }: { item: ChatGroupWithMeta }) => {
    const displayName = getGroupDisplayName(item, userId);
    const hasUnread = item.hasUnread === true;
    const preview = getChatPreview(item, userId);
    const relativeTime = item.lastMessage ? formatChatListDate(item.lastMessage.created_at) : null;
    const rowAccessibilityLabel = [
      `Chat with ${displayName}`,
      item.starred ? 'starred' : null,
      hasUnread ? 'unread messages' : null,
      `Last message: ${preview}`,
      relativeTime ? `Last activity ${relativeTime}` : null,
      `Actions available: ${item.starred ? 'unstar' : 'star'} and delete`,
    ].filter(Boolean).join(', ');

    return (
      <SwipeableChatRow
        rowId={item.id}
        openRowId={openRowId}
        starred={!!item.starred}
        accessibilityLabel={rowAccessibilityLabel}
        onOpen={setOpenRowId}
        onClose={closeRow}
        onPress={() => router.push(`/(${role})/chat/${item.id}` as Parameters<typeof router.push>[0])}
        onToggleStar={() => { void handleToggleStar(item.id, !item.starred); }}
        onDelete={() => confirmDelete(item.id, displayName)}
      >
        <View style={styles.groupRow}>
          <ChatGroupAvatar
            participants={item.participants}
            currentUserId={userId}
            displayName={displayName}
          />

          <View style={styles.groupInfo}>
            <View style={styles.groupNameRow}>
              {item.starred && <Star size={13} color={tokens.statusWarnFg} fill={tokens.statusWarnFg} />}
              <Text variant="bodyLarge" style={[styles.groupName, hasUnread && styles.groupNameUnread]} numberOfLines={1}>
                {displayName}
              </Text>
              {hasUnread && <View style={styles.unreadDot} />}
            </View>
            <Text variant="bodySmall" style={[styles.lastMessage, hasUnread && styles.lastMessageUnread]} numberOfLines={1}>
              {preview}
            </Text>
          </View>
          {item.lastMessage && (
            <Text variant="bodySmall" style={styles.time}>{formatChatListDate(item.lastMessage.created_at)}</Text>
          )}
        </View>
      </SwipeableChatRow>
    );
  };

  return (
    <>
      <View style={styles.container}>
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          contentContainerStyle={[styles.listContent, groups.length === 0 && styles.emptyContainer]}
          ListEmptyComponent={<EmptyState icon="chat-outline" title="No conversations" subtitle="Start a new chat to get started" />}
          refreshControl={refreshControl}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onScrollBeginDrag={() => setOpenRowId(null)}
          keyboardDismissMode="interactive"
        />
        <Fab icon="plus" label="New chat" onPress={() => router.push(`/(${role})/chat/new` as Parameters<typeof router.push>[0])} />
      </View>
      <Portal>
        <Snackbar
          key={activeFeedback?.id ?? 'chat-feedback-empty'}
          visible={Boolean(activeFeedback)}
          onDismiss={dismissFeedback}
          duration={activeFeedback?.kind === 'delete' ? 5000 : 3500}
          action={activeFeedback?.kind === 'delete'
            ? { label: 'Undo', onPress: undoDelete }
            : activeFeedback
              ? { label: 'Dismiss', onPress: () => {} }
              : undefined}
        >
          {activeFeedback?.message ?? ''}
        </Snackbar>
      </Portal>
    </>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
  listContent: { paddingBottom: space.xxl + space.xxl + space.xl },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.lg,
    gap: space.md,
  },
  groupInfo: { flex: 1 },
  groupNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  groupName: { fontWeight: fontWeight.semibold, flex: 1 },
  // eslint-disable-next-line no-restricted-syntax -- intentional: extra-bold unread emphasis has no token step
  groupNameUnread: { fontWeight: '800' },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: t.accentSolid,
  },
  lastMessage: { color: t.textSecondary, marginTop: space.xxs },
  lastMessageUnread: { color: t.textPrimary, fontWeight: fontWeight.semibold },
  time: { color: t.textSecondary },
  // eslint-disable-next-line no-restricted-syntax -- intentional: aligns separator with avatar+gutter width, not a spacing step
  separator: { height: 1, backgroundColor: t.divider, marginLeft: 72 },
  emptyContainer: { flexGrow: 1 },
});
