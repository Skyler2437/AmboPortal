import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  from: vi.fn(),
  setViewCount: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => mocks.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
  useState: () => [0, mocks.setViewCount],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

import { loadPresentUsers, useEventViews } from '@/hooks/useEventViews';

describe('useEventViews', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.setViewCount.mockReset();
    mocks.effects.length = 0;
    vi.stubGlobal('__DEV__', false);
  });

  it('loads the aggregate count when the detail hook mounts', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, count: 4, error: null });
    const select = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValueOnce({ select });

    useEventViews('event-1', 'user-1');

    expect(mocks.effects).toHaveLength(1);
    mocks.effects[0]();
    await vi.waitFor(() => expect(mocks.setViewCount).toHaveBeenCalledWith(4));
  });

  it('upserts a detail viewer and refreshes the aggregate count', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockResolvedValue({ data: null, count: 7, error: null });
    const select = vi.fn(() => ({ eq }));
    mocks.from
      .mockReturnValueOnce({ upsert })
      .mockReturnValueOnce({ select });

    const { recordView } = useEventViews('event-1', 'user-1');

    await recordView();

    expect(upsert).toHaveBeenCalledWith(
      { event_id: 'event-1', user_id: 'user-1' },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true },
    );
    expect(select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(eq).toHaveBeenCalledWith('event_id', 'event-1');
    expect(mocks.setViewCount).toHaveBeenCalledWith(7);
  });

  it('records at most once for the mounted event and user', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockResolvedValue({ data: null, count: 1, error: null });
    const select = vi.fn(() => ({ eq }));
    mocks.from
      .mockReturnValueOnce({ upsert })
      .mockReturnValueOnce({ select });

    const { recordView } = useEventViews('event-1', 'user-1');

    await recordView();
    await recordView();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('loads viewer profiles newest first and omits missing relationships', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { users: { id: 'user-2', first_name: 'Maya', last_name: 'Chen', avatar_url: null } },
        { users: null },
      ],
      error: null,
    });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValueOnce({ select });

    const { loadViewers } = useEventViews('event-1', 'user-1');

    await expect(loadViewers()).resolves.toEqual([
      { id: 'user-2', first_name: 'Maya', last_name: 'Chen', avatar_url: undefined },
    ]);
    expect(select).toHaveBeenCalledWith('users(id, first_name, last_name, avatar_url)');
    expect(eq).toHaveBeenCalledWith('event_id', 'event-1');
    expect(order).toHaveBeenCalledWith('viewed_at', { ascending: false });
  });

  it('throws viewer query failures to the dialog caller', async () => {
    const queryError = new Error('viewer query failed');
    const order = vi.fn().mockResolvedValue({ data: null, error: queryError });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValueOnce({ select });

    const { loadViewers } = useEventViews('event-1', 'user-1');

    await expect(loadViewers()).rejects.toBe(queryError);
  });
});

describe('loadPresentUsers', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('queries only present attendance and returns public profile fields', async () => {
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
    expect(select).toHaveBeenCalledWith('users(id, first_name, last_name, avatar_url)');
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
