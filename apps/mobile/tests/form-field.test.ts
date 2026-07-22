import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField } from '@/components/ui/FormField';

const mountedRenderers: ReactTestRenderer[] = [];

function flattenedStyle(style: unknown) {
  const values = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...values.filter(Boolean));
}

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
});

describe('FormField responsive sizing', () => {
  it('grows and shrinks an auto-growing field from measured text content', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(FormField, {
        label: 'Uniform',
        value: 'Ambo polo',
        onChangeText: vi.fn(),
        autoGrow: true,
        minInputHeight: 72,
      }));
    });
    mountedRenderers.push(renderer);

    let input = renderer.root.find((node) => node.type === 'PaperTextInput');
    expect(input.props.multiline).toBe(true);
    expect(input.props.scrollEnabled).toBe(false);
    expect(flattenedStyle(input.props.style).height).toBe(72);

    act(() => input.props.onContentSizeChange?.({
      nativeEvent: { contentSize: { width: 260, height: 120 } },
    }));
    input = renderer.root.find((node) => node.type === 'PaperTextInput');
    expect(flattenedStyle(input.props.style).height).toBe(152);

    act(() => input.props.onContentSizeChange?.({
      nativeEvent: { contentSize: { width: 260, height: 20 } },
    }));
    input = renderer.root.find((node) => node.type === 'PaperTextInput');
    expect(flattenedStyle(input.props.style).height).toBe(72);
  });
});
