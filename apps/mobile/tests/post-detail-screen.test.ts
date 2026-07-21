import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postMocks = vi.hoisted(() => ({
  createComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  editPost: vi.fn(),
  deletePost: vi.fn(),
  toggleLike: vi.fn(),
}));

vi.mock('@/hooks/usePosts', () => ({
  usePosts: () => ({
    posts: [{
      id: 'event-1',
      user_id: 'user-1',
      content: 'A mounted post for composer testing.',
      created_at: '2026-07-21T12:00:00.000Z',
      users: {
        first_name: 'Demo',
        last_name: 'Student',
        avatar_url: null,
        role: 'student',
      },
      attachments: [],
      liked: false,
      like_count: 0,
      view_count: 1,
    }],
    loading: false,
    editPost: postMocks.editPost,
    deletePost: postMocks.deletePost,
    toggleLike: postMocks.toggleLike,
  }),
}));

vi.mock('@/hooks/useComments', () => ({
  useComments: () => ({
    comments: [],
    loading: false,
    createComment: postMocks.createComment,
    editComment: postMocks.editComment,
    deleteComment: postMocks.deleteComment,
  }),
}));

vi.mock('@/components/RoleBadge', () => ({ RoleBadge: () => null }));
vi.mock('@/components/PostAttachments', () => ({ PostAttachments: () => null }));

import { mockState as mocks } from './event-detail-dependencies.mock';
import { PostDetailScreen } from '@/screens/PostDetailScreen';

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

function findByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find((node) => node.props.accessibilityLabel === label);
}

const mountedRenderers: ReactTestRenderer[] = [];
let alertSpy: ReturnType<typeof vi.spyOn>;

async function renderScreen() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PostDetailScreen, { role: 'student' }), {
      createNodeMock: (element) => (
        element.props.accessibilityLabel === 'Comment' ? { focus: mocks.inputFocus } : {}
      ),
    });
  });
  mountedRenderers.push(renderer);
  return renderer;
}

beforeEach(() => {
  mocks.routeId = 'event-1';
  mocks.auth.session.user.id = 'user-1';
  mocks.auth.userRole = 'student';
  mocks.inputFocus.mockReset();
  postMocks.createComment.mockReset();
  postMocks.editComment.mockReset();
  postMocks.deleteComment.mockReset();
  postMocks.editPost.mockReset();
  postMocks.deletePost.mockReset();
  postMocks.toggleLike.mockReset();
  postMocks.toggleLike.mockResolvedValue(undefined);
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockReset();
  alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
  alertSpy.mockRestore();
});

describe('PostDetailScreen comment composer', () => {
  it('matches event behavior for duplicate sends and newer in-flight drafts', async () => {
    const request = deferred<void>();
    postMocks.createComment.mockImplementation(() => request.promise);
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('First draft'));
    const send = findByLabel(renderer, 'Post comment').props.onPress;
    let pending!: Promise<void>;
    act(() => {
      pending = send();
      send();
    });

    expect(postMocks.createComment).toHaveBeenCalledTimes(1);
    expect(postMocks.createComment).toHaveBeenCalledWith('user-1', 'First draft');
    expect(findByLabel(renderer, 'Post comment').props.loading).toBe(true);

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Newer draft'));
    await act(async () => {
      request.resolve(undefined);
      await pending;
    });

    expect(findByLabel(renderer, 'Comment').props.value).toBe('Newer draft');
    expect(mocks.inputFocus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await findByLabel(renderer, 'Post comment').props.onPress();
    });
    expect(findByLabel(renderer, 'Comment').props.value).toBe('');
    expect(mocks.inputFocus).toHaveBeenCalledTimes(2);
  });

  it('retains a failed comment and announces the error', async () => {
    const request = deferred<void>();
    postMocks.createComment.mockImplementation(() => request.promise);
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Keep this'));
    let pending!: Promise<void>;
    act(() => { pending = findByLabel(renderer, 'Post comment').props.onPress(); });
    await act(async () => {
      request.reject(new Error('offline'));
      await pending;
    });

    expect(findByLabel(renderer, 'Comment').props.value).toBe('Keep this');
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to post comment');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Failed to post comment.',
    );
    expect(mocks.inputFocus).not.toHaveBeenCalled();
  });
});
