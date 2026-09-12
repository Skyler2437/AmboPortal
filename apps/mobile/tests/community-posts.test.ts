import { afterEach, describe, expect, it, vi } from 'vitest';
import { communityRequest, validatePostDraft, type PostDraft } from '../src/lib/communityPosts';
const draft: PostDraft = { content: 'Which day?', publish_at: '2026-09-13T17:00:00Z', poll: { options: ['Monday', 'Tuesday'], closes_at: '2026-09-14T17:00:00Z' } };
const now = Date.parse('2026-09-12T17:00:00Z');
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('post validation', () => {
  it('allows a scheduled poll', () => expect(validatePostDraft(draft, now)).toBeNull());
  it('rejects past publication and closing before publication', () => {
    expect(validatePostDraft(draft, now + 86400000)).toMatch(/future/);
    expect(validatePostDraft({ ...draft, poll: { ...draft.poll!, closes_at: draft.publish_at } }, now)).toMatch(/after publication/);
  });
  it('rejects blank and duplicate choices', () => {
    expect(validatePostDraft({ ...draft, poll: { options: ['Same', ' same '], closes_at: null } }, now)).toMatch(/different/);
    expect(validatePostDraft({ ...draft, poll: { options: ['Yes', ' '], closes_at: null } }, now)).toMatch(/2 and 6/);
  });
});
describe('community client', () => {
  it('sends the session and JSON to the configured server', async () => {
    vi.stubEnv('EXPO_PUBLIC_WEB_URL', 'https://example.test/');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'saved' }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(communityRequest('session-token', '', 'POST', draft)).resolves.toEqual({ id: 'saved' });
    expect(fetcher).toHaveBeenCalledWith('https://example.test/api/community/posts', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }), body: JSON.stringify(draft) }));
  });
  it('rejects expired sessions and network errors', async () => {
    vi.stubEnv('EXPO_PUBLIC_WEB_URL', 'https://example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(communityRequest('old')).rejects.toThrow(/Sign in again/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(communityRequest('valid')).rejects.toThrow(/connection/);
  });
});
