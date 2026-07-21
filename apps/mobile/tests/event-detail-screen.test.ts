import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { Alert } from 'react-native';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function testEvent(id: string, createdBy = 'organizer-1') {
  return {
    id,
    title: id === 'event-1' ? 'Campus Welcome' : 'Family Tour',
    description: 'Fabricated event details for a mounted screen test.',
    uniform: null,
    start_time: '2026-08-10T16:00:00.000Z',
    end_time: '2026-08-10T17:00:00.000Z',
    created_by: createdBy,
  };
}

import { mockState as mocks } from './event-detail-dependencies.mock';
import { EventDetailScreen } from '@/screens/EventDetailScreen';

const mountedRenderers: ReactTestRenderer[] = [];
let alertSpy: ReturnType<typeof vi.spyOn>;

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(role: 'student' | 'admin' = 'student') {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(EventDetailScreen, { role }));
    await Promise.resolve();
    await Promise.resolve();
  });
  mountedRenderers.push(renderer);
  return renderer;
}

async function rerenderScreen(renderer: ReactTestRenderer, role: 'student' | 'admin' = 'student') {
  await act(async () => {
    renderer.update(React.createElement(EventDetailScreen, { role }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === 'string' ? child : textContent(child))
    .join('');
}

function hasText(renderer: ReactTestRenderer, text: string) {
  return renderer.root.findAll((node) => (
    node.type === 'Text' && textContent(node) === text
  )).length > 0;
}

function findByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find((node) => node.props.accessibilityLabel === label);
}

function findAllByType(renderer: ReactTestRenderer, type: string) {
  return renderer.root.findAll((node) => node.type === type);
}

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
  alertSpy?.mockRestore();
});

beforeEach(() => {
  mocks.routeId = 'event-1';
  mocks.auth.session.user.id = 'user-1';
  mocks.auth.userRole = 'student';
  mocks.routerPush.mockReset();
  mocks.routerBack.mockReset();
  mocks.supabaseFrom.mockReset();
  mocks.supabaseFrom.mockImplementation((table: string) => {
    if (table !== 'events') throw new Error(`Unexpected table: ${table}`);
    return {
      select: () => ({
        eq: (_column: string, eventId: string) => ({
          single: () => {
            const request = mocks.eventRequests.get(eventId);
            if (!request) throw new Error(`Missing event request for ${eventId}`);
            return request;
          },
        }),
      }),
    };
  });
  alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mocks.eventRequests.clear();
  mocks.detailSuspensions.clear();
  mocks.presentRequests.clear();
  mocks.viewStates.clear();
  mocks.eventRequests.set('event-1', Promise.resolve({ data: testEvent('event-1'), error: null }));
  mocks.presentRequests.set('event-1', Promise.resolve([]));
  mocks.viewStates.set('event-1', {
    viewCount: 5,
    recordView: vi.fn().mockResolvedValue(undefined),
    loadViewers: vi.fn().mockResolvedValue([]),
  });
});

describe('EventDetailScreen engagement behavior', () => {
  it('records a view only after the current detail request resolves', async () => {
    const eventRequest = deferred<{ data: unknown; error: null }>();
    mocks.eventRequests.set('event-1', eventRequest.promise);
    const recordView = mocks.viewStates.get('event-1')!.recordView;

    const renderer = await renderScreen();

    expect(recordView).not.toHaveBeenCalled();
    expect(findByLabel(renderer, 'Loading event')).toBeDefined();

    await act(async () => {
      eventRequest.resolve({ data: testEvent('event-1'), error: null });
      await eventRequest.promise;
    });

    expect(recordView).toHaveBeenCalledTimes(1);
  });

  it('clears engagement data and closes both dialogs before a new event renders', async () => {
    const presentEventTwo = deferred<unknown[]>();
    mocks.presentRequests.set('event-1', Promise.resolve([
      { id: 'present-1', first_name: 'Sam', last_name: 'Patel' },
    ]));
    mocks.viewStates.set('event-1', {
      viewCount: 8,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn().mockResolvedValue([
        { id: 'viewer-1', first_name: 'Maya', last_name: 'Chen' },
      ]),
    });
    mocks.eventRequests.set('event-2', Promise.resolve({ data: testEvent('event-2'), error: null }));
    mocks.presentRequests.set('event-2', presentEventTwo.promise);
    mocks.viewStates.set('event-2', {
      viewCount: 2,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn().mockResolvedValue([]),
    });

    const renderer = await renderScreen();
    await flushEffects();
    await act(async () => {
      findByLabel(renderer, 'Seen by 8 people').props.onPress();
      await Promise.resolve();
    });
    act(() => {
      findByLabel(renderer, 'Show 1 present person').props.onPress();
    });
    expect(hasText(renderer, 'Maya Chen')).toBe(true);
    expect(hasText(renderer, 'Sam Patel')).toBe(true);

    mocks.routeId = 'event-2';
    await rerenderScreen(renderer);
    await flushEffects();

    expect(hasText(renderer, 'Family Tour')).toBe(true);
    expect(hasText(renderer, 'Maya Chen')).toBe(false);
    expect(hasText(renderer, 'Sam Patel')).toBe(false);
    expect(hasText(renderer, 'Present (1)')).toBe(false);
    expect(findAllByType(renderer, 'Dialog')).toHaveLength(0);
  });

  it('ignores delayed viewer results from the prior event while showing the current result', async () => {
    const eventOneViewers = deferred<unknown[]>();
    const eventTwoViewers = deferred<unknown[]>();
    mocks.viewStates.set('event-1', {
      viewCount: 6,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn(() => eventOneViewers.promise),
    });
    mocks.eventRequests.set('event-2', Promise.resolve({ data: testEvent('event-2'), error: null }));
    mocks.presentRequests.set('event-2', Promise.resolve([]));
    mocks.viewStates.set('event-2', {
      viewCount: 3,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn(() => eventTwoViewers.promise),
    });

    const renderer = await renderScreen();
    act(() => {
      findByLabel(renderer, 'Seen by 6 people').props.onPress();
    });
    expect(findAllByType(renderer, 'ActivityIndicator')).toHaveLength(1);

    mocks.routeId = 'event-2';
    await rerenderScreen(renderer);
    act(() => {
      findByLabel(renderer, 'Seen by 3 people').props.onPress();
    });

    await act(async () => {
      eventTwoViewers.resolve([
        { id: 'viewer-2', first_name: 'Jordan', last_name: 'Lee' },
      ]);
      await eventTwoViewers.promise;
    });
    expect(hasText(renderer, 'Jordan Lee')).toBe(true);

    await act(async () => {
      eventOneViewers.resolve([
        { id: 'viewer-1', first_name: 'Taylor', last_name: 'Kim' },
      ]);
      await eventOneViewers.promise;
    });

    expect(hasText(renderer, 'Jordan Lee')).toBe(true);
    expect(hasText(renderer, 'Taylor Kim')).toBe(false);
  });

  it('keeps a committed viewer request valid when a route transition render is abandoned', async () => {
    const viewerRequest = deferred<unknown[]>();
    const abandonedRender = deferred<void>();
    mocks.viewStates.set('event-1', {
      viewCount: 6,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn(() => viewerRequest.promise),
    });
    mocks.eventRequests.set('event-2', Promise.resolve({ data: testEvent('event-2'), error: null }));
    mocks.presentRequests.set('event-2', Promise.resolve([]));
    mocks.viewStates.set('event-2', {
      viewCount: 2,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn().mockResolvedValue([]),
    });
    mocks.detailSuspensions.set('event-2', abandonedRender.promise);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(EventDetailScreen, { role: 'student' }),
        { unstable_isConcurrent: true },
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    mountedRenderers.push(renderer);

    act(() => {
      findByLabel(renderer, 'Seen by 6 people').props.onPress();
    });

    mocks.routeId = 'event-2';
    await act(async () => {
      React.startTransition(() => {
        renderer.update(React.createElement(EventDetailScreen, { role: 'student' }));
      });
      await Promise.resolve();
    });

    mocks.routeId = 'event-1';
    await act(async () => {
      renderer.update(React.createElement(EventDetailScreen, { role: 'student' }));
      await Promise.resolve();
    });

    await act(async () => {
      viewerRequest.resolve([
        { id: 'viewer-1', first_name: 'Maya', last_name: 'Chen' },
      ]);
      await viewerRequest.promise;
    });

    expect(hasText(renderer, 'Maya Chen')).toBe(true);
  });

  it('ignores an out-of-order Present response owned by the previous event', async () => {
    const eventOnePresent = deferred<unknown[]>();
    const eventTwoPresent = deferred<unknown[]>();
    mocks.presentRequests.set('event-1', eventOnePresent.promise);
    mocks.eventRequests.set('event-2', Promise.resolve({ data: testEvent('event-2'), error: null }));
    mocks.presentRequests.set('event-2', eventTwoPresent.promise);
    mocks.viewStates.set('event-2', {
      viewCount: 1,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn().mockResolvedValue([]),
    });

    const renderer = await renderScreen();
    mocks.routeId = 'event-2';
    await rerenderScreen(renderer);

    await act(async () => {
      eventTwoPresent.resolve([
        { id: 'present-2', first_name: 'Jordan', last_name: 'Lee' },
      ]);
      await eventTwoPresent.promise;
    });
    act(() => {
      findByLabel(renderer, 'Show 1 present person').props.onPress();
    });
    expect(hasText(renderer, 'Jordan Lee')).toBe(true);

    await act(async () => {
      eventOnePresent.resolve([
        { id: 'present-1', first_name: 'Taylor', last_name: 'Kim' },
      ]);
      await eventOnePresent.promise;
    });

    expect(hasText(renderer, 'Jordan Lee')).toBe(true);
    expect(hasText(renderer, 'Taylor Kim')).toBe(false);
  });

  it('shows dialog loading and closes with a recoverable alert on viewer errors', async () => {
    const viewerRequest = deferred<unknown[]>();
    mocks.viewStates.set('event-1', {
      viewCount: 5,
      recordView: vi.fn().mockResolvedValue(undefined),
      loadViewers: vi.fn(() => viewerRequest.promise),
    });
    const renderer = await renderScreen();

    act(() => {
      findByLabel(renderer, 'Seen by 5 people').props.onPress();
    });
    expect(findAllByType(renderer, 'ActivityIndicator')).toHaveLength(1);

    await act(async () => {
      viewerRequest.reject(new Error('viewer request failed'));
      await viewerRequest.promise.catch(() => undefined);
    });

    expect(findAllByType(renderer, 'Dialog')).toHaveLength(0);
    expect(alertSpy).toHaveBeenCalledWith(
      'Unable to Load Viewers',
      'viewer request failed',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Try Again', onPress: expect.any(Function) }),
      ]),
    );
  });

  it('shows creator controls and navigates to attendance in the current role group', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'user-1'),
      error: null,
    }));
    const renderer = await renderScreen('student');

    expect(findByLabel(renderer, 'Edit event')).toBeDefined();
    expect(findByLabel(renderer, 'Delete event')).toBeDefined();
    const attendance = findByLabel(renderer, 'Take attendance for this event');
    act(() => attendance.props.onPress());

    expect(mocks.routerPush).toHaveBeenCalledWith('/(student)/events/attendance/event-1');
  });

  it('hides manager controls from a non-creator student but honors a live admin role', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'another-user'),
      error: null,
    }));
    const studentRenderer = await renderScreen('student');

    expect(studentRenderer.root.findAll((node) => node.props.accessibilityLabel === 'Edit event')).toHaveLength(0);
    expect(studentRenderer.root.findAll((node) => node.props.accessibilityLabel === 'Delete event')).toHaveLength(0);
    expect(studentRenderer.root.findAll((node) => node.props.accessibilityLabel === 'Take attendance for this event')).toHaveLength(0);

    act(() => studentRenderer.unmount());
    mountedRenderers.splice(mountedRenderers.indexOf(studentRenderer), 1);
    mocks.auth.userRole = 'admin';
    const adminRenderer = await renderScreen('student');

    expect(findByLabel(adminRenderer, 'Edit event')).toBeDefined();
    expect(findByLabel(adminRenderer, 'Take attendance for this event')).toBeDefined();
  });
});

describe('event view insertion scope', () => {
  it('does not wire view insertion into list or prefetch rendering', () => {
    const listSource = readFileSync(
      fileURLToPath(new URL('../src/screens/EventsListScreen.tsx', import.meta.url).href),
      'utf8',
    );

    expect(listSource).not.toContain('useEventViews');
    expect(listSource).not.toContain("from('event_views')");
  });
});
