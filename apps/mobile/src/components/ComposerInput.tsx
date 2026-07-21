import React, { forwardRef } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputProps,
} from 'react-native';
import { IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { fontSize, radius, space, type SemanticTokens } from '@/lib/theme';

interface ComposerInputProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  sending?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  sendAccessibilityLabel?: string;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  onLayout?: (event: LayoutChangeEvent) => void;
}

export const ComposerInput = forwardRef<TextInput, ComposerInputProps>(function ComposerInput({
  value,
  onChangeText,
  onSend,
  placeholder,
  sending = false,
  disabled = false,
  accessibilityLabel = 'Message',
  sendAccessibilityLabel = 'Send message',
  onFocus,
  onBlur,
  onLayout,
}, ref) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const sendDisabled = !value.trim() || sending || disabled;

  const handleSend = () => {
    if (sendDisabled) return;
    return onSend();
  };

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(space.sm, insets.bottom) }]}
      onLayout={onLayout}
    >
      <TextInput
        ref={ref}
        placeholder={placeholder}
        placeholderTextColor={tokens.textMuted}
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
        multiline
        maxLength={2000}
        blurOnSubmit={false}
        editable={!disabled}
        accessibilityLabel={accessibilityLabel}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <IconButton
        icon="send"
        mode="contained"
        size={20}
        onPress={handleSend}
        disabled={sendDisabled}
        loading={sending}
        accessibilityLabel={sendAccessibilityLabel}
        accessibilityState={{ disabled: sendDisabled, busy: sending }}
      />
    </View>
  );
});

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
