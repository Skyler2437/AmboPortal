import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { openExternalLink } from '@/lib/openExternalLink';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { SemanticTokens } from '@/lib/theme';

type PaperTextProps = React.ComponentProps<typeof Text>;

interface LinkifiedTextProps extends Omit<PaperTextProps, 'children'> {
  children: string;
}

type TextSegment = {
  kind: 'text' | 'link';
  value: string;
  href?: string;
};

function stripTrailingPunctuation(value: string) {
  let end = value.length;
  while (end > 0 && /[.,!?;:]/.test(value[end - 1])) end -= 1;

  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;
  for (const [open, close] of pairs) {
    while (value[end - 1] === close) {
      const candidate = value.slice(0, end);
      const openCount = candidate.split(open).length - 1;
      const closeCount = candidate.split(close).length - 1;
      if (closeCount <= openCount) break;
      end -= 1;
    }
  }

  return {
    link: value.slice(0, end),
    trailing: value.slice(end),
  };
}

export function splitTextWithLinks(value: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;
  let cursor = 0;

  for (const match of value.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', value: value.slice(cursor, index) });
    }

    const { link, trailing } = stripTrailingPunctuation(match[0]);
    if (link) {
      segments.push({
        kind: 'link',
        value: link,
        href: link.toLowerCase().startsWith('www.') ? `https://${link}` : link,
      });
    }
    if (trailing) segments.push({ kind: 'text', value: trailing });
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    segments.push({ kind: 'text', value: value.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', value }];
}

/** Renders plain text while turning http(s) and www URLs into accessible links. */
export function LinkifiedText({ children, ...props }: LinkifiedTextProps) {
  const { styles } = useThemedStyles(makeStyles);
  const segments = splitTextWithLinks(children);

  return (
    <Text {...props}>
      {segments.map((segment, index) => (
        segment.kind === 'link' && segment.href ? (
          <Text
            key={`${segment.value}-${index}`}
            style={styles.link}
            onPress={() => void openExternalLink(segment.href!)}
            accessibilityRole="link"
            accessibilityLabel={`Open link ${segment.value}`}
          >
            {segment.value}
          </Text>
        ) : segment.value
      ))}
    </Text>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  link: {
    color: t.accent,
    textDecorationLine: 'underline',
  },
});
