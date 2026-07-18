export interface ReadAcknowledgementQueue {
  acknowledge: () => Promise<boolean>;
}

/** PostgREST OR filter that makes last_read_at monotonic across devices. */
export function getMonotonicReadFilter(readAt: string): string {
  return `last_read_at.is.null,last_read_at.lt.${readAt}`;
}

interface ReadAcknowledgementBatch {
  readAt: string;
  resolve: Array<(persisted: boolean) => void>;
}

/**
 * Serializes read-receipt writes so an older timestamp can never arrive after
 * and overwrite a newer one. Calls made during a write are coalesced into one
 * follow-up write using the newest strictly-monotonic timestamp.
 */
export function createReadAcknowledgementQueue(
  persist: (readAt: string) => Promise<boolean>,
  now: () => number = Date.now,
): ReadAcknowledgementQueue {
  let active = false;
  let queued: ReadAcknowledgementBatch | null = null;
  let lastIssuedTimestamp = 0;

  const nextReadAt = () => {
    const timestamp = Math.max(now(), lastIssuedTimestamp + 1);
    lastIssuedTimestamp = timestamp;
    return new Date(timestamp).toISOString();
  };

  const run = async (batch: ReadAcknowledgementBatch) => {
    active = true;
    let persisted = false;
    try {
      persisted = await persist(batch.readAt);
    } catch {
      persisted = false;
    }

    batch.resolve.forEach((resolve) => resolve(persisted));

    const next = queued;
    queued = null;
    if (next) {
      void run(next);
    } else {
      active = false;
    }
  };

  return {
    acknowledge: () => new Promise<boolean>((resolve) => {
      const readAt = nextReadAt();
      if (!active) {
        void run({ readAt, resolve: [resolve] });
        return;
      }

      if (queued) {
        queued.readAt = readAt;
        queued.resolve.push(resolve);
      } else {
        queued = { readAt, resolve: [resolve] };
      }
    }),
  };
}
