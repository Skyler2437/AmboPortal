import React, { useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import {
  AppState,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  ActivityIndicator,
  View,
  type AppStateStatus,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useAuth } from '@/providers/AuthProvider';
import { useChatMessages, ChatMessage } from '@/hooks/useChatMessages';
import { MessageBubble, DateSeparator, TypingIndicator } from '@/components/MessageBubble';
import { ChatInput } from '@/components/ChatInput';
import { LoadingScreen } from '@/components/LoadingScreen';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Icon, IconButton, Portal, Snackbar, Text } from 'react-native-paper';
import { useChatThreadMeta } from '@/hooks/useChatThreadMeta';
import { useChatReadStore } from '@/stores/chatReadStore';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatMessageDateLabel, getMessageDateKey } from '@/lib/format';
import { isPersistedChatMessage } from '@/lib/chat-message-state';
import {
  countUnseenIncomingMessages,
  createThreadEndFollower,
  createThreadReadAttemptTracker,
  getThreadEndOffset,
  getMessageGroupPresentation,
  shouldMarkThreadRead,
  shouldShowThreadSyncWarning,
} from '@/lib/chat-thread-state';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';
import type { AppRole } from '@/lib/roles';

type ListItem =
  | { type: 'date'; date: string; key: string }
  | { type: 'message'; message: ChatMessage; messageIndex: number; key: string };

/** Message thread shared by the admin and student routes. */
export function ChatThreadScreen({ role }: { role: AppRole }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const {
    messages,
    loading,
    loadingOlder,
    hasOlderMessages,
    sendMessage,
    retryMessage,
    loadOlderMessages,
    typingUsers,
    sendTyping,
    stopTyping,
    toggleMessageLike,
    refreshLikes,
    error,
    connectionStatus,
    connectionError,
    refetch,
  } = useChatMessages(id || '', userId);
  // Hook effects reset state after commit. Filter synchronously so a reused
  // route can never render or mark read using the previous group's rows.
  const threadMessages = useMemo(
    () => messages.filter((message) => message.group_id === id),
    [id, messages],
  );
  const flatListRef = useRef<FlatList<ListItem>>(null);

  // Reconcile like counts from the server when the screen regains focus
  // (realtime deltas can drift if events are missed while backgrounded).
  useFocusEffect(useCallback(() => { refreshLikes(); }, [refreshLikes]));
  const insets = useSafeAreaInsets();
  const { groupName, userFirstName, markRead } = useChatThreadMeta(id || '', userId);
  const markGroupRead = useChatReadStore((s) => s.markGroupRead);
  const removeReadGroup = useChatReadStore((s) => s.removeReadGroup);
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasPresentedLatest, setHasPresentedLatest] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(80);
  const [readRetryNonce, setReadRetryNonce] = useState(0);
  const isNearBottomRef = useRef(true);
  const unseenAnchorRef = useRef<string | undefined>(undefined);
  const lastMarkedMessageIdRef = useRef<string | undefined>(undefined);
  const observedMessageCountRef = useRef(0);
  const previousTypingCountRef = useRef(0);
  const threadEndFollowerRef = useRef<ReturnType<typeof createThreadEndFollower> | null>(null);
  if (!threadEndFollowerRef.current) {
    threadEndFollowerRef.current = createThreadEndFollower();
  }
  const listContentHeightRef = useRef(0);
  const listViewportHeightRef = useRef(0);
  const latestIncomingMessageIdRef = useRef<string | undefined>(undefined);
  const latestIncomingGroupIdRef = useRef<string | undefined>(undefined);
  const readRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readRetryAttemptRef = useRef(0);
  const readAttemptTrackerRef = useRef(createThreadReadAttemptTracker());
  const screenMountedRef = useRef(true);
  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 1,
    minimumViewTime: 100,
  });
  const onViewableItemsChangedRef = useRef(({
    viewableItems,
  }: {
    viewableItems: Array<ViewToken<ListItem>>;
  }) => {
    const latestIncomingId = latestIncomingMessageIdRef.current;
    const latestIncomingGroupId = latestIncomingGroupIdRef.current;
    if (!latestIncomingId || !latestIncomingGroupId) return;
    const latestIncomingIsVisible = viewableItems.some((token) => {
      const item = token.item;
      return (
        token.isViewable &&
        item.type === 'message' &&
        item.message.group_id === latestIncomingGroupId &&
        item.message.id === latestIncomingId
      );
    });
    if (latestIncomingIsVisible) setHasPresentedLatest(true);
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const activeGroupId = id;
    const readAttemptTracker = readAttemptTrackerRef.current;
    isNearBottomRef.current = true;
    unseenAnchorRef.current = undefined;
    lastMarkedMessageIdRef.current = undefined;
    observedMessageCountRef.current = 0;
    previousTypingCountRef.current = 0;
    threadEndFollowerRef.current?.reset();
    listContentHeightRef.current = 0;
    listViewportHeightRef.current = 0;
    if (readRetryTimerRef.current) clearTimeout(readRetryTimerRef.current);
    readRetryTimerRef.current = null;
    readRetryAttemptRef.current = 0;
    setIsNearBottom(true);
    setHasPresentedLatest(false);
    setShowScrollToBottom(false);
    setUnseenCount(0);
    return () => {
      if (
        activeGroupId &&
        readAttemptTracker.cancel(activeGroupId)
      ) {
        // A read is only optimistic until its database write is confirmed.
        // Leaving the thread while it is pending must not suppress unread UI.
        removeReadGroup(activeGroupId);
      }
    };
  }, [id, removeReadGroup]);

  useEffect(() => {
    screenMountedRef.current = true;
    return () => {
      screenMountedRef.current = false;
      if (readRetryTimerRef.current) clearTimeout(readRetryTimerRef.current);
    };
  }, []);

  const latestServerMessage = useMemo(() => {
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      if (isPersistedChatMessage(threadMessages[index])) return threadMessages[index];
    }
    return undefined;
  }, [threadMessages]);
  const latestServerMessageId = latestServerMessage?.id;

  const latestIncomingMessageId = useMemo(() => {
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      const message = threadMessages[index];
      if (isPersistedChatMessage(message) && message.sender_id !== userId) return message.id;
    }
    return undefined;
  }, [threadMessages, userId]);
  latestIncomingMessageIdRef.current = latestIncomingMessageId;
  latestIncomingGroupIdRef.current = id;

  useLayoutEffect(() => {
    // A new incoming message is not "presented" until FlatList reports that
    // exact bubble as viewable after layout/scrolling.
    if (readRetryTimerRef.current) clearTimeout(readRetryTimerRef.current);
    readRetryTimerRef.current = null;
    readRetryAttemptRef.current = 0;
    setHasPresentedLatest(false);
  }, [latestIncomingMessageId]);

  // Only clear unread state once the newest incoming message is genuinely on
  // screen in a focused, foregrounded thread.
  useEffect(() => {
    if (!id || !shouldMarkThreadRead({
      isFocused,
      appState,
      isNearBottom,
      hasPresentedLatestIncoming: hasPresentedLatest,
      latestMessageIsOwn: latestServerMessage?.sender_id === userId,
      latestMessageId: latestIncomingMessageId,
      lastMarkedMessageId: lastMarkedMessageIdRef.current,
    })) return;

    const messageId = latestIncomingMessageId as string;
    const readAttempt = readAttemptTrackerRef.current.begin(id, messageId);
    lastMarkedMessageIdRef.current = messageId;
    markGroupRead(id);
    void (async () => {
      let persisted = false;
      try {
        persisted = await markRead();
      } catch {
        persisted = false;
      }
      if (
        !screenMountedRef.current ||
        latestIncomingGroupIdRef.current !== readAttempt.groupId
      ) return;

      const resolution = readAttemptTrackerRef.current.resolve(readAttempt, persisted);
      if (resolution === 'ignore') return;

      if (resolution === 'failed' && lastMarkedMessageIdRef.current === messageId) {
        lastMarkedMessageIdRef.current = undefined;
        removeReadGroup(id);
        if (readRetryAttemptRef.current < 3) {
          const retryDelay = [1000, 3000, 7000][readRetryAttemptRef.current];
          readRetryAttemptRef.current += 1;
          readRetryTimerRef.current = setTimeout(() => {
            readRetryTimerRef.current = null;
            setReadRetryNonce((nonce) => nonce + 1);
          }, retryDelay);
        }
      } else if (resolution === 'confirmed') {
        if (readRetryTimerRef.current) clearTimeout(readRetryTimerRef.current);
        readRetryTimerRef.current = null;
        readRetryAttemptRef.current = 0;
      }
    })();
  }, [
    appState,
    hasPresentedLatest,
    id,
    isFocused,
    isNearBottom,
    latestIncomingMessageId,
    latestServerMessage?.sender_id,
    markGroupRead,
    markRead,
    readRetryNonce,
    removeReadGroup,
    userId,
  ]);

  useEffect(() => {
    if (isNearBottom) {
      unseenAnchorRef.current = latestServerMessageId;
      setUnseenCount(0);
      return;
    }

    setUnseenCount(countUnseenIncomingMessages(
      threadMessages,
      userId,
      unseenAnchorRef.current,
    ));
  }, [isNearBottom, latestServerMessageId, threadMessages, userId]);

  // Follow the list end while new messages finish all of their layout passes.
  // The follower is stopped as soon as the user starts scrolling manually.
  useLayoutEffect(() => {
    const previousCount = observedMessageCountRef.current;
    if (threadMessages.length === 0) {
      observedMessageCountRef.current = 0;
      return;
    }
    if (previousCount === 0) {
      threadEndFollowerRef.current?.schedule('instant');
    } else if (threadMessages.length > previousCount && isNearBottomRef.current) {
      threadEndFollowerRef.current?.schedule('animated');
    }
    observedMessageCountRef.current = threadMessages.length;
  }, [threadMessages.length]);

  // Build list items with date separators
  const listItems: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    let lastDateKey = '';

    threadMessages.forEach((msg, messageIndex) => {
      const dateKey = getMessageDateKey(msg.created_at);
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        items.push({
          type: 'date',
          date: formatMessageDateLabel(msg.created_at),
          key: `date-${dateKey}`,
        });
      }
      items.push({ type: 'message', message: msg, messageIndex, key: msg.id });
    });
    return items;
  }, [threadMessages]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const nearBottom = distanceFromBottom < 120;
    if (!nearBottom && isNearBottomRef.current) {
      unseenAnchorRef.current = latestServerMessageId;
    }
    isNearBottomRef.current = nearBottom;
    setIsNearBottom((current) => current === nearBottom ? current : nearBottom);
    setShowScrollToBottom(!nearBottom && contentSize.height > layoutMeasurement.height * 1.5);

    if (
      contentOffset.y < 160 &&
      hasOlderMessages &&
      !loadingOlder &&
      threadMessages.length > 0
    ) {
      void loadOlderMessages();
    }
  }, [hasOlderMessages, latestServerMessageId, loadOlderMessages, loadingOlder, threadMessages.length]);

  const scrollToMeasuredEnd = useCallback((mode: 'instant' | 'animated') => {
    const contentHeight = listContentHeightRef.current;
    const viewportHeight = listViewportHeightRef.current;
    if (contentHeight <= 0 || viewportHeight <= 0) return false;

    flatListRef.current?.scrollToOffset({
      offset: getThreadEndOffset(contentHeight, viewportHeight),
      animated: mode === 'animated',
    });
    return true;
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    listContentHeightRef.current = height;
    const mode = threadEndFollowerRef.current?.contentSizeChanged(threadMessages.length > 0);
    if (!mode) return;
    scrollToMeasuredEnd(mode);
  }, [scrollToMeasuredEnd, threadMessages.length]);

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    listViewportHeightRef.current = event.nativeEvent.layout.height;
    const mode = threadEndFollowerRef.current?.contentSizeChanged(threadMessages.length > 0);
    if (mode) scrollToMeasuredEnd(mode);
  }, [scrollToMeasuredEnd, threadMessages.length]);

  const scrollToBottom = useCallback(() => {
    threadEndFollowerRef.current?.schedule('animated');
    if (!scrollToMeasuredEnd('animated')) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [scrollToMeasuredEnd]);

  const handleScrollBeginDrag = useCallback(() => {
    threadEndFollowerRef.current?.stop();
  }, []);

  const handleTypingChange = useCallback((hasText: boolean) => {
    if (!userId || !userFirstName) return;
    if (hasText) sendTyping(userId, userFirstName);
    else stopTyping(userId, userFirstName);
  }, [sendTyping, stopTyping, userFirstName, userId]);

  const othersTyping = useMemo(
    () => typingUsers.filter((typingUser) => typingUser.userId !== userId),
    [typingUsers, userId],
  );

  useLayoutEffect(() => {
    const typingCountChanged = previousTypingCountRef.current !== othersTyping.length;
    previousTypingCountRef.current = othersTyping.length;
    if (typingCountChanged && observedMessageCountRef.current > 0 && isNearBottomRef.current) {
      threadEndFollowerRef.current?.schedule('animated');
    }
  }, [othersTyping.length]);

  const handleSend = async (text: string) => {
    await sendMessage(userId, text);
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'date') {
      return <DateSeparator date={item.date} />;
    }

    const msg = item.message;
    const isOwn = msg.sender_id === userId;
    const presentation = getMessageGroupPresentation(threadMessages, item.messageIndex, userId);
    const senderName = msg.users
      ? `${msg.users.first_name} ${msg.users.last_name}`
      : 'Unknown';

    return (
      <MessageBubble
        content={msg.content}
        createdAt={msg.created_at}
        senderName={senderName}
        senderAvatar={msg.users?.avatar_url}
        isOwn={isOwn}
        status={msg.status}
        presentation={presentation}
        canReact={isPersistedChatMessage(msg)}
        onRetry={
          msg.status === 'failed'
            ? () => retryMessage(msg.id, userId)
            : undefined
        }
        likeCount={msg.like_count}
        liked={msg.liked}
        onToggleLike={() => toggleMessageLike(msg.id)}
        onActionError={setActionFeedback}
      />
    );
  };

  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 44 : 0;
  const isThreadTransitioning = messages.some((message) => message.group_id !== id);
  const initialLoadError = !loading && !isThreadTransitioning && threadMessages.length === 0 && Boolean(error);
  const hasSyncWarning = shouldShowThreadSyncWarning({
    messageCount: threadMessages.length,
    hasLoadError: Boolean(error),
    hasConnectionError: Boolean(connectionError),
  });

  return (
    <>
      <Stack.Screen options={{
        title: groupName,
        // Explicit back button: the native one only appears when this screen
        // has a prior entry in the chat stack, which it doesn't when opened
        // cross-tab (e.g. from an event). Falls back to the chat list.
        headerLeft: () => (
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace(`/(${role})/chat` as Parameters<typeof router.replace>[0]))}
          />
        ),
        headerRight: () => (
          <IconButton icon="dots-vertical" accessibilityLabel="Chat settings" onPress={() => router.push({ pathname: `/(${role})/chat/edit`, params: { id } } as Parameters<typeof router.push>[0])} />
        ),
      }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={keyboardOffset}
      >
        {(loading || isThreadTransitioning) && threadMessages.length === 0 ? (
          <LoadingScreen />
        ) : initialLoadError ? (
          <ErrorState
            message="We couldn't load this conversation. Check your connection and try again."
            onRetry={() => { void refetch(); }}
          />
        ) : (
          <>
            {hasSyncWarning && (
              <View
                style={styles.syncBanner}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Icon source="wifi-alert" size={18} color={tokens.statusWarnFg} />
                <Text variant="bodySmall" style={styles.syncBannerText}>
                  {connectionError
                    ? connectionStatus === 'RECONNECTING'
                      ? 'Reconnecting live updates…'
                      : 'Live updates were interrupted.'
                    : 'Messages may be out of date.'}
                </Text>
                <Pressable
                  onPress={() => { void refetch(); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading messages"
                >
                  <Text variant="labelMedium" style={styles.syncBannerAction}>Retry</Text>
                </Pressable>
              </View>
            )}
            <FlatList
              ref={flatListRef}
              data={listItems}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              contentContainerStyle={threadMessages.length === 0 ? styles.emptyContainer : styles.list}
              ListEmptyComponent={<EmptyState icon="chat-outline" title="No messages yet" subtitle="Send the first message!" />}
              ListHeaderComponent={
                loadingOlder ? (
                  <View style={styles.loadOlderStatus} accessible accessibilityLabel="Loading earlier messages">
                    <ActivityIndicator size="small" color={tokens.textMuted} />
                  </View>
                ) : null
              }
              ListFooterComponent={
                othersTyping.length > 0 ? (
                  <TypingIndicator names={othersTyping.map((typingUser) => typingUser.firstName)} />
                ) : null
              }
              onScroll={handleScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onLayout={handleListLayout}
              scrollEventThrottle={16}
              onContentSizeChange={handleContentSizeChange}
              onViewableItemsChanged={onViewableItemsChangedRef.current}
              viewabilityConfig={viewabilityConfigRef.current}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => null}
            />

            {showScrollToBottom && (
              <Pressable
                style={[styles.scrollToBottomBtn, { bottom: composerHeight + space.sm }]}
                onPress={scrollToBottom}
                hitSlop={4}
                accessibilityLabel={unseenCount > 0
                  ? `Scroll to latest messages, ${unseenCount} unseen`
                  : 'Scroll to latest messages'}
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="chevron-down" size={24} color={tokens.onAccent} />
                {unseenCount > 0 && (
                  <View style={styles.unseenBadge}>
                    <Text style={styles.unseenBadgeText}>{unseenCount > 99 ? '99+' : unseenCount}</Text>
                  </View>
                )}
              </Pressable>
            )}
          </>
        )}

        {!loading && !isThreadTransitioning && (
          <ChatInput
            onSend={handleSend}
            onTypingChange={handleTypingChange}
            onHeightChange={setComposerHeight}
            disabled={initialLoadError || !userId}
          />
        )}
        <Portal>
          <Snackbar
            visible={Boolean(actionFeedback)}
            onDismiss={() => setActionFeedback(null)}
            duration={3500}
            action={{ label: 'Dismiss', onPress: () => setActionFeedback(null) }}
          >
            {actionFeedback ?? ''}
          </Snackbar>
        </Portal>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
  list: { paddingVertical: space.md },
  emptyContainer: { flexGrow: 1 },
  loadOlderStatus: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  syncBanner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: t.statusWarnBg,
    borderBottomWidth: 1,
    borderBottomColor: t.statusWarnBorder,
  },
  syncBannerText: {
    flex: 1,
    color: t.textSecondary,
  },
  syncBannerAction: {
    color: t.accent,
    fontWeight: fontWeight.semibold,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: t.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: t.shadowOpacity,
    shadowRadius: 4,
    elevation: 4,
  },
  unseenBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface,
    borderWidth: 2,
    borderColor: t.accentSolid,
  },
  unseenBadgeText: {
    color: t.textPrimary,
    fontSize: fontSize.xxs,
    fontWeight: fontWeight.bold,
  },
});
