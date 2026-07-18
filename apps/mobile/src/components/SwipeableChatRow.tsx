import React, { useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Star, StarOff, Trash2 } from 'lucide-react-native';
import { hapticMedium } from '@/lib/haptics';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { type SemanticTokens, space, fontSize, fontWeight } from '@/lib/theme';

const ACTION_WIDTH = 80;
const ACTIONS_WIDTH = ACTION_WIDTH * 2;

interface Props {
  rowId: string;
  openRowId: string | null;
  starred: boolean;
  accessibilityLabel: string;
  onOpen: (rowId: string) => void;
  onClose: (rowId: string) => void;
  onPress: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

interface SwipeActionsProps {
  progress: SharedValue<number>;
  visible: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onDelete: () => void;
  close: () => void;
}

function SwipeActions({
  progress,
  visible,
  starred,
  onToggleStar,
  onDelete,
  close,
}: SwipeActionsProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.25),
    transform: [{ translateX: Math.max(0, (1 - progress.value) * 18) }],
  }));

  const runAction = (action: () => void) => {
    close();
    hapticMedium();
    action();
  };

  return (
    <Animated.View
      style={[styles.actions, animatedStyle]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
    >
      <Pressable
        style={({ pressed }) => [styles.action, styles.starAction, pressed && styles.actionPressed]}
        onPress={() => runAction(onToggleStar)}
        accessibilityRole="button"
        accessibilityLabel={starred ? 'Unstar chat' : 'Star chat'}
      >
        {starred ? (
          <StarOff size={21} color={tokens.onAccent} />
        ) : (
          <Star size={21} color={tokens.onAccent} fill={tokens.onAccent} />
        )}
        <Text style={[styles.actionText, styles.starActionText]}>{starred ? 'Unstar' : 'Star'}</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.action, styles.deleteAction, pressed && styles.actionPressed]}
        onPress={() => runAction(onDelete)}
        accessibilityRole="button"
        accessibilityLabel="Delete chat"
      >
        <Trash2 size={21} color={tokens.textPrimary} />
        <Text style={[styles.actionText, styles.deleteActionText]}>Delete</Text>
      </Pressable>
    </Animated.View>
  );
}

/** UI-thread swipe row with one-open-at-a-time and complete VoiceOver actions. */
export function SwipeableChatRow({
  rowId,
  openRowId,
  starred,
  accessibilityLabel,
  onOpen,
  onClose,
  onPress,
  onToggleStar,
  onDelete,
  children,
}: Props) {
  const { styles } = useThemedStyles(makeStyles);
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const isOpen = openRowId === rowId;

  useEffect(() => {
    if (!isOpen) swipeableRef.current?.close();
  }, [isOpen]);

  const accessibilityActions = useMemo(() => [
    { name: starred ? 'unstar' : 'star', label: starred ? 'Unstar chat' : 'Star chat' },
    { name: 'delete', label: 'Delete chat' },
  ], [starred]);

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const actionName = event.nativeEvent.actionName;
    if (actionName === 'star' || actionName === 'unstar') {
      hapticMedium();
      onToggleStar();
    }
    if (actionName === 'delete') {
      hapticMedium();
      onDelete();
    }
  };

  const handleRowPress = () => {
    if (isOpen) {
      swipeableRef.current?.close();
      onClose(rowId);
      return;
    }
    onPress();
  };

  // The app pins React 19 while this RN Pressable path resolves a React 18
  // ReactNode declaration. Runtime children are compatible.
  const childrenNode: any = children;

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={1.7}
      rightThreshold={56}
      dragOffsetFromRightEdge={12}
      overshootRight={false}
      enableTrackpadTwoFingerGesture
      containerStyle={styles.container}
      childrenContainerStyle={styles.row}
      onSwipeableOpenStartDrag={() => onOpen(rowId)}
      onSwipeableWillOpen={() => {
        onOpen(rowId);
        hapticMedium();
      }}
      onSwipeableClose={() => onClose(rowId)}
      renderRightActions={(progress, _translation, methods) => (
        <SwipeActions
          progress={progress}
          visible={isOpen}
          starred={starred}
          onToggleStar={onToggleStar}
          onDelete={onDelete}
          close={methods.close}
        />
      )}
    >
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={handleRowPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Swipe left or use actions to star or delete this chat"
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
      >
        {childrenNode}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: { backgroundColor: t.surface, overflow: 'hidden' },
  row: { backgroundColor: t.surface },
  rowPressed: { backgroundColor: t.surfaceVariant },
  actions: {
    width: ACTIONS_WIDTH,
    flexDirection: 'row',
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  actionPressed: { opacity: 0.72 },
  starAction: { backgroundColor: t.accentSolid },
  deleteAction: { backgroundColor: t.statusBadBorder },
  actionText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  starActionText: { color: t.onAccent },
  deleteActionText: { color: t.textPrimary },
});
