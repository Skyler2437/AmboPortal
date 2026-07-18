export interface ChatListParticipant {
  user_id: string;
  users: {
    first_name: string;
    last_name: string;
    avatar_url?: string;
  };
}

export interface ChatListMessage {
  id?: string;
  content: string;
  created_at: string;
  sender_id?: string;
}

export interface ChatListGroup {
  name: string | null;
  participants: ChatListParticipant[];
  lastMessage?: ChatListMessage;
}

export interface ChatListStateGroup {
  id: string;
  lastMessage?: ChatListMessage;
  hasUnread?: boolean;
  starred?: boolean;
}

export interface ChatDeletionSnapshot<T extends { id: string }> {
  item: T;
  index: number;
  beforeId?: string | null;
  afterId?: string | null;
}

export type ChatListFeedback<T extends { id: string }> =
  | {
      id: string;
      kind: 'delete';
      message: string;
      chatName: string;
      snapshot: ChatDeletionSnapshot<T>;
    }
  | {
      id: string;
      kind: 'error';
      message: string;
    };

export interface KeyedOperationQueue {
  enqueue<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export type ChatVisibilityIntent = 'visible' | 'deleted';

export interface VersionedIntent<T> {
  version: number;
  confirmed: T;
  intent: T;
}

export interface VersionedIntentResolution<T> {
  next: VersionedIntent<T> | null;
  isLatest: boolean;
  rollbackTo?: T;
}

export interface ChatListRequestIdentity {
  userId: string;
  generation: number;
  requestId: number;
}

interface MergeFetchedChatGroupsOptions {
  changedIds?: ReadonlySet<string>;
  starIntents?: ReadonlyMap<string, boolean>;
  visibilityIntents?: ReadonlyMap<string, ChatVisibilityIntent>;
}

function compareMessageOrder(first?: ChatListMessage, second?: ChatListMessage): number {
  if (!first) return second ? -1 : 0;
  if (!second) return 1;
  const timeDifference = new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
  if (timeDifference !== 0) return timeDifference;
  return (first.id ?? '').localeCompare(second.id ?? '');
}

export function isCurrentChatListRequest(
  current: ChatListRequestIdentity,
  requested: ChatListRequestIdentity,
): boolean {
  return current.userId === requested.userId &&
    current.generation === requested.generation &&
    current.requestId === requested.requestId;
}

export function applyIncomingChatMessage<T extends ChatListStateGroup>(
  group: T,
  incoming: Required<Pick<ChatListMessage, 'content' | 'created_at'>> & {
    id: string;
    sender_id: string;
  },
  currentUserId: string,
): T {
  const incomingIsLatest = compareMessageOrder(incoming, group.lastMessage) > 0;
  const becomesUnread = incoming.sender_id !== currentUserId;
  if (!incomingIsLatest && (!becomesUnread || group.hasUnread)) return group;

  return {
    ...group,
    lastMessage: incomingIsLatest ? incoming : group.lastMessage,
    hasUnread: becomesUnread ? true : group.hasUnread,
  };
}

export function mergeFetchedChatGroups<T extends ChatListStateGroup>(
  current: T[],
  fetched: T[],
  options: MergeFetchedChatGroupsOptions = {},
): T[] {
  const changedIds = options.changedIds ?? new Set<string>();
  const starIntents = options.starIntents ?? new Map<string, boolean>();
  const visibilityIntents = options.visibilityIntents ?? new Map<string, ChatVisibilityIntent>();
  const currentById = new Map(current.map((group) => [group.id, group]));
  const fetchedById = new Map(fetched.map((group) => [group.id, group]));
  const orderedIds = [
    ...fetched.map((group) => group.id),
    ...current.filter((group) => !fetchedById.has(group.id)).map((group) => group.id),
  ];

  const merged: T[] = [];
  for (const id of orderedIds) {
    const visibilityIntent = visibilityIntents.get(id);
    if (visibilityIntent === 'deleted') continue;

    const currentGroup = currentById.get(id);
    const fetchedGroup = fetchedById.get(id);
    const changedDuringFetch = changedIds.has(id);

    if (!currentGroup) {
      if (!fetchedGroup || changedDuringFetch) continue;
      const starIntent = starIntents.get(id);
      merged.push(starIntent === undefined
        ? fetchedGroup
        : { ...fetchedGroup, starred: starIntent });
      continue;
    }

    if (!fetchedGroup) {
      if (changedDuringFetch || visibilityIntent === 'visible') merged.push(currentGroup);
      continue;
    }

    const currentMessageIsNewer = compareMessageOrder(
      currentGroup.lastMessage,
      fetchedGroup.lastMessage,
    ) > 0;
    const preserveCurrentState = changedDuringFetch || visibilityIntent === 'visible';
    const starIntent = starIntents.get(id);
    merged.push({
      ...fetchedGroup,
      lastMessage: currentMessageIsNewer ? currentGroup.lastMessage : fetchedGroup.lastMessage,
      hasUnread: preserveCurrentState || currentMessageIsNewer
        ? currentGroup.hasUnread
        : fetchedGroup.hasUnread,
      starred: starIntent ?? (preserveCurrentState
        ? currentGroup.starred
        : fetchedGroup.starred),
    });
  }

  return merged;
}

export function beginVersionedIntent<T>(
  previous: VersionedIntent<T> | undefined,
  confirmed: T,
  intent: T,
): VersionedIntent<T> {
  return {
    version: (previous?.version ?? 0) + 1,
    confirmed: previous?.confirmed ?? confirmed,
    intent,
  };
}

export function settleVersionedIntent<T>(
  current: VersionedIntent<T>,
  operationVersion: number,
  operationIntent: T,
  succeeded: boolean,
): VersionedIntentResolution<T> {
  if (operationVersion !== current.version) {
    return {
      next: succeeded ? { ...current, confirmed: operationIntent } : current,
      isLatest: false,
    };
  }

  return {
    next: null,
    isLatest: true,
    rollbackTo: succeeded ? undefined : current.confirmed,
  };
}

export function removeChatWithSnapshot<T extends { id: string }>(
  items: T[],
  chatId: string,
): { items: T[]; snapshot: ChatDeletionSnapshot<T> | null } {
  const index = items.findIndex((item) => item.id === chatId);
  if (index < 0) return { items, snapshot: null };

  return {
    items: [...items.slice(0, index), ...items.slice(index + 1)],
    snapshot: {
      item: items[index],
      index,
      beforeId: items[index - 1]?.id ?? null,
      afterId: items[index + 1]?.id ?? null,
    },
  };
}

export function restoreChatSnapshot<T extends { id: string }>(
  items: T[],
  snapshot: ChatDeletionSnapshot<T>,
): T[] {
  if (items.some((item) => item.id === snapshot.item.id)) return items;

  const afterIndex = snapshot.afterId
    ? items.findIndex((item) => item.id === snapshot.afterId)
    : -1;
  const beforeIndex = snapshot.beforeId
    ? items.findIndex((item) => item.id === snapshot.beforeId)
    : -1;
  const index = afterIndex >= 0
    ? afterIndex
    : beforeIndex >= 0
      ? beforeIndex + 1
      : Math.min(Math.max(snapshot.index, 0), items.length);
  return [...items.slice(0, index), snapshot.item, ...items.slice(index)];
}

export function rollbackRestoredChatSnapshot<T extends { id: string }>(
  items: T[],
  snapshot: ChatDeletionSnapshot<T>,
): T[] {
  const restoredIndex = items.findIndex((item) => item.id === snapshot.item.id);
  if (restoredIndex < 0 || items[restoredIndex] !== snapshot.item) return items;
  return [...items.slice(0, restoredIndex), ...items.slice(restoredIndex + 1)];
}

export function getChatDeletionWatermark<
  T extends { id: string; lastMessage?: Pick<ChatListMessage, 'created_at'> },
>(
  snapshot: ChatDeletionSnapshot<T>,
  fallbackTimestamp: string,
): string {
  return snapshot.item.lastMessage?.created_at ?? fallbackTimestamp;
}

export function createKeyedOperationQueue(): KeyedOperationQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(operation);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(key, tail);
      void tail.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}

export function enqueueChatFeedback<T extends { id: string }>(
  queue: ChatListFeedback<T>[],
  feedback: ChatListFeedback<T>,
): ChatListFeedback<T>[] {
  return [...queue, feedback];
}

export function dismissActiveChatFeedback<T extends { id: string }>(
  queue: ChatListFeedback<T>[],
): ChatListFeedback<T>[] {
  return queue.slice(1);
}

export function getGroupDisplayName(group: ChatListGroup, currentUserId: string): string {
  if (group.name) return group.name;
  const others = group.participants
    .filter((participant) => participant.user_id !== currentUserId && participant.users)
    .map((participant) => participant.users.first_name);
  return others.length > 0 ? others.join(', ') : 'Chat';
}

export function getChatPreview(group: ChatListGroup, currentUserId: string): string {
  const message = group.lastMessage;
  if (!message) return 'No messages yet';
  if (message.sender_id === currentUserId) return `You: ${message.content}`;

  const otherParticipants = group.participants.filter(
    (participant) => participant.user_id !== currentUserId,
  );
  if (otherParticipants.length > 1) {
    const sender = group.participants.find(
      (participant) => participant.user_id === message.sender_id,
    );
    if (sender?.users.first_name) return `${sender.users.first_name}: ${message.content}`;
  }

  return message.content;
}
