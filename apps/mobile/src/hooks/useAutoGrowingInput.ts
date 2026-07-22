import { useCallback, useState } from 'react';
import type {
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
} from 'react-native';
import { space } from '@/lib/theme';

type ContentSizeChangeEvent = NativeSyntheticEvent<TextInputContentSizeChangeEventData>;

/** Keeps a multiline input tall enough to show its current content without scrolling. */
export function useAutoGrowingInput(minHeight: number) {
  const [height, setHeight] = useState(minHeight);

  const onContentSizeChange = useCallback((event: ContentSizeChangeEvent) => {
    const measuredHeight = Math.ceil(event.nativeEvent.contentSize.height + space.xxl);
    setHeight(Math.max(minHeight, measuredHeight));
  }, [minHeight]);

  return { height, onContentSizeChange };
}
