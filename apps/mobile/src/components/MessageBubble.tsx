import React, { useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Avatar, Icon, Text } from 'react-native-paper';
import { useReducedMotion } from 'react-native-reanimated';
import type { MessageStatus } from '@/hooks/useChatMessages';
import type { MessageGroupPresentation } from '@/lib/chat-thread-state';
import { hapticError, hapticLight, hapticMedium } from '@/lib/haptics';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';

interface MessageBubbleProps {
  content: string;
  createdAt: string;
  senderName: string;
  senderAvatar?: string;
  isOwn: boolean;
  status?: MessageStatus;
  presentation: MessageGroupPresentation;
  canReact?: boolean;
  onRetry?: () => boolean | Promise<boolean>;
  likeCount?: number;
  liked?: boolean;
  onToggleLike?: () => Promise<boolean>;
  onActionError?: (message: string) => void;
}

type MessageAction = 'reaction' | 'copy' | 'retry' | 'cancel';

export function MessageBubble({
  content,
  createdAt,
  senderName,
  senderAvatar,
  isOwn,
  status,
  presentation,
  canReact = true,
  onRetry,
  likeCount = 0,
  liked = false,
  onToggleLike,
  onActionError,
}: MessageBubbleProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const reactionScale = useRef(new Animated.Value(1)).current;
  const previousLikedRef = useRef(liked);
  const time = new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const initials = senderName
    .split(' ')
    .map((name) => name[0])
    .join('')
    .slice(0, 2);

  const isFailed = status === 'failed';
  const isSending = status === 'sending';
  const groupedWithPrevious = presentation.position === 'middle' || presentation.position === 'last';
  const groupedWithNext = presentation.position === 'first' || presentation.position === 'middle';

  useEffect(() => {
    const becameLiked = liked && !previousLikedRef.current;
    previousLikedRef.current = liked;
    if (!becameLiked || reduceMotion) return;

    reactionScale.setValue(1);
    Animated.sequence([
      Animated.spring(reactionScale, {
        toValue: 1.22,
        speed: 28,
        bounciness: 8,
        useNativeDriver: true,
      }),
      Animated.spring(reactionScale, {
        toValue: 1,
        speed: 24,
        bounciness: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, [liked, reactionScale, reduceMotion]);

  const reportActionError = (message: string) => {
    hapticError();
    AccessibilityInfo.announceForAccessibility(message);
    onActionError?.(message);
  };

  const toggleReaction = async () => {
    if (!canReact || !onToggleLike) return;
    hapticLight();
    const updated = await onToggleLike();
    if (!updated) reportActionError("Couldn't update the reaction. Try again.");
  };

  const copyMessage = async () => {
    try {
      await Clipboard.setStringAsync(content);
      hapticLight();
      AccessibilityInfo.announceForAccessibility('Message copied.');
    } catch {
      reportActionError("Couldn't copy the message.");
    }
  };

  const retryMessage = async () => {
    if (!onRetry) return;
    hapticLight();
    const sent = await onRetry();
    if (!sent) reportActionError("Message still couldn't send. Try again.");
  };

  const performAction = (action: MessageAction) => {
    if (action === 'reaction') void toggleReaction();
    if (action === 'copy') void copyMessage();
    if (action === 'retry') void retryMessage();
  };

  const showMessageActions = () => {
    hapticMedium();
    const actions: Array<{ label: string; action: MessageAction }> = [];
    if (canReact && onToggleLike) {
      actions.push({ label: liked ? 'Unlike' : 'Like', action: 'reaction' });
    }
    actions.push({ label: 'Copy', action: 'copy' });
    if (isFailed && onRetry) actions.push({ label: 'Retry Sending', action: 'retry' });
    actions.push({ label: 'Cancel', action: 'cancel' });

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: actions.map((action) => action.label),
          cancelButtonIndex: actions.length - 1,
          title: isOwn ? 'Your message' : `Message from ${senderName}`,
        },
        (selectedIndex) => performAction(actions[selectedIndex]?.action ?? 'cancel'),
      );
      return;
    }

    Alert.alert(
      isOwn ? 'Your message' : `Message from ${senderName}`,
      undefined,
      actions.map(({ label, action }) => ({
        text: label,
        style: action === 'cancel' ? 'cancel' : 'default',
        onPress: () => performAction(action),
      })),
    );
  };

  const accessibilityActions = useMemo(() => {
    const actions = [{ name: 'copy', label: 'Copy message' }];
    if (canReact && onToggleLike) {
      actions.unshift({ name: liked ? 'unlike' : 'like', label: liked ? 'Unlike message' : 'Like message' });
    }
    if (isFailed && onRetry) actions.push({ name: 'retry', label: 'Retry sending message' });
    return actions;
  }, [canReact, isFailed, liked, onRetry, onToggleLike]);

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const actionName = event.nativeEvent.actionName;
    if (actionName === 'like' || actionName === 'unlike') void toggleReaction();
    if (actionName === 'copy') void copyMessage();
    if (actionName === 'retry') void retryMessage();
  };

  const statusLabel = isFailed
    ? 'Not delivered'
    : isSending
      ? 'Sending'
      : presentation.showSentStatus
        ? 'Sent'
        : '';
  const reactionLabel = likeCount > 0 ? `, ${likeCount} ${likeCount === 1 ? 'like' : 'likes'}` : '';

  return (
    <Pressable
      onPress={isFailed && onRetry ? () => { void retryMessage(); } : undefined}
      onLongPress={showMessageActions}
      delayLongPress={350}
      style={[
        styles.container,
        groupedWithPrevious ? styles.clusteredContainer : styles.clusterStartContainer,
        isOwn ? styles.ownContainer : styles.otherContainer,
      ]}
      accessible
      accessibilityLabel={`${isOwn ? 'You' : senderName} said: ${content}, at ${time}${statusLabel ? `, ${statusLabel}` : ''}${reactionLabel}`}
      accessibilityHint="Long press for message actions"
      accessibilityRole="button"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      {!isOwn && (
        <View style={styles.avatarCol} importantForAccessibility="no-hide-descendants">
          {presentation.showAvatar && (senderAvatar ? (
            <Avatar.Image size={28} source={{ uri: senderAvatar }} />
          ) : (
            <Avatar.Text
              size={28}
              label={initials}
              style={styles.avatarFallback}
              labelStyle={styles.avatarLabel}
            />
          ))}
        </View>
      )}
      <View style={[styles.messageCol, isOwn && styles.ownMessageCol]}>
        {presentation.showSenderName && (
          <Text variant="labelSmall" style={styles.senderName}>{senderName}</Text>
        )}
        <View
          style={[
            styles.bubble,
            isOwn ? styles.ownBubble : styles.otherBubble,
            isOwn && groupedWithPrevious && styles.ownConnectedTop,
            isOwn && groupedWithNext && styles.ownConnectedBottom,
            !isOwn && groupedWithPrevious && styles.otherConnectedTop,
            !isOwn && groupedWithNext && styles.otherConnectedBottom,
            isFailed && styles.failedBubble,
          ]}
        >
          <Text
            variant="bodyMedium"
            style={isFailed ? styles.failedContentText : isOwn ? styles.ownText : styles.otherText}
          >
            {content}
          </Text>
        </View>
        {likeCount > 0 && (
          <Animated.View
            style={[
              styles.likeBadge,
              isOwn ? styles.likeBadgeOwn : styles.likeBadgeOther,
              { transform: [{ scale: reactionScale }] },
            ]}
          >
            <Icon
              source={liked ? 'heart' : 'heart-outline'}
              size={12}
              color={liked ? tokens.statusBadFg : tokens.textMuted}
            />
            <Text style={styles.likeBadgeText}>{likeCount}</Text>
          </Animated.View>
        )}
        {presentation.showMeta && (
          <View style={[styles.metaRow, isOwn ? styles.ownMeta : styles.otherMeta]}>
            <Text variant="bodySmall" style={styles.timeOutside}>{time}</Text>
            {isFailed ? (
              <Text variant="bodySmall" style={styles.failedText}>Not Delivered · Tap to Retry</Text>
            ) : (
              <>
                {isOwn && isSending && (
                  <Text variant="bodySmall" style={styles.statusText}>Sending…</Text>
                )}
                {isOwn && presentation.showSentStatus && (
                  <Text variant="bodySmall" style={styles.statusText}>Sent</Text>
                )}
              </>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Renders a date separator header between message groups. */
export function DateSeparator({ date }: { date: string }) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.dateSeparator} accessible accessibilityRole="text" accessibilityLabel={date}>
      <View style={styles.dateLine} />
      <Text variant="labelSmall" style={styles.dateText}>{date}</Text>
      <View style={styles.dateLine} />
    </View>
  );
}

/** Renders an animated typing indicator while respecting Reduce Motion. */
export function TypingIndicator({ names }: { names: string[] }) {
  const { styles } = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const dotOpacities = useRef([
    new Animated.Value(0.4),
    new Animated.Value(0.4),
    new Animated.Value(0.4),
  ]).current;

  const label = names.length === 1
    ? `${names[0]} is typing`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names[0]} and ${names.length - 1} others are typing`;

  useEffect(() => {
    if (reduceMotion) {
      dotOpacities.forEach((opacity, index) => opacity.setValue(0.4 + index * 0.2));
      return;
    }

    const loops = dotOpacities.map((opacity, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 140),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.4, duration: 220, useNativeDriver: true }),
      Animated.delay((dotOpacities.length - index - 1) * 140),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dotOpacities, reduceMotion]);

  if (names.length === 0) return null;

  return (
    <View
      style={[styles.container, styles.clusterStartContainer, styles.otherContainer]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.messageCol} importantForAccessibility="no-hide-descendants">
        <View style={[styles.bubble, styles.otherBubble, styles.typingBubble]}>
          <View style={styles.dotsRow}>
            {dotOpacities.map((opacity, index) => (
              <Animated.View key={index} style={[styles.dot, { opacity }]} />
            ))}
          </View>
        </View>
        <Text variant="bodySmall" style={[styles.timeOutside, styles.otherMeta, styles.typingLabel]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: space.md,
  },
  clusterStartContainer: { marginTop: space.sm },
  clusteredContainer: { marginTop: space.xxs },
  ownContainer: { justifyContent: 'flex-end' },
  otherContainer: { justifyContent: 'flex-start' },
  avatarCol: {
    width: 28,
    marginRight: space.sm,
    alignSelf: 'flex-end',
    marginBottom: space.lg,
  },
  avatarFallback: { backgroundColor: t.surfaceVariant },
  avatarLabel: { fontSize: fontSize.xxs },
  messageCol: { maxWidth: '75%' },
  ownMessageCol: { alignItems: 'flex-end' },
  bubble: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
  },
  ownBubble: {
    backgroundColor: t.accentSolid,
    borderBottomRightRadius: radius.sm,
    alignSelf: 'flex-end',
  },
  otherBubble: {
    backgroundColor: t.surfaceVariant,
    borderBottomLeftRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  ownConnectedTop: { borderTopRightRadius: radius.sm },
  ownConnectedBottom: { borderBottomRightRadius: radius.sm },
  otherConnectedTop: { borderTopLeftRadius: radius.sm },
  otherConnectedBottom: { borderBottomLeftRadius: radius.sm },
  failedBubble: {
    backgroundColor: t.statusBadBg,
    borderWidth: 1,
    borderColor: t.statusBadBorder,
  },
  senderName: {
    color: t.textSecondary,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.xxs,
    marginBottom: space.xxs,
    marginLeft: space.xs,
  },
  ownText: { color: t.onAccent },
  otherText: { color: t.textPrimary },
  // Keep failure meaning in the tinted surface/border while using the primary
  // foreground for WCAG-friendly body-text contrast in both color schemes.
  failedContentText: { color: t.textPrimary },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xxs,
    paddingHorizontal: space.xs,
  },
  ownMeta: { justifyContent: 'flex-end' },
  otherMeta: { justifyContent: 'flex-start' },
  timeOutside: { fontSize: fontSize.xxs, color: t.textSecondary },
  statusText: { fontSize: fontSize.xxs, color: t.textSecondary },
  failedText: {
    fontSize: fontSize.xxs,
    color: t.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: space.lg,
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  dateLine: { flex: 1, height: 1, backgroundColor: t.border },
  dateText: {
    color: t.textSecondary,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.xxs,
  },
  typingBubble: { paddingVertical: space.lg, paddingHorizontal: space.lg },
  typingLabel: {
    fontSize: fontSize.xxs,
    color: t.textSecondary,
    marginTop: space.xxs,
  },
  dotsRow: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  dot: {
    width: 7,
    height: 7,
    // eslint-disable-next-line no-restricted-syntax -- intentional half-pixel radius
    borderRadius: 3.5,
    backgroundColor: t.textMuted,
  },
  likeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    marginTop: -space.sm,
  },
  likeBadgeOwn: { alignSelf: 'flex-end' },
  likeBadgeOther: { alignSelf: 'flex-start' },
  likeBadgeText: {
    fontSize: fontSize.xxs,
    color: t.textSecondary,
    fontWeight: fontWeight.semibold,
  },
});
