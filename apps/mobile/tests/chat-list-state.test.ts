import { describe, expect, it } from 'vitest';
import {
  applyIncomingChatMessage,
  beginVersionedIntent,
  createKeyedOperationQueue,
  dismissActiveChatFeedback,
  enqueueChatFeedback,
  getChatDeletionWatermark,
  getChatPreview,
  getGroupDisplayName,
  isCurrentChatListRequest,
  mergeFetchedChatGroups,
  removeChatWithSnapshot,
  rollbackRestoredChatSnapshot,
  settleVersionedIntent,
  restoreChatSnapshot,
  type ChatListGroup,
  type ChatListFeedback,
  type ChatListStateGroup,
} from '@/lib/chat-list-state';

function group(overrides: Partial<ChatListGroup> = {}): ChatListGroup {
  return {
    name: null,
    participants: [
      { user_id: 'me', users: { first_name: 'Skyler', last_name: 'Stevens' } },
      { user_id: 'sam', users: { first_name: 'Sam', last_name: 'Lee' } },
    ],
    ...overrides,
  };
}

function stateGroup(overrides: Partial<ChatListStateGroup> = {}): ChatListStateGroup {
  return {
    id: 'group-1',
    starred: false,
    hasUnread: false,
    lastMessage: {
      id: 'message-2',
      content: 'Latest',
      created_at: '2026-07-15T20:01:00.000Z',
      sender_id: 'sam',
    },
    ...overrides,
  };
}

describe('getGroupDisplayName', () => {
  it('prefers an explicit group name', () => {
    expect(getGroupDisplayName(group({ name: 'Ambassadors' }), 'me')).toBe('Ambassadors');
  });

  it('derives an unnamed title from the other participants', () => {
    expect(getGroupDisplayName(group(), 'me')).toBe('Sam');
  });
});

describe('getChatPreview', () => {
  it('labels the current user in an outgoing preview', () => {
    expect(getChatPreview(group({
      lastMessage: { sender_id: 'me', content: 'On my way', created_at: '2026-07-15T20:00:00Z' },
    }), 'me')).toBe('You: On my way');
  });

  it('labels the sender in a multi-person conversation', () => {
    const multi = group({
      participants: [
        ...group().participants,
        { user_id: 'alex', users: { first_name: 'Alex', last_name: 'Kim' } },
      ],
      lastMessage: { sender_id: 'alex', content: 'See you there', created_at: '2026-07-15T20:00:00Z' },
    });

    expect(getChatPreview(multi, 'me')).toBe('Alex: See you there');
  });

  it('keeps a direct incoming preview simple and handles empty chats', () => {
    expect(getChatPreview(group({
      lastMessage: { sender_id: 'sam', content: 'Hello', created_at: '2026-07-15T20:00:00Z' },
    }), 'me')).toBe('Hello');
    expect(getChatPreview(group(), 'me')).toBe('No messages yet');
  });
});

describe('chat deletion snapshots', () => {
  const chats = [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
    { id: 'three', title: 'Three' },
  ];

  it('captures the exact removed chat and its position', () => {
    const result = removeChatWithSnapshot(chats, 'two');

    expect(result.items.map((chat) => chat.id)).toEqual(['one', 'three']);
    expect(result.snapshot).toEqual({
      item: chats[1],
      index: 1,
      beforeId: 'one',
      afterId: 'three',
    });
    expect(result.snapshot?.item).toBe(chats[1]);
  });

  it('restores the exact snapshot locally without duplicating an existing chat', () => {
    const removed = removeChatWithSnapshot(chats, 'two');
    const restored = restoreChatSnapshot(removed.items, removed.snapshot!);

    expect(restored).toEqual(chats);
    expect(restored[1]).toBe(chats[1]);
    expect(restoreChatSnapshot(chats, removed.snapshot!)).toBe(chats);
  });

  it('rolls back only the unchanged item inserted by a failed Undo', () => {
    const removed = removeChatWithSnapshot(chats, 'two');
    const restored = restoreChatSnapshot(removed.items, removed.snapshot!);
    const refreshed = restored.map((chat) => chat.id === 'two' ? { ...chat, title: 'New activity' } : chat);

    expect(rollbackRestoredChatSnapshot(restored, removed.snapshot!)).toEqual(removed.items);
    expect(rollbackRestoredChatSnapshot(refreshed, removed.snapshot!)).toBe(refreshed);
  });

  it('preserves list order when overlapping deletes are undone in sequence', () => {
    const firstRemoval = removeChatWithSnapshot(chats, 'one');
    const secondRemoval = removeChatWithSnapshot(firstRemoval.items, 'two');

    const firstRestored = restoreChatSnapshot(secondRemoval.items, firstRemoval.snapshot!);
    const bothRestored = restoreChatSnapshot(firstRestored, secondRemoval.snapshot!);

    expect(bothRestored).toEqual(chats);
  });

  it('uses the latest message from the confirmation-time snapshot as the delete watermark', () => {
    const removed = removeChatWithSnapshot([
      stateGroup({
        lastMessage: {
          id: 'new-message',
          content: 'Arrived while the alert was open',
          created_at: '2026-07-15T20:05:00.000Z',
          sender_id: 'sam',
        },
      }),
    ], 'group-1');

    expect(getChatDeletionWatermark(
      removed.snapshot!,
      '2026-07-15T20:06:00.000Z',
    )).toBe('2026-07-15T20:05:00.000Z');
  });
});

describe('incoming chat-list messages', () => {
  it('marks an older incoming insert unread without replacing the newer preview', () => {
    const current = stateGroup();

    const updated = applyIncomingChatMessage(current, {
      id: 'message-1',
      content: 'Delayed',
      created_at: '2026-07-15T20:00:00.000Z',
      sender_id: 'alex',
    }, 'me');

    expect(updated.lastMessage).toBe(current.lastMessage);
    expect(updated.hasUnread).toBe(true);
  });
});

describe('chat-list fetch reconciliation', () => {
  it('preserves a newer realtime preview and unread state over a stale fetch snapshot', () => {
    const current = stateGroup({
      lastMessage: {
        id: 'message-3',
        content: 'Realtime',
        created_at: '2026-07-15T20:02:00.000Z',
        sender_id: 'alex',
      },
      hasUnread: true,
    });
    const fetched = stateGroup();

    const [merged] = mergeFetchedChatGroups([current], [fetched]);

    expect(merged.lastMessage).toBe(current.lastMessage);
    expect(merged.hasUnread).toBe(true);
  });

  it('preserves local star and visibility changes that crossed the fetch', () => {
    const starred = stateGroup({ id: 'starred', starred: true });
    const restored = stateGroup({ id: 'restored' });
    const fetched = [
      stateGroup({ id: 'starred', starred: false }),
      stateGroup({ id: 'deleted' }),
    ];

    const merged = mergeFetchedChatGroups([starred, restored], fetched, {
      changedIds: new Set(['starred', 'deleted', 'restored']),
    });

    expect(merged.map((chat) => chat.id)).toEqual(['starred', 'restored']);
    expect(merged[0].starred).toBe(true);
  });

  it('preserves active intents that began before the fetch', () => {
    const current = stateGroup({ id: 'starred', starred: true });
    const fetched = [
      stateGroup({ id: 'starred', starred: false }),
      stateGroup({ id: 'deleted' }),
    ];

    const merged = mergeFetchedChatGroups([current], fetched, {
      starIntents: new Map([['starred', true]]),
      visibilityIntents: new Map([['deleted', 'deleted']]),
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].starred).toBe(true);
  });
});

describe('chat-list request identity', () => {
  it('rejects a previous user and a superseded request for the same user', () => {
    const current = { userId: 'user-b', generation: 2, requestId: 4 };

    expect(isCurrentChatListRequest(current, {
      userId: 'user-a',
      generation: 1,
      requestId: 3,
    })).toBe(false);
    expect(isCurrentChatListRequest(current, {
      userId: 'user-b',
      generation: 2,
      requestId: 3,
    })).toBe(false);
    expect(isCurrentChatListRequest(current, current)).toBe(true);
  });
});

describe('versioned optimistic intents', () => {
  it('rolls the latest failed star intent back to the last confirmed state', () => {
    const first = beginVersionedIntent<boolean>(undefined, false, true);
    const second = beginVersionedIntent(first, false, false);

    const firstFailure = settleVersionedIntent(second, first.version, true, false);
    const secondFailure = settleVersionedIntent(
      firstFailure.next!,
      second.version,
      false,
      false,
    );

    expect(firstFailure.isLatest).toBe(false);
    expect(secondFailure.rollbackTo).toBe(false);
  });

  it('advances confirmed state when an earlier queued intent succeeds', () => {
    const first = beginVersionedIntent<boolean>(undefined, false, true);
    const second = beginVersionedIntent(first, false, false);

    const firstSuccess = settleVersionedIntent(second, first.version, true, true);
    const secondFailure = settleVersionedIntent(
      firstSuccess.next!,
      second.version,
      false,
      false,
    );

    expect(secondFailure.rollbackTo).toBe(true);
  });
});

describe('keyed operation queue', () => {
  it('serializes operations for the same chat', async () => {
    const queue = createKeyedOperationQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.enqueue('chat-1', async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
    });
    const second = queue.enqueue('chat-1', async () => {
      events.push('second-start');
      events.push('second-end');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('continues the queue after an operation rejects', async () => {
    const queue = createKeyedOperationQueue();
    const events: string[] = [];

    const failed = queue.enqueue('chat-1', async () => {
      events.push('failed');
      throw new Error('network');
    });
    const recovered = queue.enqueue('chat-1', async () => {
      events.push('recovered');
      return true;
    });

    await expect(failed).rejects.toThrow('network');
    await expect(recovered).resolves.toBe(true);
    expect(events).toEqual(['failed', 'recovered']);
  });
});

describe('chat feedback queue', () => {
  it('preserves each delete undo and keeps errors as dismiss-only entries', () => {
    const firstDelete: ChatListFeedback<{ id: string }> = {
      id: 'feedback-1',
      kind: 'delete',
      message: 'One was removed.',
      chatName: 'One',
      snapshot: { item: { id: 'one' }, index: 0 },
    };
    const error: ChatListFeedback<{ id: string }> = {
      id: 'feedback-2',
      kind: 'error',
      message: "Couldn't update that chat.",
    };
    const secondDelete: ChatListFeedback<{ id: string }> = {
      id: 'feedback-3',
      kind: 'delete',
      message: 'Two was removed.',
      chatName: 'Two',
      snapshot: { item: { id: 'two' }, index: 1 },
    };

    const queue = [firstDelete, error, secondDelete].reduce(
      enqueueChatFeedback,
      [] as ChatListFeedback<{ id: string }>[],
    );

    expect(queue.map((feedback) => feedback.kind)).toEqual(['delete', 'error', 'delete']);
    expect(dismissActiveChatFeedback(queue)[0]).toBe(error);
  });
});
