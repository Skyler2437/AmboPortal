import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  badgeCountToApply,
  getUnreadMessageCount,
} from '@ambo/database/unread-messages';
import { supabase } from './supabase';

/** Reconcile the iOS app-icon badge without clearing it after lookup errors. */
export async function syncUnreadMessageBadge(userId: string): Promise<boolean> {
  if (Platform.OS !== 'ios' || !userId) return false;

  const count = badgeCountToApply(await getUnreadMessageCount(supabase, userId));
  if (count === null) return false;

  return Notifications.setBadgeCountAsync(count);
}
