import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/chat-message-state';
import {
  countUnseenIncomingMessages,
  createThreadEndFollower,
  createThreadReadAttemptTracker,
  getThreadEndOffset,
  getMessageGroupPresentation,
  shouldMarkThreadRead,
  shouldShowThreadSyncWarning,
} from '@/lib/chat-thread-state';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    group_id: 'group-1',
    sender_id: 'user-1',
    content: 'Hello',
    created_at: '2026-07-15T20:00:00.000Z',
    status: 'sent',
    users: { first_name: 'Skyler', last_name: 'Stevens' },
    ...overrides,
  };
}

describe('shouldMarkThreadRead', () => {
  const ready = {
    isFocused: true,
    appState: 'active' as const,
    isNearBottom: true,
    hasPresentedLatestIncoming: true,
    latestMessageIsOwn: false,
    latestMessageId: 'message-2',
    lastMarkedMessageId: 'message-1',
  };

  it('marks a new visible latest message while the active thread is focused', () => {
    expect(shouldMarkThreadRead(ready)).toBe(true);
  });

  it('does not mark an incoming latest message before its bubble is presented', () => {
    expect(shouldMarkThreadRead({
      ...ready,
      hasPresentedLatestIncoming: false,
    })).toBe(false);
  });

  it('marks read at the bottom when the newest message is the user reply', () => {
    expect(shouldMarkThreadRead({
      ...ready,
      hasPresentedLatestIncoming: false,
      latestMessageIsOwn: true,
    })).toBe(true);
  });

  it.each([
    ['unfocused', { isFocused: false }],
    ['backgrounded', { appState: 'background' as const }],
    ['away from bottom', { isNearBottom: false }],
    ['already marked', { lastMarkedMessageId: 'message-2' }],
    ['empty', { latestMessageId: undefined }],
  ])('does not mark when %s', (_label, overrides) => {
    expect(shouldMarkThreadRead({ ...ready, ...overrides })).toBe(false);
  });
});

describe('thread read acknowledgement attempts', () => {
  it('ignores an older completion after a newer read attempt starts', () => {
    const tracker = createThreadReadAttemptTracker();
    const older = tracker.begin('group-1', 'message-1');
    const newer = tracker.begin('group-1', 'message-2');

    expect(tracker.resolve(older, true)).toBe('ignore');
    expect(tracker.resolve(newer, false)).toBe('failed');
  });

  it('cancels a pending optimistic attempt when its thread exits', () => {
    const tracker = createThreadReadAttemptTracker();
    const pending = tracker.begin('group-1', 'message-1');

    expect(tracker.cancel('group-1')).toBe(true);
    expect(tracker.resolve(pending, false)).toBe('ignore');
  });
});

describe('shouldShowThreadSyncWarning', () => {
  it('shows a live-connection warning before an empty conversation has messages', () => {
    expect(shouldShowThreadSyncWarning({
      messageCount: 0,
      hasLoadError: false,
      hasConnectionError: true,
    })).toBe(true);
  });

  it('leaves an empty load error to the full-page error state', () => {
    expect(shouldShowThreadSyncWarning({
      messageCount: 0,
      hasLoadError: true,
      hasConnectionError: false,
    })).toBe(false);
  });
});

describe('countUnseenIncomingMessages', () => {
  it('counts only incoming server messages newer than the visible anchor', () => {
    const messages = [
      message({ id: 'anchor' }),
      message({ id: 'incoming-1', sender_id: 'them', created_at: '2026-07-15T20:01:00.000Z' }),
      message({ id: 'own', sender_id: 'me', created_at: '2026-07-15T20:02:00.000Z' }),
      message({ id: 'incoming-2', sender_id: 'them', created_at: '2026-07-15T20:03:00.000Z' }),
    ];

    expect(countUnseenIncomingMessages(messages, 'me', 'anchor')).toBe(2);
  });

  it('does not treat loaded history or an unknown anchor as unseen', () => {
    const messages = [message({ id: 'older', sender_id: 'them' })];

    expect(countUnseenIncomingMessages(messages, 'me', 'missing')).toBe(0);
    expect(countUnseenIncomingMessages(messages, 'me', undefined)).toBe(0);
  });
});

describe('thread end auto-scroll', () => {
  it('keeps following the bottom through every layout pass for a new message', () => {
    const follower = createThreadEndFollower();
    follower.schedule('animated');

    expect(follower.contentSizeChanged(true)).toBe('animated');
    expect(follower.contentSizeChanged(true)).toBe('animated');
  });

  it('targets the exact measured end instead of an estimated final row', () => {
    expect(getThreadEndOffset(920, 700)).toBe(220);
    expect(getThreadEndOffset(500, 700)).toBe(0);
  });
});

describe('getMessageGroupPresentation', () => {
  it('groups consecutive messages from the same sender within five minutes', () => {
    const messages = [
      message({ id: 'one', created_at: '2026-07-15T20:00:00.000Z' }),
      message({ id: 'two', created_at: '2026-07-15T20:02:00.000Z' }),
      message({ id: 'three', created_at: '2026-07-15T20:04:00.000Z' }),
    ];

    expect(getMessageGroupPresentation(messages, 0, 'other-user')).toEqual(
      expect.objectContaining({ position: 'first', showSenderName: true, showAvatar: false, showMeta: false }),
    );
    expect(getMessageGroupPresentation(messages, 1, 'other-user')).toEqual(
      expect.objectContaining({ position: 'middle', showSenderName: false, showAvatar: false, showMeta: false }),
    );
    expect(getMessageGroupPresentation(messages, 2, 'other-user')).toEqual(
      expect.objectContaining({ position: 'last', showSenderName: false, showAvatar: true, showMeta: true }),
    );
  });

  it('breaks a group when the sender changes, date changes, or the gap exceeds five minutes', () => {
    const senderChange = [
      message({ id: 'one' }),
      message({ id: 'two', sender_id: 'user-2', created_at: '2026-07-15T20:01:00.000Z' }),
    ];
    const dateChange = [
      message({ id: 'one', created_at: new Date(2026, 6, 15, 23, 59).toISOString() }),
      message({ id: 'two', created_at: new Date(2026, 6, 16, 0, 1).toISOString() }),
    ];
    const longGap = [
      message({ id: 'one', created_at: '2026-07-15T20:00:00.000Z' }),
      message({ id: 'two', created_at: '2026-07-15T20:06:00.000Z' }),
    ];

    expect(getMessageGroupPresentation(senderChange, 0, 'other-user').position).toBe('single');
    expect(getMessageGroupPresentation(dateChange, 0, 'other-user').position).toBe('single');
    expect(getMessageGroupPresentation(longGap, 0, 'other-user').position).toBe('single');
  });

  it('uses the same local-day boundary as the visible date separator', () => {
    const beforeLocalMidnight = new Date(2026, 6, 15, 23, 59).toISOString();
    const afterLocalMidnight = new Date(2026, 6, 16, 0, 1).toISOString();
    const messages = [
      message({ id: 'before', created_at: beforeLocalMidnight }),
      message({ id: 'after', created_at: afterLocalMidnight }),
    ];

    expect(getMessageGroupPresentation(messages, 0, 'other-user').position).toBe('single');
    expect(getMessageGroupPresentation(messages, 1, 'other-user').position).toBe('single');
  });

  it('shows Sent only for the latest outgoing sent message', () => {
    const messages = [
      message({ id: 'one', sender_id: 'me' }),
      message({ id: 'two', sender_id: 'them' }),
      message({ id: 'three', sender_id: 'me' }),
    ];

    expect(getMessageGroupPresentation(messages, 0, 'me').showSentStatus).toBe(false);
    expect(getMessageGroupPresentation(messages, 2, 'me').showSentStatus).toBe(true);
  });
});
