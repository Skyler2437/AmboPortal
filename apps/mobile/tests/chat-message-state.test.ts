import { describe, expect, it } from 'vitest';
import {
  applyRealtimeLikeChange,
  createClientMessageId,
  decorateMessagesWithLikeRows,
  isPersistedChatMessage,
  isRealtimeLikeChangeRelevant,
  mergeRealtimeMessage,
  mergeServerSnapshot,
  mergeServerSnapshotPreservingLikes,
  nextTypingPresence,
  reconnectDelayMs,
  realtimeLikeChangeFromPayload,
  reconcileServerMessage,
  resolveHasOlderMessages,
  type ChatMessage,
  type ChatUser,
} from '@/lib/chat-message-state';

const skyler: ChatUser = {
  first_name: 'Skyler',
  last_name: 'Stevens',
  avatar_url: 'https://example.com/skyler.png',
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    group_id: 'group-1',
    sender_id: 'user-1',
    content: 'Hello',
    created_at: '2026-07-15T20:00:00.000Z',
    users: skyler,
    ...overrides,
  };
}

describe('nextTypingPresence', () => {
  it('emits typing true only when entering the typing state', () => {
    const started = nextTypingPresence(false, true);
    const continued = nextTypingPresence(started.isTyping, true);

    expect(started).toEqual({ isTyping: true, event: true });
    expect(continued).toEqual({ isTyping: true, event: null });
  });

  it('emits typing false only when leaving the typing state', () => {
    const stopped = nextTypingPresence(true, false);
    const remainedStopped = nextTypingPresence(stopped.isTyping, false);

    expect(stopped).toEqual({ isTyping: false, event: false });
    expect(remainedStopped).toEqual({ isTyping: false, event: null });
  });
});

describe('reconcileServerMessage', () => {
  it('marks a successful optimistic send as sent without a realtime event', () => {
    const optimistic = message({
      id: 'optimistic-1',
      status: 'sending',
      like_count: 0,
      liked: false,
    });
    const server = message({
      id: 'server-1',
      created_at: '2026-07-15T20:00:01.000Z',
      users: undefined,
    });

    expect(reconcileServerMessage([optimistic], server, optimistic.id)).toEqual([
      expect.objectContaining({
        id: 'server-1',
        status: 'sent',
        users: skyler,
        like_count: 0,
        liked: false,
      }),
    ]);
  });

  it('deduplicates when realtime delivered the server row before insert returned', () => {
    const optimistic = message({ id: 'optimistic-1', status: 'sending' });
    const server = message({ id: 'server-1', status: 'sent' });

    expect(reconcileServerMessage([optimistic, server], server, optimistic.id)).toEqual([
      expect.objectContaining({ id: 'server-1', status: 'sent' }),
    ]);
  });

  it('uses authoritative server time when an incoming message interleaves with a send', () => {
    const optimistic = message({ id: 'optimistic-1', status: 'sending' });
    const incoming = message({
      id: 'incoming-1',
      sender_id: 'user-2',
      created_at: '2026-07-15T20:00:01.000Z',
    });
    const server = message({
      id: 'server-1',
      created_at: '2026-07-15T20:00:02.000Z',
    });

    expect(reconcileServerMessage([optimistic, incoming], server, optimistic.id).map((item) => item.id)).toEqual([
      'incoming-1',
      'server-1',
    ]);
  });

  it('preserves a reaction that arrived before the same-id insert response', () => {
    const realtimeMessage = message({
      id: 'stable-client-id',
      status: 'sent',
      liked: true,
      like_count: 1,
    });
    const insertResponse = message({
      id: 'stable-client-id',
      status: undefined,
      liked: false,
      like_count: 0,
    });

    expect(
      reconcileServerMessage(
        [realtimeMessage],
        insertResponse,
        'stable-client-id',
      ),
    ).toEqual([
      expect.objectContaining({
        id: 'stable-client-id',
        status: 'sent',
        liked: true,
        like_count: 1,
      }),
    ]);
  });
});

describe('client message identity', () => {
  it('creates UUID-shaped ids that can be reused for an idempotent retry', () => {
    const id = createClientMessageId(() => 0.25);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('distinguishes pending local rows from persisted rows without relying on an id prefix', () => {
    expect(isPersistedChatMessage(message({ id: 'uuid-1', status: 'sending' }))).toBe(false);
    expect(isPersistedChatMessage(message({ id: 'uuid-1', status: 'failed' }))).toBe(false);
    expect(isPersistedChatMessage(message({ id: 'uuid-1', status: 'sent' }))).toBe(true);
    expect(isPersistedChatMessage(message({ id: 'uuid-1', status: undefined }))).toBe(true);
  });
});

describe('mergeRealtimeMessage', () => {
  it('adds an incoming row immediately with cached sender metadata', () => {
    const incoming = message({ id: 'incoming-1', sender_id: 'user-2', users: undefined });

    expect(mergeRealtimeMessage([], incoming, skyler)).toEqual([
      expect.objectContaining({ id: 'incoming-1', status: 'sent', users: skyler }),
    ]);
  });

  it('does not duplicate a realtime row already in state', () => {
    const existing = message({ id: 'server-1', status: 'sent' });

    expect(mergeRealtimeMessage([existing], existing, skyler)).toEqual([existing]);
  });

  it('turns a same-id optimistic row into sent when realtime proves the insert committed', () => {
    const optimistic = message({ id: 'stable-client-id', status: 'sending' });
    const committed = message({
      id: 'stable-client-id',
      status: undefined,
      created_at: '2026-07-15T20:00:01.000Z',
    });

    expect(mergeRealtimeMessage([optimistic], committed, skyler)).toEqual([
      expect.objectContaining({
        id: 'stable-client-id',
        status: 'sent',
        created_at: committed.created_at,
      }),
    ]);
  });

  it('preserves an optimistic row until the exact insert response reconciles it', () => {
    const optimistic = message({ id: 'optimistic-1', status: 'sending' });
    const server = message({ id: 'server-1', users: undefined });

    expect(mergeRealtimeMessage([optimistic], server, skyler)).toEqual([
      optimistic,
      expect.objectContaining({ id: 'server-1', status: 'sent', users: skyler }),
    ]);
  });
});

describe('mergeServerSnapshotPreservingLikes', () => {
  it('keeps the current optimistic reaction when a stale likes query spans a mutation', () => {
    const current = message({ id: 'server-1', liked: true, like_count: 1, status: 'sent' });
    const stale = message({ id: 'server-1', liked: false, like_count: 0, status: undefined });

    expect(
      mergeServerSnapshotPreservingLikes([current], [stale], true),
    ).toEqual([
      expect.objectContaining({ id: 'server-1', liked: true, like_count: 1 }),
    ]);
  });

  it('accepts authoritative like values when no local mutation overlapped', () => {
    const current = message({ id: 'server-1', liked: false, like_count: 0, status: 'sent' });
    const fresh = message({ id: 'server-1', liked: true, like_count: 2, status: undefined });

    expect(
      mergeServerSnapshotPreservingLikes([current], [fresh], false),
    ).toEqual([
      expect.objectContaining({ id: 'server-1', liked: true, like_count: 2 }),
    ]);
  });
});

describe('reaction query decoration', () => {
  it('keeps known reactions non-authoritatively when the likes query fails', () => {
    const existing = message({
      id: 'server-1',
      liked: true,
      like_count: 4,
      status: 'sent',
    });
    expect(decorateMessagesWithLikeRows([existing], 'user-1', null)).toEqual({
      messages: [existing],
      authoritative: false,
    });
  });
});

describe('mergeServerSnapshot', () => {
  it('fills messages missed while realtime was disconnected without duplicating existing rows', () => {
    const existing = message({ id: 'server-1', status: 'sent' });
    const missed = message({ id: 'server-2', sender_id: 'user-2', content: 'Missed', status: undefined });

    expect(mergeServerSnapshot([existing], [existing, missed])).toEqual([
      expect.objectContaining({ id: 'server-1', status: 'sent' }),
      expect.objectContaining({ id: 'server-2', status: 'sent' }),
    ]);
  });

  it('preserves a failed optimistic row during reconnect reconciliation', () => {
    const failed = message({ id: 'optimistic-1', status: 'failed' });

    expect(mergeServerSnapshot([failed], [])).toEqual([failed]);
  });

  it('does not erase an identical failed message when it appears in a server snapshot', () => {
    const failed = message({
      id: 'optimistic-failed',
      created_at: '2026-07-15T20:01:00.000Z',
      status: 'failed',
    });
    const olderServerCopy = message({ id: 'server-older', status: undefined });

    expect(mergeServerSnapshot([failed], [olderServerCopy])).toEqual([
      expect.objectContaining({ id: 'server-older', status: 'sent' }),
      failed,
    ]);
  });

  it('orders equal timestamps by server id for deterministic pagination merges', () => {
    const laterId = message({ id: 'server-z' });
    const earlierId = message({ id: 'server-a' });

    expect(mergeServerSnapshot([laterId], [earlierId]).map((item) => item.id)).toEqual([
      'server-a',
      'server-z',
    ]);
  });
});

describe('reconnectDelayMs', () => {
  it('uses bounded backoff for repeated channel closures', () => {
    expect([0, 1, 2, 3, 8].map(reconnectDelayMs)).toEqual([1000, 2000, 5000, 10000, 10000]);
  });
});

describe('history pagination state', () => {
  it('keeps older-message pagination available after a transient request failure', () => {
    expect(resolveHasOlderMessages(true, null, 50)).toBe(true);
    expect(resolveHasOlderMessages(true, 12, 50)).toBe(false);
    expect(resolveHasOlderMessages(false, 50, 50)).toBe(true);
  });
});

describe('realtime reaction reconciliation', () => {
  it('applies a reaction made by the signed-in user on another device', () => {
    expect(
      applyRealtimeLikeChange(
        [message({ id: 'server-1', liked: false, like_count: 2, status: 'sent' })],
        { messageId: 'server-1', userId: 'user-1', eventType: 'INSERT' },
        'user-1',
      ),
    ).toEqual([
      expect.objectContaining({ id: 'server-1', liked: true, like_count: 3 }),
    ]);
  });

  it('marks a remote reaction on a loaded message as relevant to snapshot protection', () => {
    const loaded = [message({ id: 'server-1', status: 'sent' })];
    expect(isRealtimeLikeChangeRelevant(
      loaded,
      { messageId: 'server-1', userId: 'user-2', eventType: 'INSERT' },
    )).toBe(true);
    expect(isRealtimeLikeChangeRelevant(
      loaded,
      { messageId: 'unloaded', userId: 'user-2', eventType: 'INSERT' },
    )).toBe(false);
    expect(isRealtimeLikeChangeRelevant(
      loaded,
      { messageId: 'server-1', userId: 'user-2', eventType: 'UPDATE' },
    )).toBe(false);
  });

  it('reads deleted reactions from the Supabase old-row payload', () => {
    expect(realtimeLikeChangeFromPayload({
      new: {},
      old: { message_id: 'server-1', user_id: 'user-1' },
      eventType: 'DELETE',
    })).toEqual({
      messageId: 'server-1',
      userId: 'user-1',
      eventType: 'DELETE',
    });
  });
});
