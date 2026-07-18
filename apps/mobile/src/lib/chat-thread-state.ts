import type { AppStateStatus } from 'react-native';
import type { ChatMessage } from './chat-message-state';
import { isPersistedChatMessage } from './chat-message-state';
import { getMessageDateKey } from './format';

export interface ThreadReadState {
  isFocused: boolean;
  appState: AppStateStatus;
  isNearBottom: boolean;
  hasPresentedLatestIncoming: boolean;
  latestMessageIsOwn: boolean;
  latestMessageId?: string;
  lastMarkedMessageId?: string;
}

export interface ThreadReadAttempt {
  groupId: string;
  messageId: string;
  version: number;
}

export type ThreadReadAttemptResolution = 'ignore' | 'confirmed' | 'failed';

export interface ThreadReadAttemptTracker {
  begin: (groupId: string, messageId: string) => ThreadReadAttempt;
  resolve: (
    attempt: ThreadReadAttempt,
    persisted: boolean,
  ) => ThreadReadAttemptResolution;
  cancel: (groupId: string) => boolean;
}

export type ThreadEndScrollMode = 'instant' | 'animated';

export interface ThreadEndFollower {
  reset: () => void;
  schedule: (mode: ThreadEndScrollMode) => void;
  stop: () => void;
  contentSizeChanged: (hasMessages: boolean) => ThreadEndScrollMode | null;
}

/** Returns the native scroll offset for the fully measured end of the list. */
export function getThreadEndOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight);
}

/**
 * Keeps a chat pinned to its end through every layout pass. A newly rendered
 * bubble can change height more than once (for example when a different sender
 * adds a name, avatar, and timestamp), so content-size notifications must not
 * consume the follow instruction after the first measurement.
 */
export function createThreadEndFollower(): ThreadEndFollower {
  let mode: ThreadEndScrollMode | null = 'instant';

  return {
    reset: () => {
      mode = 'instant';
    },
    schedule: (nextMode) => {
      mode = nextMode;
    },
    stop: () => {
      mode = null;
    },
    contentSizeChanged: (hasMessages) => hasMessages ? mode : null,
  };
}

/** Keeps async read completions scoped to the newest optimistic attempt. */
export function createThreadReadAttemptTracker(): ThreadReadAttemptTracker {
  let nextVersion = 0;
  let pending: ThreadReadAttempt | null = null;

  const isCurrent = (attempt: ThreadReadAttempt) => Boolean(
    pending &&
      pending.version === attempt.version &&
      pending.groupId === attempt.groupId &&
      pending.messageId === attempt.messageId,
  );

  return {
    begin: (groupId, messageId) => {
      const attempt = { groupId, messageId, version: ++nextVersion };
      pending = attempt;
      return attempt;
    },
    resolve: (attempt, persisted) => {
      if (!isCurrent(attempt)) return 'ignore';
      pending = null;
      return persisted ? 'confirmed' : 'failed';
    },
    cancel: (groupId) => {
      if (!pending || pending.groupId !== groupId) return false;
      pending = null;
      return true;
    },
  };
}

export function shouldMarkThreadRead({
  isFocused,
  appState,
  isNearBottom,
  hasPresentedLatestIncoming,
  latestMessageIsOwn,
  latestMessageId,
  lastMarkedMessageId,
}: ThreadReadState): boolean {
  return Boolean(
    isFocused &&
      appState === 'active' &&
      isNearBottom &&
      (hasPresentedLatestIncoming || latestMessageIsOwn) &&
      latestMessageId &&
      latestMessageId !== lastMarkedMessageId,
  );
}

export interface ThreadSyncWarningState {
  messageCount: number;
  hasLoadError: boolean;
  hasConnectionError: boolean;
}

export function shouldShowThreadSyncWarning({
  messageCount,
  hasLoadError,
  hasConnectionError,
}: ThreadSyncWarningState): boolean {
  return hasConnectionError || (messageCount > 0 && hasLoadError);
}

/** Counts messages that arrived after the point the user last saw at bottom. */
export function countUnseenIncomingMessages(
  messages: ChatMessage[],
  currentUserId: string,
  anchorMessageId?: string,
): number {
  if (!anchorMessageId) return 0;
  const anchorIndex = messages.findIndex((message) => message.id === anchorMessageId);
  if (anchorIndex < 0) return 0;

  return messages.slice(anchorIndex + 1).filter(
    (message) =>
      message.sender_id !== currentUserId &&
      isPersistedChatMessage(message),
  ).length;
}

export type MessageGroupPosition = 'single' | 'first' | 'middle' | 'last';

export interface MessageGroupPresentation {
  position: MessageGroupPosition;
  showSenderName: boolean;
  showAvatar: boolean;
  showMeta: boolean;
  showSentStatus: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function isSameMessageGroup(first?: ChatMessage, second?: ChatMessage): boolean {
  if (!first || !second || first.sender_id !== second.sender_id) return false;

  const firstTime = new Date(first.created_at);
  const secondTime = new Date(second.created_at);
  const gap = secondTime.getTime() - firstTime.getTime();
  const sameDate = getMessageDateKey(first.created_at) === getMessageDateKey(second.created_at);
  return sameDate && gap >= 0 && gap <= GROUP_WINDOW_MS;
}

export function getMessageGroupPresentation(
  messages: ChatMessage[],
  index: number,
  currentUserId: string,
): MessageGroupPresentation {
  const message = messages[index];
  const groupedWithPrevious = isSameMessageGroup(messages[index - 1], message);
  const groupedWithNext = isSameMessageGroup(message, messages[index + 1]);

  let position: MessageGroupPosition = 'single';
  if (!groupedWithPrevious && groupedWithNext) position = 'first';
  if (groupedWithPrevious && groupedWithNext) position = 'middle';
  if (groupedWithPrevious && !groupedWithNext) position = 'last';

  const isOwn = message.sender_id === currentUserId;
  const latestOwnIndex = messages.findLastIndex((candidate) => candidate.sender_id === currentUserId);
  const hasImportantStatus = message.status === 'sending' || message.status === 'failed';

  return {
    position,
    showSenderName: !isOwn && !groupedWithPrevious,
    showAvatar: !isOwn && !groupedWithNext,
    showMeta: !groupedWithNext || hasImportantStatus,
    showSentStatus: isOwn && message.status === 'sent' && index === latestOwnIndex,
  };
}
