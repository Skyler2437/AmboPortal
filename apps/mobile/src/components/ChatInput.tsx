import React, { useState, useRef } from 'react';
import {
  AccessibilityInfo,
  TextInput as RNTextInput,
  type LayoutChangeEvent,
} from 'react-native';
import { ComposerInput } from '@/components/ComposerInput';
import { hapticLight } from '@/lib/haptics';

interface ChatInputProps {
  onSend: (text: string) => Promise<void>;
  onTypingChange?: (hasText: boolean) => void;
  /** Reports the full composer height as multiline input grows or shrinks. */
  onHeightChange?: (height: number) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onTypingChange, onHeightChange, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<RNTextInput>(null);
  const textRef = useRef('');
  const sendInFlightRef = useRef(false);
  const lastHeightRef = useRef(0);

  const handleSend = () => {
    if (disabled || sendInFlightRef.current) return;
    const message = textRef.current.trim();
    if (!message) return;

    sendInFlightRef.current = true;
    setSending(true);
    textRef.current = '';
    setText('');
    onTypingChange?.(false);

    hapticLight();
    void Promise.resolve()
      .then(() => onSend(message))
      .catch(() => AccessibilityInfo.announceForAccessibility('Message failed to send. Tap the failed message to retry.'))
      .finally(() => {
        sendInFlightRef.current = false;
        setSending(false);
      });
    // Keep the keyboard available for rapid consecutive messages.
    inputRef.current?.focus();
  };

  const handleChangeText = (value: string) => {
    textRef.current = value;
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
    <ComposerInput
      ref={inputRef}
      value={text}
      onChangeText={handleChangeText}
      onSend={handleSend}
      placeholder="Type a message..."
      sending={sending}
      disabled={disabled}
      accessibilityLabel="Message"
      sendAccessibilityLabel="Send message"
      onLayout={handleLayout}
      onBlur={() => onTypingChange?.(false)}
    />
  );
}
