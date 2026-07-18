import { describe, expect, it } from 'vitest';
import {
  createReadAcknowledgementQueue,
  getMonotonicReadFilter,
} from '@/lib/chat-read-acknowledgement';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('createReadAcknowledgementQueue', () => {
  it('serializes writes and coalesces queued acknowledgements to the newest timestamp', async () => {
    const firstWrite = deferred<boolean>();
    const secondWrite = deferred<boolean>();
    const persistedAt: string[] = [];
    const queue = createReadAcknowledgementQueue(
      (readAt) => {
        persistedAt.push(readAt);
        return persistedAt.length === 1 ? firstWrite.promise : secondWrite.promise;
      },
      () => 1000,
    );

    const first = queue.acknowledge();
    const second = queue.acknowledge();
    const third = queue.acknowledge();

    expect(persistedAt).toEqual([new Date(1000).toISOString()]);

    firstWrite.resolve(true);
    await first;
    await Promise.resolve();

    expect(persistedAt).toEqual([
      new Date(1000).toISOString(),
      new Date(1002).toISOString(),
    ]);

    secondWrite.resolve(true);
    await expect(Promise.all([second, third])).resolves.toEqual([true, true]);
  });

  it('continues with the queued acknowledgement after an earlier write fails', async () => {
    const firstWrite = deferred<boolean>();
    const persistedAt: string[] = [];
    const queue = createReadAcknowledgementQueue(
      async (readAt) => {
        persistedAt.push(readAt);
        if (persistedAt.length === 1) return firstWrite.promise;
        return true;
      },
      () => 2000,
    );

    const first = queue.acknowledge();
    const second = queue.acknowledge();
    firstWrite.resolve(false);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(persistedAt).toEqual([
      new Date(2000).toISOString(),
      new Date(2001).toISOString(),
    ]);
  });
});

describe('getMonotonicReadFilter', () => {
  it('only matches an unread row or a read timestamp older than this acknowledgement', () => {
    expect(getMonotonicReadFilter('2026-07-16T14:30:00.123Z')).toBe(
      'last_read_at.is.null,last_read_at.lt.2026-07-16T14:30:00.123Z',
    );
  });
});
