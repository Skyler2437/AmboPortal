import React from 'react';
import { vi } from 'vitest';

const MaterialCommunityIcon = 'MaterialCommunityIcon';

export default MaterialCommunityIcon;

export const View = 'View';
export const ScrollView = 'ScrollView';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';
export const Pressable = 'Pressable';
export const Platform = { OS: 'ios' };
export const Alert = { alert: (..._args: unknown[]) => undefined };
export const StyleSheet = {
  create: <T>(styles: T) => styles,
  flatten: (style: unknown) => style,
};

export const mockState = {
  routeId: 'event-1',
  auth: {
    session: { user: { id: 'user-1' } },
    userRole: 'student' as 'student' | 'admin' | 'superadmin',
  },
  eventRequests: new Map<string, Promise<{ data: unknown; error: null }>>(),
  detailSuspensions: new Map<string, Promise<unknown>>(),
  presentRequests: new Map<string, Promise<unknown[]>>(),
  viewStates: new Map<string, {
    viewCount: number;
    recordView: ReturnType<typeof vi.fn>;
    loadViewers: ReturnType<typeof vi.fn>;
  }>(),
  routerPush: vi.fn(),
  routerBack: vi.fn(),
  supabaseFrom: vi.fn(),
  detail: {
    comments: [] as unknown[],
    rsvps: [] as unknown[],
    rsvpOptions: [] as unknown[],
    myRsvp: null,
    myRsvpOptionId: null,
    loading: false,
    updateRsvp: vi.fn(),
    postComment: vi.fn(),
  },
};

export const useLocalSearchParams = () => ({ id: mockState.routeId });
export const useRouter = () => ({ push: mockState.routerPush, back: mockState.routerBack });
export const Stack = { Screen: 'StackScreen' };

export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });

export const useAuth = () => mockState.auth;
export const useEventDetail = (eventId: string) => {
  const suspension = mockState.detailSuspensions.get(eventId);
  if (suspension) throw suspension;
  return mockState.detail;
};
export const useEventViews = (eventId: string) => {
  const state = mockState.viewStates.get(eventId);
  if (!state) throw new Error(`Missing view state for ${eventId}`);
  return state;
};
export const loadPresentUsers = (eventId: string) => (
  mockState.presentRequests.get(eventId) ?? Promise.resolve([])
);

export const supabase = {
  from: (...args: unknown[]) => mockState.supabaseFrom(...args),
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  },
};

export const createChatGroup = vi.fn();

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const fontSize = { xxs: 11, xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 28 } as const;
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export function LoadingScreen() {
  return React.createElement('LoadingScreen', { accessibilityLabel: 'Loading event' });
}

export function EventDateTimePicker() {
  return null;
}

export const useThemedStyles = () => ({
  styles: {},
  tokens: {
    border: '#dddddd',
    surface: '#ffffff',
    surfaceVariant: '#f2f2f2',
    textPrimary: '#111111',
    textSecondary: '#444444',
    textMuted: '#777777',
    accent: '#005eff',
    accentContainer: '#eef4ff',
    background: '#ffffff',
    statusGoodFg: '#15803d',
    statusGoodBg: '#f0fdf4',
    statusGoodBorder: '#86efac',
    statusWarnFg: '#a16207',
    statusWarnBg: '#fefce8',
    statusWarnBorder: '#fde047',
    statusBadFg: '#b91c1c',
  },
});

export const Text = 'Text';
export const Card = Object.assign('Card', { Content: 'CardContent' });
export const Button = 'Button';
export const TextInput = 'PaperTextInput';
export const IconButton = 'IconButton';
export const Divider = 'Divider';
export const Avatar = { Text: 'AvatarText', Image: 'AvatarImage' };
export const Portal = 'Portal';
export const ActivityIndicator = 'ActivityIndicator';

export function Dialog({ visible, children, ...props }: {
  visible: boolean;
  children?: React.ReactNode;
}) {
  return visible ? React.createElement('Dialog', props, children) : null;
}

Dialog.Title = 'DialogTitle';
Dialog.Content = 'DialogContent';

export function UserListDialog({
  visible,
  title,
  users,
}: {
  visible: boolean;
  title: string;
  users: Array<{ id: string; first_name: string; last_name: string }> | null;
  onDismiss: () => void;
}) {
  if (!visible) return null;
  return React.createElement(
    'Dialog',
    null,
    React.createElement('Text', null, title),
    users === null
      ? React.createElement('ActivityIndicator')
      : users.map((user) => React.createElement(
          'Text',
          { key: user.id },
          `${user.first_name} ${user.last_name}`,
        )),
  );
}
