import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const creationState = vi.hoisted(() => ({
  eventPayload: null as Record<string, unknown> | null,
  eventInsertCount: 0,
  eventResult: {
    data: { id: 'event-1' } as { id: string } | null,
    error: null as { message: string } | null,
  },
  rsvpError: null as { message: string } | null,
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { webUrl: 'https://ambo.example.test' } } },
}));

vi.mock('@ambo/database', () => ({
  DEFAULT_EVENT_UNIFORM: 'Ambo polo with khaki or navy pants/shorts (appropriate length).',
}));

vi.mock('@/components/ui', () => ({
  FormScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('FormScreen', null, children),
  FormField: (props: Record<string, unknown>) => React.createElement('FormField', props),
}));

import { mockState as mocks, supabase } from './event-detail-dependencies.mock';
import { NewEventScreen } from '@/screens/NewEventScreen';

const mountedRenderers: ReactTestRenderer[] = [];
let alertSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function findFormField(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find((node) => node.type === 'FormField' && node.props.label === label);
}

function findButton(renderer: ReactTestRenderer, text: string) {
  return renderer.root.find((node) => node.type === 'Button' && node.children.includes(text));
}

async function renderScreen() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(NewEventScreen, { role: 'student' }));
  });
  mountedRenderers.push(renderer);
  return renderer;
}

async function createEvent(renderer: ReactTestRenderer) {
  act(() => findFormField(renderer, 'Title *').props.onChangeText('Fabricated campus tour'));
  await act(async () => {
    await findButton(renderer, 'Create Event').props.onPress();
  });
}

beforeEach(() => {
  creationState.eventPayload = null;
  creationState.eventInsertCount = 0;
  creationState.eventResult = { data: { id: 'event-1' }, error: null };
  creationState.rsvpError = null;
  mocks.routerBack.mockReset();
  mocks.auth.session.user.id = 'student-1';
  mocks.supabaseFrom.mockReset();
  mocks.supabaseFrom.mockImplementation((table: string) => {
    if (table === 'events') {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          creationState.eventPayload = payload;
          creationState.eventInsertCount += 1;
          return {
            select: () => ({ single: async () => creationState.eventResult }),
          };
        }),
      };
    }
    if (table === 'event_rsvp_options') {
      return { insert: vi.fn(async () => ({ error: creationState.rsvpError })) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'fabricated-token' } },
  } as never);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => renderer.unmount());
  }
  alertSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe('NewEventScreen creation', () => {
  it('starts with the standard uniform and sends null when a student clears it', async () => {
    const renderer = await renderScreen();

    expect(findFormField(renderer, 'Uniform').props.value).toBe(
      'Ambo polo with khaki or navy pants/shorts (appropriate length).',
    );

    act(() => findFormField(renderer, 'Uniform').props.onChangeText(''));
    await createEvent(renderer);

    expect(creationState.eventPayload).toEqual(expect.objectContaining({
      uniform: null,
      created_by: 'student-1',
    }));
  });

  it('lets description and uniform fields expand for longer text', async () => {
    const renderer = await renderScreen();

    expect(findFormField(renderer, 'Description').props).toEqual(expect.objectContaining({
      autoGrow: true,
      minInputHeight: 112,
      multiline: true,
      scrollEnabled: false,
    }));
    expect(findFormField(renderer, 'Uniform').props).toEqual(expect.objectContaining({
      autoGrow: true,
      minInputHeight: 72,
      multiline: true,
      scrollEnabled: false,
    }));
  });

  it('retains the form and does not navigate when the event insert fails', async () => {
    creationState.eventResult = { data: null, error: { message: 'permission denied' } };
    const renderer = await renderScreen();

    await createEvent(renderer);

    expect(findFormField(renderer, 'Title *').props.value).toBe('Fabricated campus tour');
    expect(mocks.routerBack).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'permission denied');
  });

  it('reports saved-event RSVP option failures before returning', async () => {
    creationState.rsvpError = { message: 'option insert failed' };
    const renderer = await renderScreen();

    act(() => findButton(renderer, 'Add RSVP Option').props.onPress());
    act(() => renderer.root.find((node) => node.props.placeholder === 'Option 1').props.onChangeText('Going'));
    await createEvent(renderer);

    expect(alertSpy).toHaveBeenCalledWith(
      'Event created',
      'The event exists in AmboPortal, but RSVP options were not saved.',
      expect.any(Array),
    );
    expect(mocks.routerBack).not.toHaveBeenCalled();

    const actions = alertSpy.mock.calls[0]?.[2];
    expect(actions).toHaveLength(1);
    act(() => actions?.[0]?.onPress?.());

    expect(creationState.eventInsertCount).toBe(1);
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
  });

  it('reports saved-event calendar sync failures before returning', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const renderer = await renderScreen();

    await createEvent(renderer);

    expect(alertSpy).toHaveBeenCalledWith(
      'Event created',
      'The event exists in AmboPortal, but calendar sync failed.',
      expect.any(Array),
    );
    expect(mocks.routerBack).not.toHaveBeenCalled();

    const actions = alertSpy.mock.calls[0]?.[2];
    expect(actions).toHaveLength(1);
    act(() => actions?.[0]?.onPress?.());

    expect(creationState.eventInsertCount).toBe(1);
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
  });

  it('returns exactly once after a fully successful creation', async () => {
    const renderer = await renderScreen();

    await createEvent(renderer);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
  });
});
