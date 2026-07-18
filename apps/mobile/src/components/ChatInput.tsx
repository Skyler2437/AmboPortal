import React, { useState, useRef } from 'react';
import {
  AccessibilityInfo,
  View,
  StyleSheet,
  TextInput,
  TextInput as RNTextInput,
  type LayoutChangeEvent,
} from 'react-native';
import { IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticLight } from '@/lib/haptics';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { space, radius, fontSize, type SemanticTokens } from '@/lib/theme';

interface ChatInputProps {
  onSend: (text: string) => Promise<void>;
  onTypingChange?: (hasText: boolean) => void;
  /** Reports the full composer height as multiline input grows or shrinks. */
  onHeightChange?: (height: number) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onTypingChange, onHeightChange, disabled }: ChatInputProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const [text, setText] = useState('');
  const insets = useSafeAreaInsets();
  const inputRef = useRef<RNTextInput>(null);
  const lastHeightRef = useRef(0);

  const handleSend = () => {
    if (!text.trim()) return;
    const message = text.trim();
    setText('');
    onTypingChange?.(false);

    hapticLight();
    void Promise.resolve()
      .then(() => onSend(message))
      .catch(() => AccessibilityInfo.announceForAccessibility('Message failed to send. Tap the failed message to retry.'));
    // Keep the keyboard available for rapid consecutive messages.
    inputRef.current?.focus();
  };

  const handleChangeText = (value: string) => {
    setText(value);
    onTypingChange?.(Boolean(value.trim()));
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    if (height <= 0 || height === lastHeightRef.current) return;
    lastHeightRef.current = height;
    onHeightChange?.(height);
  };

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(space.sm, insets.bottom) }]}
      onLayout={handleLayout}
    >
      <TextInput
        ref={inputRef}
        placeholder="Type a message..."
        placeholderTextColor={tokens.textMuted}
        value={text}
        onChangeText={handleChangeText}
        style={styles.input}
        multiline
        maxLength={2000}
        blurOnSubmit={false}
        editable={!disabled}
        accessibilityLabel="Message"
        onBlur={() => onTypingChange?.(false)}
      />
      <IconButton
        icon="send"
        mode="contained"
        size={20}
        onPress={handleSend}
        disabled={!text.trim() || disabled}
        accessibilityLabel="Send message"
      />
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: t.surface,
    borderTopWidth: 1,
    borderTopColor: t.border,
    gap: space.xs,
  },
  input: {
    flex: 1,
    backgroundColor: t.surfaceVariant,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: fontSize.lg,
    maxHeight: 100,
    color: t.textPrimary,
  },
});
