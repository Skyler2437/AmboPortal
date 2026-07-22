import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Text } from 'react-native-paper';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useAutoGrowingInput } from '@/hooks/useAutoGrowingInput';
import { space, type SemanticTokens } from '@/lib/theme';

type TextInputProps = React.ComponentProps<typeof TextInput>;

interface FormFieldProps extends Omit<TextInputProps, 'mode' | 'error'> {
  label: string;
  /** Helper text shown below the input when there's no error. */
  hint?: string;
  /** Error message; when set, the input renders in its error state. */
  error?: string;
  /** Grow and shrink the multiline field to keep all current text visible. */
  autoGrow?: boolean;
  /** Starting height for an auto-growing field. */
  minInputHeight?: number;
}

/** Outlined text input with a consistent label/hint/error treatment.
 * Replaces the ~59 ad-hoc `<TextInput mode="outlined" label=...>` blocks. */
export function FormField({
  label,
  hint,
  error,
  autoGrow = false,
  minInputHeight = 56,
  multiline,
  scrollEnabled,
  onContentSizeChange,
  style,
  ...rest
}: FormFieldProps) {
  const { styles } = useThemedStyles(makeStyles);
  const autoSize = useAutoGrowingInput(minInputHeight);

  return (
    <View style={styles.field}>
      <TextInput
        {...rest}
        mode="outlined"
        label={label}
        error={!!error}
        dense
        multiline={autoGrow || multiline}
        scrollEnabled={autoGrow ? false : scrollEnabled}
        onContentSizeChange={autoGrow ? (event) => {
          autoSize.onContentSizeChange(event);
          onContentSizeChange?.(event);
        } : onContentSizeChange}
        style={[styles.input, autoGrow && { height: autoSize.height }, style]}
      />
      {error ? (
        <Text variant="bodySmall" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="bodySmall" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    field: { marginBottom: space.md },
    input: { backgroundColor: t.surface },
    hint: { color: t.textMuted, marginTop: space.xs },
    error: { color: t.statusBadFg, marginTop: space.xs },
  });
