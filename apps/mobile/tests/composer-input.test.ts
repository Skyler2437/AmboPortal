import React, { createRef } from 'react';
import { AccessibilityInfo, TextInput } from 'react-native';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hapticLight: vi.fn(),
}));

vi.mock('@/lib/haptics', () => ({ hapticLight: mocks.hapticLight }));

import { ChatInput } from '@/components/ChatInput';
import { ComposerInput } from '@/components/ComposerInput';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function findByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((node) => node.props.accessibilityLabel === label);
}

function findHostByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((node) => (
    typeof node.type === 'string' && node.props.accessibilityLabel === label
  ));
}

const mountedRenderers: ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
});

beforeEach(() => {
  mocks.hapticLight.mockReset();
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockReset();
});

describe('ComposerInput mounted behavior', () => {
  it('forwards its input ref and exposes multiline, editable, loading, and accessible states', () => {
    const inputNode = { focus: vi.fn() } as unknown as TextInput;
    const inputRef = createRef<TextInput>();
    const onChangeText = vi.fn();
    const onSend = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(ComposerInput, {
          ref: inputRef,
          value: 'Draft',
          onChangeText,
          onSend,
          placeholder: 'Add a note...',
          accessibilityLabel: 'Note body',
          sendAccessibilityLabel: 'Publish note',
        }),
        { createNodeMock: (element) => (
          element.props.accessibilityLabel === 'Note body' ? inputNode : {}
        ) },
      );
    });
    mountedRenderers.push(renderer);

    const input = findHostByLabel(renderer, 'Note body');
    const send = findByLabel(renderer, 'Publish note');
    expect(inputRef.current).toBe(inputNode);
    expect(input.props).toMatchObject({
      value: 'Draft',
      multiline: true,
      editable: true,
      maxLength: 2000,
      blurOnSubmit: false,
    });
    expect(send.props).toMatchObject({ loading: false, disabled: false });

    act(() => {
      renderer.update(React.createElement(ComposerInput, {
        ref: inputRef,
        value: 'Draft',
        onChangeText,
        onSend,
        placeholder: 'Add a note...',
        sending: true,
        accessibilityLabel: 'Note body',
        sendAccessibilityLabel: 'Publish note',
      }));
    });

    expect(findHostByLabel(renderer, 'Note body').props.editable).toBe(true);
    expect(findByLabel(renderer, 'Publish note').props).toMatchObject({
      loading: true,
      disabled: true,
    });

    act(() => {
      renderer.update(React.createElement(ComposerInput, {
        ref: inputRef,
        value: 'Draft',
        onChangeText,
        onSend,
        placeholder: 'Add a note...',
        disabled: true,
        accessibilityLabel: 'Note body',
        sendAccessibilityLabel: 'Publish note',
      }));
    });
    expect(findHostByLabel(renderer, 'Note body').props.editable).toBe(false);
  });

  it.each([
    { value: '   ', sending: false, disabled: false },
    { value: 'Ready', sending: true, disabled: false },
    { value: 'Ready', sending: false, disabled: true },
  ])('does not invoke onSend when the effective send state is disabled: %o', (props) => {
    const onSend = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(ComposerInput, {
        ...props,
        onChangeText: vi.fn(),
        onSend,
        placeholder: 'Write...',
      }));
    });
    mountedRenderers.push(renderer);

    const send = findByLabel(renderer, 'Send message');
    expect(send.props.disabled).toBe(true);
    act(() => send.props.onPress());
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ChatInput mounted behavior', () => {
  it('blocks an unchanged same-tick duplicate but sends a distinct draft before the first request resolves', async () => {
    const firstSend = deferred<void>();
    const secondSend = deferred<void>();
    const onSend = vi.fn()
      .mockImplementationOnce(() => firstSend.promise)
      .mockImplementationOnce(() => secondSend.promise);
    const onTypingChange = vi.fn();
    const onHeightChange = vi.fn();
    const inputNode = { focus: vi.fn() };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ChatInput, { onSend, onTypingChange, onHeightChange }),
        { createNodeMock: (element) => (
          element.props.accessibilityLabel === 'Message' ? inputNode : {}
        ) },
      );
    });
    mountedRenderers.push(renderer);

    act(() => {
      findByLabel(renderer, 'Message').props.onChangeText('  hello  ');
      findByLabel(renderer, 'Message').props.onLayout({ nativeEvent: { layout: { height: 56.4 } } });
      findByLabel(renderer, 'Message').props.onBlur();
    });
    expect(onTypingChange).toHaveBeenCalledWith(true);
    expect(onTypingChange).toHaveBeenCalledWith(false);
    expect(onHeightChange).toHaveBeenCalledWith(56);

    const send = findByLabel(renderer, 'Send message').props.onPress;
    act(() => {
      send();
      send();
    });
    await act(async () => { await Promise.resolve(); });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(mocks.hapticLight).toHaveBeenCalledTimes(1);
    expect(findByLabel(renderer, 'Message').props.value).toBe('');
    expect(inputNode.focus).toHaveBeenCalledTimes(1);

    act(() => findByLabel(renderer, 'Message').props.onChangeText('next message'));
    expect(findByLabel(renderer, 'Message').props.value).toBe('next message');
    expect(findByLabel(renderer, 'Send message').props.disabled).toBe(false);

    act(() => findByLabel(renderer, 'Send message').props.onPress());
    await act(async () => { await Promise.resolve(); });

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenNthCalledWith(2, 'next message');
    expect(mocks.hapticLight).toHaveBeenCalledTimes(2);
    expect(findByLabel(renderer, 'Message').props.value).toBe('');
    expect(inputNode.focus).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondSend.reject(new Error('offline'));
      await secondSend.promise.catch(() => undefined);
      await Promise.resolve();
    });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Message failed to send. Tap the failed message to retry.',
    );

    await act(async () => {
      firstSend.resolve(undefined);
      await firstSend.promise;
      await Promise.resolve();
    });
    expect(findByLabel(renderer, 'Message').props.value).toBe('');
  });
});
