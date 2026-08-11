import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
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
    renderer = create(React.createElement(EventDetailScreen, { role }), {
      createNodeMock: (element) => {
        if (element.props.accessibilityLabel === 'Comment') return { focus: mocks.inputFocus };
        if (element.props.testID === 'event-content-scroll') {
          return { scrollToEnd: mocks.scrollToEnd };
        }
        return {};
      },
    });
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

function flattenedStyle(style: unknown) {
  const values = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...values.filter(Boolean));
}

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
  alertSpy?.mockRestore();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.routeId = 'event-1';
  mocks.auth.session.user.id = 'user-1';
  mocks.auth.userRole = 'student';
  mocks.routerPush.mockReset();
  mocks.routerBack.mockReset();
  mocks.inputFocus.mockReset();
  mocks.scrollToEnd.mockReset();
  mocks.detail.postComment.mockReset();
  mocks.detail.postComment.mockResolvedValue(null);
  mocks.detail.updateRsvp.mockReset();
  mocks.detail.updateRsvp.mockResolvedValue(null);
  mocks.detail.refetch.mockReset();
  mocks.detail.refetch.mockResolvedValue(undefined);
  mocks.detail.rsvps = [];
  mocks.detail.rsvpOptions = [];
  mocks.detail.myRsvp = null;
  mocks.detail.myRsvpOptionId = null;
  mocks.detail.myRsvpExplanation = null;
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockReset();
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
  it.each([
    ['Maybe', 'maybe'],
    ["Can't Go", 'no'],
  ] as const)('requires a 50–500 character explanation before saving %s', async (label, status) => {
    const renderer = await renderScreen('student');

    act(() => findByLabel(renderer, `Choose ${label} RSVP`).props.onPress());

    const input = findByLabel(renderer, 'RSVP explanation');
    expect(input.props.maxLength).toBe(500);
    expect(findByLabel(renderer, 'Save RSVP').props.disabled).toBe(true);

    act(() => input.props.onChangeText('A'.repeat(50)));
    expect(findByLabel(renderer, 'Save RSVP').props.disabled).toBe(false);

    await act(async () => {
      await findByLabel(renderer, 'Save RSVP').props.onPress();
    });

    expect(mocks.detail.updateRsvp).toHaveBeenCalledWith(status, undefined, 'A'.repeat(50));
  });

  it('uses a keyboard-resizing native modal for the RSVP explanation', async () => {
    const renderer = await renderScreen('student');

    act(() => findByLabel(renderer, 'Choose Maybe RSVP').props.onPress());

    expect(findAllByType(renderer, 'Modal')).toHaveLength(1);
    expect(findAllByType(renderer, 'Dialog')).toHaveLength(0);
  });

  it('shows RSVP explanations to admins but not students', async () => {
    mocks.detail.rsvps = [{
      status: 'maybe',
      user_id: 'student-2',
      users: { first_name: 'Maya', last_name: 'Chen' },
      explanation: 'I have another school commitment and may arrive after it ends.',
    }];

    const studentRenderer = await renderScreen('student');
    expect(hasText(studentRenderer, 'I have another school commitment and may arrive after it ends.')).toBe(false);

    const adminRenderer = await renderScreen('admin');
    expect(hasText(adminRenderer, 'RSVP explanations')).toBe(true);
    expect(hasText(adminRenderer, 'I have another school commitment and may arrive after it ends.')).toBe(true);
  });

  it('guards duplicate comment sends and preserves a newer in-flight draft after success', async () => {
    const request = deferred<null>();
    mocks.detail.postComment.mockImplementation(() => request.promise);
    const renderer = await renderScreen('student');

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('First draft'));
    const send = findByLabel(renderer, 'Post comment').props.onPress;
    let pending!: Promise<void>;
    act(() => {
      pending = send();
      send();
    });

    expect(mocks.detail.postComment).toHaveBeenCalledTimes(1);
    expect(mocks.detail.postComment).toHaveBeenCalledWith('First draft');
    expect(findByLabel(renderer, 'Post comment').props.loading).toBe(true);

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Newer draft'));
    await act(async () => {
      request.resolve(null);
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
    const request = deferred<Error | null>();
    mocks.detail.postComment.mockImplementation(() => request.promise);
    const renderer = await renderScreen('admin');

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Keep this'));
    let pending!: Promise<void>;
    act(() => { pending = findByLabel(renderer, 'Post comment').props.onPress(); });
    await act(async () => {
      request.resolve(new Error('offline'));
      await pending;
    });

    expect(findByLabel(renderer, 'Comment').props.value).toBe('Keep this');
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to post comment');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Failed to post comment.',
    );
    expect(mocks.inputFocus).not.toHaveBeenCalled();
  });

  it('preserves a newer in-flight draft when an older comment fails', async () => {
    const request = deferred<Error | null>();
    mocks.detail.postComment.mockImplementation(() => request.promise);
    const renderer = await renderScreen('student');

    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Older draft'));
    let pending!: Promise<void>;
    act(() => { pending = findByLabel(renderer, 'Post comment').props.onPress(); });
    act(() => findByLabel(renderer, 'Comment').props.onChangeText('Newer draft'));

    await act(async () => {
      request.resolve(new Error('offline'));
      await pending;
    });

    expect(findByLabel(renderer, 'Comment').props.value).toBe('Newer draft');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Failed to post comment.',
    );
  });

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
    expect(attendance.type).toBe('IconButton');
    expect(attendance.props).toEqual(expect.objectContaining({
      icon: 'clipboard-check-outline',
      mode: 'outlined',
      size: 20,
      iconColor: '#005eff',
    }));
    const managerActions = renderer.root.findAll((node) => (
      ['Take attendance for this event', 'Edit event', 'Delete event']
        .includes(node.props.accessibilityLabel)
    ));
    expect(managerActions.map((node) => node.props.accessibilityLabel)).toEqual([
      'Take attendance for this event',
      'Edit event',
      'Delete event',
    ]);
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

  it('scrolls to the newest comment when the composer receives focus', async () => {
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Comment').props.onFocus?.());

    expect(mocks.scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('lets people open web links in event descriptions', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: {
        ...testEvent('event-1'),
        description: 'Details: https://example.com/event-info',
      },
      error: null,
    }));
    const renderer = await renderScreen();

    const link = findByLabel(renderer, 'Open link https://example.com/event-info');
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.onPress).toEqual(expect.any(Function));
  });

  it('lets event description and uniform fields size intrinsically above their minimum heights', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'user-1'),
      error: null,
    }));
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Edit event').props.onPress());
    const description = renderer.root.find((node) => node.props.label === 'Description');
    const uniform = renderer.root.find((node) => node.props.label === 'Uniform');

    expect(flattenedStyle(description.props.style).minHeight).toBe(112);
    expect(flattenedStyle(uniform.props.style).minHeight).toBe(72);
    expect(flattenedStyle(description.props.style).height).toBeUndefined();
    expect(flattenedStyle(uniform.props.style).height).toBeUndefined();
  });

  it('edits custom RSVP options with stable IDs and refreshes after saving', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'user-1'),
      error: null,
    }));
    mocks.detail.rsvpOptions = [
      { id: 'option-1', event_id: 'event-1', label: 'Bus 1', sort_order: 0 },
      { id: 'option-2', event_id: 'event-1', label: 'Bus 2', sort_order: 1 },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        event: testEvent('event-1', 'user-1'),
        rsvp_options: [],
        gcal_sync: { synced: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Edit event').props.onPress());
    expect(findByLabel(renderer, 'RSVP option 1').props.value).toBe('Bus 1');
    expect(findByLabel(renderer, 'RSVP option 2').props.value).toBe('Bus 2');

    act(() => findByLabel(renderer, 'RSVP option 1').props.onChangeText('Morning Bus'));
    act(() => findByLabel(renderer, 'Remove RSVP option 2').props.onPress());
    act(() => findByLabel(renderer, 'Add RSVP option').props.onPress());
    act(() => findByLabel(renderer, 'RSVP option 2').props.onChangeText('Evening Bus'));

    await act(async () => {
      await findByLabel(renderer, 'Save event changes').props.onPress();
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.rsvp_options).toEqual([
      { id: 'option-1', label: 'Morning Bus' },
      { label: 'Evening Bus' },
    ]);
    expect(mocks.detail.refetch).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Save event changes')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('warns before deleting a selected option and keeps the RSVP Going', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'user-1'),
      error: null,
    }));
    mocks.detail.rsvpOptions = [
      { id: 'option-1', event_id: 'event-1', label: 'Bus 1', sort_order: 0 },
    ];
    mocks.detail.rsvps = [{
      status: 'going',
      user_id: 'student-2',
      rsvp_option_id: 'option-1',
      users: { first_name: 'Maya', last_name: 'Chen' },
    }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        event: testEvent('event-1', 'user-1'),
        rsvp_options: [],
        gcal_sync: { synced: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Edit event').props.onPress());
    act(() => findByLabel(renderer, 'Remove RSVP option 1').props.onPress());
    await act(async () => {
      await findByLabel(renderer, 'Save event changes').props.onPress();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Remove RSVP option?',
      expect.stringContaining('remain marked Going'),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{
      text: string;
      onPress?: () => void | Promise<void>;
    }>;
    const removeButton = buttons.find((button) => button.text === 'Remove & Save');
    await act(async () => {
      await removeButton?.onPress?.();
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rsvp_options).toEqual([]);
    expect(mocks.detail.refetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps the option draft open when saving fails', async () => {
    mocks.eventRequests.set('event-1', Promise.resolve({
      data: testEvent('event-1', 'user-1'),
      error: null,
    }));
    mocks.detail.rsvpOptions = [
      { id: 'option-1', event_id: 'event-1', label: 'Bus 1', sort_order: 0 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Unable to save options' }),
    }));
    const renderer = await renderScreen();

    act(() => findByLabel(renderer, 'Edit event').props.onPress());
    act(() => findByLabel(renderer, 'RSVP option 1').props.onChangeText('Keep my draft'));
    await act(async () => {
      await findByLabel(renderer, 'Save event changes').props.onPress();
    });

    expect(findByLabel(renderer, 'RSVP option 1').props.value).toBe('Keep my draft');
    expect(findByLabel(renderer, 'Save event changes')).toBeDefined();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Unable to save options');
    expect(mocks.detail.refetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('uses the same shape and sizing for default and custom RSVP controls', async () => {
    mocks.detail.rsvpOptions = [
      { id: 'option-1', event_id: 'event-1', label: 'Bus 1', sort_order: 0 },
    ];
    mocks.detail.myRsvp = 'going';
    mocks.detail.myRsvpOptionId = 'option-1';
    const renderer = await renderScreen();

    const defaultControl = renderer.root.find((node) => (
      node.type === 'Pressable'
      && node.props.accessibilityLabel === 'Choose Maybe RSVP'
    ));
    const customControl = renderer.root.find((node) => (
      node.type === 'Pressable'
      && node.props.accessibilityLabel === 'Choose Bus 1 RSVP'
    ));
    const defaultStyle = flattenedStyle(
      defaultControl.props.style({ pressed: false }),
    );
    const customStyle = flattenedStyle(
      customControl.props.style({ pressed: false }),
    );

    expect(customStyle.borderRadius).toBe(defaultStyle.borderRadius);
    expect(customStyle.minHeight).toBe(defaultStyle.minHeight);
    expect(customStyle.borderWidth).toBe(defaultStyle.borderWidth);
    expect(customStyle.paddingVertical).toBe(defaultStyle.paddingVertical);
    expect(
      customControl.find((node) => node.type === 'MaterialCommunityIcon').props.size,
    ).toBe(
      defaultControl.find((node) => node.type === 'MaterialCommunityIcon').props.size,
    );
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
