import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/communityPosts', () => ({ communityRequest: requests.request }));
vi.mock('expo-router', async importOriginal => ({
  ...await importOriginal<object>(),
  useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
}));
import { PostPoll } from '@/components/PostPoll';

let renderer: ReactTestRenderer;
afterEach(async () => { await act(async () => renderer?.unmount()); requests.request.mockReset(); });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}
const initial = { post_id: 'post', closes_at: null, closed: false, options: [{ id: 'a', label: 'Monday', votes: 0 }, { id: 'b', label: 'Tuesday', votes: 0 }], total_votes: 0, my_option_id: null };
const refresh = () => renderer.root.find(node => node.type === 'Button' && node.props.children === 'Refresh results');
const option = () => renderer.root.find(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel.startsWith('Tuesday'));
const event = { stopPropagation() {} };
it('ignores a refresh that resolves after a confirmed vote and blocks reads during voting', async () => {
  const oldRead = deferred();
  const vote = deferred();
  requests.request.mockResolvedValueOnce({ poll: initial }).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(vote.promise);
  await act(async () => { renderer = create(React.createElement(PostPoll, { postId: 'post' })); });
  await act(async () => { refresh().props.onPress(event); });
  await act(async () => { option().props.onPress(event); });
  expect(refresh().props.disabled).toBe(true);
  await act(async () => { refresh().props.onPress(event); });
  expect(requests.request).toHaveBeenCalledTimes(3);
  await act(async () => { vote.resolve({ poll: { ...initial, my_option_id: 'b', total_votes: 1, options: [initial.options[0], { ...initial.options[1], votes: 1 }] } }); });
  expect(option().props.accessibilityState.checked).toBe(true);
  await act(async () => { oldRead.resolve({ poll: initial }); });
  expect(option().props.accessibilityState.checked).toBe(true);
  expect(refresh().props.disabled).toBe(false);
});
