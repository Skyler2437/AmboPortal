import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/reportOperationError', () => ({ reportOperationError: state.report }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: state.rpc,
  from: (table: string) => {
    const query = { eq: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data:
        table === 'event_rsvps' ? [{ user_id: 'user-1', status: 'maybe', users: { first_name: 'Test' } }]
        : table === 'event_rsvp_explanations' ? [{ user_id: 'user-1', explanation: 'A'.repeat(50) }] : [], error: null }).then(resolve) };
    return { select: () => query, delete: () => ({ eq: () => ({ eq: state.remove }) }) };
  },
} }));
import { useEventDetail } from '../src/hooks/useEventDetail';
let current: ReturnType<typeof useEventDetail>;
let renderer: ReactTestRenderer;
function Harness() { current = useEventDetail('event-1', 'user-1'); return null; }
beforeEach(async () => {
  vi.clearAllMocks();
  await act(async () => { renderer = create(React.createElement(Harness)); });
});
afterEach(() => act(() => renderer.unmount()));
it.each(['returned', 'thrown'])('restores the RSVP and reports a %s save failure', async kind => {
  const error = { code: '42501', message: 'Private database detail' };
  if (kind === 'returned') state.rpc.mockResolvedValue({ error });
  else state.rpc.mockRejectedValue(new TypeError('Network request failed'));
  let result: unknown;
  await act(async () => { result = await current.updateRsvp('going'); });
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toContain('try again');
  expect(current.myRsvp).toBe('maybe');
  expect(current.myRsvpExplanation).toBe('A'.repeat(50));
  expect(state.report).toHaveBeenCalledWith('rsvp.save', expect.anything());
});
it('restores a removed RSVP and its explanation when the connection fails', async () => {
  state.remove.mockRejectedValue(new TypeError('Network request failed'));
  let result: unknown;
  await act(async () => { result = await current.removeRsvp(); });
  expect(result).toBeInstanceOf(Error);
  expect(current.myRsvp).toBe('maybe');
  expect(current.myRsvpExplanation).toBe('A'.repeat(50));
  expect(state.report).toHaveBeenCalledWith('rsvp.remove', expect.anything());
});
