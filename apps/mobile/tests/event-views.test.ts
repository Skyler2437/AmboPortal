import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

import { mockState } from './event-detail-dependencies.mock';
import { loadPresentUsers, useEventViews } from '../src/hooks/useEventViews';

const mountedRenderers: ReactTestRenderer[] = [];

function renderRealHook<Props extends object, Result>(
  hook: (props: Props) => Result,
  initialProps: Props,
) {
  let current!: Result;

  function Harness(props: Props) {
    current = hook(props);
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Harness, initialProps));
  });
  mountedRenderers.push(renderer);

  return {
    result: {
      get current() {
        return current;
      },
    },
    rerender(nextProps: Props) {
      act(() => {
        renderer.update(React.createElement(Harness, nextProps));
      });
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useEventViews', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mockState.supabaseFrom.mockImplementation((...args: unknown[]) => mocks.from(...args));
    vi.stubGlobal('__DEV__', false);
  });

  it('quarantines the previous count as soon as the event ID changes', async () => {
    const eventOne = deferred<{ data: null; count: number; error: null }>();
    const eventTwo = deferred<{ data: null; count: number; error: null }>();
    const countRequests = new Map([
      ['event-1', eventOne.promise],
      ['event-2', eventTwo.promise],
    ]);
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: (_column: string, eventId: string) => countRequests.get(eventId),
      }),
    }));

    const { result, rerender } = renderRealHook(
      ({ eventId }) => useEventViews(eventId, 'user-1'),
      { eventId: 'event-1' },
    );

    await act(async () => {
      eventOne.resolve({ data: null, count: 8, error: null });
      await eventOne.promise;
    });
    expect(result.current.viewCount).toBe(8);

    rerender({ eventId: 'event-2' });

    expect(result.current.viewCount).toBe(0);

    await act(async () => {
      eventTwo.resolve({ data: null, count: 2, error: null });
      await eventTwo.promise;
    });
    expect(result.current.viewCount).toBe(2);
  });

  it('ignores an out-of-order count response owned by the previous event', async () => {
    const eventOne = deferred<{ data: null; count: number; error: null }>();
    const eventTwo = deferred<{ data: null; count: number; error: null }>();
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: (_column: string, eventId: string) => (
          eventId === 'event-1' ? eventOne.promise : eventTwo.promise
        ),
      }),
    }));

    const { result, rerender } = renderRealHook(
      ({ eventId }) => useEventViews(eventId, 'user-1'),
      { eventId: 'event-1' },
    );

    rerender({ eventId: 'event-2' });
    await act(async () => {
      eventTwo.resolve({ data: null, count: 3, error: null });
      await eventTwo.promise;
    });
    expect(result.current.viewCount).toBe(3);

    await act(async () => {
      eventOne.resolve({ data: null, count: 99, error: null });
      await eventOne.promise;
    });

    expect(result.current.viewCount).toBe(3);
  });

  it('keeps the committed event request valid when a suspended transition is abandoned', async () => {
    const committedCount = deferred<{ data: null; count: number; error: null }>();
    const abandonedRender = deferred<void>();
    const neverCompletes = new Promise<never>(() => undefined);
    let eventOneCalls = 0;
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: (_column: string, eventId: string) => {
          if (eventId === 'event-1') {
            eventOneCalls += 1;
            return eventOneCalls === 1 ? committedCount.promise : neverCompletes;
          }
          return Promise.resolve({ data: null, count: 2, error: null });
        },
      }),
    }));

    function Harness({ eventId, suspend }: { eventId: string; suspend: boolean }) {
      const { viewCount } = useEventViews(eventId, 'user-1');
      if (suspend) throw abandonedRender.promise;
      return React.createElement('ViewCount', { value: viewCount });
    }

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(Harness, { eventId: 'event-1', suspend: false }),
        ),
        { unstable_isConcurrent: true },
      );
      await Promise.resolve();
    });
    mountedRenderers.push(renderer);

    await act(async () => {
      React.startTransition(() => {
        renderer.update(React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(Harness, { eventId: 'event-2', suspend: true }),
        ));
      });
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(Harness, { eventId: 'event-1', suspend: false }),
      ));
      await Promise.resolve();
    });

    await act(async () => {
      committedCount.resolve({ data: null, count: 8, error: null });
      await committedCount.promise;
    });

    expect(renderer.root.find((node) => node.type === 'ViewCount').props.value).toBe(8);
  });

  it('does not let a delayed view recording refresh overwrite the next event count', async () => {
    const recordEventOne = deferred<{ data: null; error: null }>();
    const eventOneRefresh = deferred<{ data: null; count: number; error: null }>();
    const countCalls = new Map<string, number>();
    const upsert = vi.fn(() => recordEventOne.promise);

    mocks.from.mockImplementation((table: string) => {
      if (table !== 'event_views') throw new Error(`Unexpected table: ${table}`);
      return {
        upsert,
        select: () => ({
          eq: (_column: string, eventId: string) => {
            const call = countCalls.get(eventId) ?? 0;
            countCalls.set(eventId, call + 1);
            if (eventId === 'event-1' && call === 0) {
              return Promise.resolve({ data: null, count: 1, error: null });
            }
            if (eventId === 'event-1') return eventOneRefresh.promise;
            return Promise.resolve({ data: null, count: 4, error: null });
          },
        }),
      };
    });

    const { result, rerender } = renderRealHook(
      ({ eventId }) => useEventViews(eventId, 'user-1'),
      { eventId: 'event-1' },
    );
    await flushEffects();
    expect(result.current.viewCount).toBe(1);

    let recordPromise!: Promise<void>;
    act(() => {
      recordPromise = result.current.recordView();
    });
    expect(upsert).toHaveBeenCalledTimes(1);

    rerender({ eventId: 'event-2' });
    await flushEffects();
    expect(result.current.viewCount).toBe(4);

    await act(async () => {
      recordEventOne.resolve({ data: null, error: null });
      await recordEventOne.promise;
      eventOneRefresh.resolve({ data: null, count: 77, error: null });
      await recordPromise;
    });

    expect(result.current.viewCount).toBe(4);
  });

  it('keeps the newest same-event count when the initial request resolves last', async () => {
    const initialCount = deferred<{ data: null; count: number; error: null }>();
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    let countCall = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table !== 'event_views') throw new Error(`Unexpected table: ${table}`);
      return {
        upsert,
        select: () => ({
          eq: () => {
            countCall += 1;
            return countCall === 1
              ? initialCount.promise
              : Promise.resolve({ data: null, count: 2, error: null });
          },
        }),
      };
    });

    const { result } = renderRealHook(() => useEventViews('event-1', 'user-1'), {});

    await act(async () => {
      await result.current.recordView();
    });
    expect(result.current.viewCount).toBe(2);

    await act(async () => {
      initialCount.resolve({ data: null, count: 1, error: null });
      await initialCount.promise;
    });

    expect(result.current.viewCount).toBe(2);
  });

  it('upserts a detail viewer at most once per event and user', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.from.mockImplementation(() => ({
      upsert,
      select: () => ({
        eq: () => Promise.resolve({ data: null, count: 7, error: null }),
      }),
    }));

    const { result } = renderRealHook(() => useEventViews('event-1', 'user-1'), {});
    await flushEffects();
    expect(result.current.viewCount).toBe(7);

    await act(async () => {
      await result.current.recordView();
      await result.current.recordView();
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      { event_id: 'event-1', user_id: 'user-1' },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true },
    );
  });

  it('loads viewer profiles newest first and throws query failures to the caller', async () => {
    const firstOrder = vi.fn().mockResolvedValue({
      data: [
        { users: { id: 'user-2', first_name: 'Maya', last_name: 'Chen', avatar_url: null } },
        { users: null },
      ],
      error: null,
    });
    const queryError = new Error('viewer query failed');
    const secondOrder = vi.fn().mockResolvedValue({ data: null, error: queryError });
    let viewerCall = 0;
    mocks.from.mockImplementation(() => ({
      select: (_columns: string, options?: unknown) => {
        if (options) {
          return { eq: () => Promise.resolve({ data: null, count: 0, error: null }) };
        }
        return {
          eq: () => ({ order: viewerCall++ === 0 ? firstOrder : secondOrder }),
        };
      },
    }));

    const { result } = renderRealHook(() => useEventViews('event-1', 'user-1'), {});
    await flushEffects();

    await expect(result.current.loadViewers()).resolves.toEqual([
      { id: 'user-2', first_name: 'Maya', last_name: 'Chen', avatar_url: undefined },
    ]);
    await expect(result.current.loadViewers()).rejects.toBe(queryError);
    expect(firstOrder).toHaveBeenCalledWith('viewed_at', { ascending: false });
  });
});

describe('loadPresentUsers', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mockState.supabaseFrom.mockImplementation((...args: unknown[]) => mocks.from(...args));
  });

  it('queries only present attendance and only public profile fields', async () => {
    const statusEq = vi.fn().mockResolvedValue({
      data: [
        { users: { id: 'user-3', first_name: 'Sam', last_name: 'Patel', avatar_url: null } },
        { users: null },
      ],
      error: null,
    });
    const eventEq = vi.fn(() => ({ eq: statusEq }));
    const select = vi.fn(() => ({ eq: eventEq }));
    mocks.from.mockReturnValueOnce({ select });

    await expect(loadPresentUsers('event-1')).resolves.toEqual([
      { id: 'user-3', first_name: 'Sam', last_name: 'Patel', avatar_url: undefined },
    ]);
    expect(mocks.from).toHaveBeenCalledWith('event_attendance');
    expect(select).toHaveBeenCalledWith(
      'users:users!event_attendance_user_id_fkey(id, first_name, last_name, avatar_url)',
    );
    expect(eventEq).toHaveBeenCalledWith('event_id', 'event-1');
    expect(statusEq).toHaveBeenCalledWith('status', 'present');
  });

  it('throws Present-list query failures to the detail caller', async () => {
    const queryError = new Error('attendance query failed');
    const statusEq = vi.fn().mockResolvedValue({ data: null, error: queryError });
    const eventEq = vi.fn(() => ({ eq: statusEq }));
    const select = vi.fn(() => ({ eq: eventEq }));
    mocks.from.mockReturnValueOnce({ select });

    await expect(loadPresentUsers('event-1')).rejects.toBe(queryError);
  });
});
