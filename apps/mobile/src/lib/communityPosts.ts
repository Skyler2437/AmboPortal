export interface PostDraft {
  content: string;
  publish_at: string | null;
  poll: { options: string[]; closes_at: string | null } | null;
}
export interface ScheduledPost extends PostDraft {
  id: string;
  user_id: string;
  created_at: string;
  can_manage?: boolean;
}
export interface Poll {
  post_id: string;
  closes_at: string | null;
  closed: boolean;
  options: { id: string; label: string; votes: number }[];
  total_votes: number;
  my_option_id: string | null;
}
export function validatePostDraft(draft: PostDraft, now = Date.now()): string | null {
  if (!draft.content.trim()) return 'Enter an update or poll question.';
  const publication = draft.publish_at ? Date.parse(draft.publish_at) : now;
  if (draft.publish_at && (!Number.isFinite(publication) || publication <= now)) return 'Choose a publication time in the future.';
  if (draft.poll) {
    const labels = draft.poll.options.map(option => option.trim().toLowerCase());
    if (labels.length < 2 || labels.length > 6 || labels.some(label => !label)) return 'Enter between 2 and 6 poll options.';
    if (new Set(labels).size !== labels.length) return 'Give each poll option a different label.';
    const closing = draft.poll.closes_at ? Date.parse(draft.poll.closes_at) : null;
    if (closing !== null && (!Number.isFinite(closing) || closing <= publication)) return 'Choose a poll closing time after publication.';
  }
  return null;
}
export async function communityRequest<T>(token: string, path = '', method = 'GET', body?: unknown): Promise<T> {
  if (!token) throw new Error('Your session expired. Sign in again before trying again.');
  const base = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!base) throw new Error('The server address is unavailable. Contact an administrator.');
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/community/posts${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new Error('Could not reach the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again before trying again.' : data?.error || 'Could not save the change. Refresh and try again.');
  if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response. Refresh to check the result.');
  return data as T;
}
