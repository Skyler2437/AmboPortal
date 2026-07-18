import React, { useEffect, useRef, useCallback } from 'react';
import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { useAuth } from './AuthProvider';
import {
  setCurrentPushToken,
  syncTokenToServer,
  deleteTokenFromServer,
  getCurrentPushToken,
  type TokenPayload,
} from '@/lib/push-token-manager';
import type { UserRole } from '@ambo/database/types';
import { syncUnreadMessageBadge } from '@/lib/app-badge';

const PENDING_TOKEN_KEY = 'ambo_pending_push_token';

function groupForRole(role: UserRole | null): '(admin)' | '(student)' | null {
  if (role === 'admin' || role === 'superadmin') return '(admin)';
  if (role === 'student') return '(student)';
  return null; // basic/applicant/null have no protected deep-link destination
}

// Map a known web URL to the mobile route for THIS user's role. Mapping is
// role-aware so an admin tapping e.g. a chat notification lands on
// /(admin)/chat rather than being pushed into the student group (which the
// student layout would then redirect away from, thrashing navigation).
function mapWebUrlToMobileRoute(url: string, role: UserRole | null): string {
  const base = groupForRole(role) === '(admin)' ? '/(admin)' : '/(student)';
  if (url.includes('/chat')) return `${base}/chat`;
  if (url.includes('/posts')) return `${base}/posts`;
  if (base === '/(admin)' && url.includes('/submissions')) return '/(admin)/(home)/submissions';
  return base;
}

// The web sender hardcodes a group in mobilePath (chat notifications carry
// "/(student)/chat" for every participant, admins included), so rewrite the
// group segment for THIS user's role. The admin and student groups expose
// mirrored chat/posts/events trees, so the remapped route always exists.
function remapMobilePathForRole(mobilePath: string, role: UserRole | null): string {
  const group = groupForRole(role);
  if (!group) return mobilePath;
  return mobilePath.replace(/^\/\((student|admin)\)/, `/${group}`);
}

function comparableRoutePath(route: string): string {
  return route
    .split(/[?#]/, 1)[0]
    .replace(/^\/\((student|admin)\)/, '') || '/';
}

function getProjectId(): string | null {
  if (process.env.EXPO_PUBLIC_EAS_PROJECT_ID) {
    return process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  }
  if (Constants.easConfig?.projectId) {
    return Constants.easConfig.projectId;
  }
  if (Constants.expoConfig?.extra?.eas?.projectId) {
    return Constants.expoConfig.extra.eas.projectId;
  }
  return null;
}

export function PushNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session, userRole, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const registeredRef = useRef(false);
  // Holds a notification target that arrived before navigation settled. We
  // store the raw payload (not a resolved route) because the user's role is
  // often still null at cold-launch tap time — the concrete route is computed
  // in flushPendingRoute once the role is known.
  const pendingTargetRef = useRef<{ mobilePath?: string; url?: string } | null>(null);
  // Mirror auth/navigation state into refs so handleNotificationResponse and
  // flushPendingRoute can stay referentially stable — otherwise their dep
  // changes re-fire the cold-start listener effect and we'd handle the launch
  // tap twice.
  const sessionRef = useRef(session);
  const authLoadingRef = useRef(authLoading);
  const userRoleRef = useRef(userRole);
  const segmentsRef = useRef(segments);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    sessionRef.current = session;
    authLoadingRef.current = authLoading;
    userRoleRef.current = userRole;
    segmentsRef.current = segments;
    pathnameRef.current = pathname;
  }, [session, authLoading, userRole, segments, pathname]);

  // Set foreground notification handler
  useEffect(() => {
    if (Platform.OS === 'web') return;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });

    // Reconcile the authoritative unread total when returning to the app.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const userId = sessionRef.current?.user?.id;
        if (userId) syncUnreadMessageBadge(userId).catch(() => {});
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (userId) syncUnreadMessageBadge(userId).catch(() => {});
  }, [session?.user?.id]);

  const applyRoute = useCallback(
    (route: string) => {
      try {
        // A warm notification can target the thread already on screen. A
        // duplicate push would mount a second hook on the same Presence topic;
        // its later cleanup could disconnect the still-visible thread.
        if (comparableRoutePath(pathnameRef.current) === comparableRoutePath(route)) return;
        router.navigate(
          route as Parameters<typeof router.navigate>[0],
          { dangerouslySingular: true },
        );
      } catch {
        // Navigator not mounted yet — re-stage so the settle effect retries.
        pendingTargetRef.current = { mobilePath: route };
      }
    },
    [router]
  );

  // Apply the pending notification target, but only once it is safe to do so:
  // auth has resolved, the user has a session and a known role, AND
  // RootNavigator has already landed in that role's group. Pushing a deep
  // route before navigation settles stacks an extra push onto the cold-start
  // redirect sequence, which is what triggers the navigator update-depth loop
  // (and the "Something went wrong" ErrorBoundary screen) on notification taps.
  const flushPendingRoute = useCallback(() => {
    const target = pendingTargetRef.current;
    if (!target) return;
    if (authLoadingRef.current) return; // auth still resolving

    if (!sessionRef.current) {
      // No session — RootNavigator will route to login; drop the deep link.
      pendingTargetRef.current = null;
      return;
    }

    const group = groupForRole(userRoleRef.current);
    if (!group) {
      // null role → still resolving, so wait. A resolved basic/applicant role
      // has no protected destination → discard.
      if (userRoleRef.current !== null) pendingTargetRef.current = null;
      return;
    }

    // Wait until RootNavigator has actually navigated into the user's group
    // before pushing a nested route on top of it.
    if (segmentsRef.current[0] !== group) return;

    // Resolve the concrete route now that the role is known.
    const route = target.mobilePath
      ? remapMobilePathForRole(target.mobilePath, userRoleRef.current)
      : target.url
        ? mapWebUrlToMobileRoute(target.url, userRoleRef.current)
        : null;
    pendingTargetRef.current = null;
    if (route) applyRoute(route);
  }, [applyRoute]);

  // Handle notification taps. The target is always staged and flushed by
  // flushPendingRoute so cold-launch taps (auth not yet resolved) and warm
  // taps (already settled) follow the exact same gated path.
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      // Payload data is attacker-/sender-controlled: only stage real strings
      // so a malformed value can't reach the route mappers.
      const mobilePath =
        typeof data?.mobilePath === 'string' ? data.mobilePath : undefined;
      const url = typeof data?.url === 'string' ? data.url : undefined;
      if (!mobilePath && !url) return;
      pendingTargetRef.current = { mobilePath, url };
      flushPendingRoute();
    },
    [flushPendingRoute]
  );

  // Re-attempt the pending target whenever auth, role, or the current route
  // group changes — i.e. as the cold-start navigation settles.
  useEffect(() => {
    flushPendingRoute();
  }, [authLoading, session, userRole, segments, flushPendingRoute]);

  // Register response listener + process cold-launch tap
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Process last notification response (cold launch)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    return () => subscription.remove();
  }, [handleNotificationResponse]);

  // Register push token when session is available
  const registerPushToken = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (!Device.isDevice) {
      if (__DEV__) console.log('[Push] Skipping registration on simulator/emulator');
      return;
    }

    const projectId = getProjectId();
    if (!projectId) {
      if (__DEV__) console.log('[Push] No EAS projectId configured, skipping push registration');
      return;
    }

    try {
      // Create default channel on Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync(
          Platform.OS === 'ios'
            ? { ios: { allowAlert: true, allowBadge: true, allowSound: true } }
            : undefined,
        );
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        // Clear the guard so granting permission later (e.g. from the
        // Profile screen) lets the next session event retry registration.
        registeredRef.current = false;
        if (__DEV__) console.log('[Push] Permission not granted');
        return;
      }

      // Get Expo push token
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenData.data;
      setCurrentPushToken(token);

      const payload: TokenPayload = {
        token,
        platform: Platform.OS,
        device_name: Device.deviceName || `${Platform.OS} device`,
      };

      const synced = await syncTokenToServer(payload);
      if (!synced) {
        // Persist for retry
        await AsyncStorage.setItem(PENDING_TOKEN_KEY, JSON.stringify(payload));
        if (__DEV__) console.log('[Push] Token sync failed, persisted for retry');
      } else {
        await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
      }
    } catch (err) {
      // Fetching the Expo token hits the network and can fail transiently
      // (device offline, or app backgrounded mid-launch). That's expected, so
      // swallow it rather than letting it surface as an unhandled promise
      // rejection (AMBOPORTAL-MOBILE-5). Clear the guard so a later session
      // change or relaunch can retry registration.
      registeredRef.current = false;
      if (__DEV__) console.log('[Push] Push token registration failed (will retry):', err);
    }
  }, []);

  // Retry pending token sync
  const retryPendingSync = useCallback(async () => {
    const pendingRaw = await AsyncStorage.getItem(PENDING_TOKEN_KEY);
    if (!pendingRaw) return;

    try {
      const payload: TokenPayload = JSON.parse(pendingRaw);
      // Older builds persisted native APNs tokens here (rotation listener
      // bug); the server rejects those with 400 forever, so drop them
      // instead of retrying on every session event.
      if (
        typeof payload.token !== 'string' ||
        !payload.token.startsWith('ExponentPushToken[')
      ) {
        await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
        return;
      }
      const synced = await syncTokenToServer(payload);
      if (synced) {
        await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
        if (__DEV__) console.log('[Push] Pending token sync succeeded');
      }
    } catch {
      // Invalid stored data
      await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
    }
  }, []);

  // React to session changes
  useEffect(() => {
    if (!session) {
      // Fallback only: AuthProvider.signOut already unregisters the token
      // while its access token is still valid. This path covers sessions
      // that end without an explicit sign-out (e.g. expiry), where the
      // server delete can no longer authenticate anyway.
      const token = getCurrentPushToken();
      if (token) {
        deleteTokenFromServer(token).catch(() => {
          // Don't block logout
        });
        setCurrentPushToken(null);
      }
      registeredRef.current = false;
      return;
    }

    if (!registeredRef.current) {
      registeredRef.current = true;
      registerPushToken();
      retryPendingSync();
    }
  }, [session, registerPushToken, retryPendingSync]);

  // Listen for token rotation
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = Notifications.addPushTokenListener(async (newToken) => {
      // newToken is the NATIVE device token (APNs/FCM), not an Expo token —
      // the server only accepts ExponentPushToken[...] and 400s anything
      // else. Exchange it for the rotated Expo token. Passing the received
      // token as devicePushToken skips getExpoPushTokenAsync's internal
      // getDevicePushTokenAsync call, which would re-fire this listener.
      const projectId = getProjectId();
      if (!projectId) return;

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId,
          devicePushToken: newToken,
        });
        const token = tokenData.data;
        setCurrentPushToken(token);

        const payload: TokenPayload = {
          token,
          platform: Platform.OS,
          device_name: Device.deviceName || `${Platform.OS} device`,
        };

        const synced = await syncTokenToServer(payload);
        if (!synced) {
          await AsyncStorage.setItem(PENDING_TOKEN_KEY, JSON.stringify(payload));
        } else {
          await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
        }
      } catch {
        // The exchange hits Expo's servers and can fail transiently; swallow
        // so it doesn't surface as an unhandled rejection. The next session
        // event or relaunch re-registers via registerPushToken.
      }
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}
