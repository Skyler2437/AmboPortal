import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: '00000000-0000-4000-8000-000000000001', role: 'student',
  rpc: vi.fn(), info: vi.fn(), signedUrl: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSession: async () => state.user ? { userId: state.user } : null }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }), getRateLimitKey: () => 'test' }));
vi.mock('@/lib/reportOperationError', () => ({ reportOperationError: state.report }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user } } }) } }) }));
vi.mock('@ambo/database/admin-client', () => ({ createAdminClient: () => ({
  rpc: state.rpc,
  from: (table: string) => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'post-1' } }) }) }), select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { role: state.role } }),
    single: async () => ({ data: table === 'posts' ? { id: 'post-1', post_attachments: [] } : null }),
  }) }) }),
  storage: { from: () => ({ createSignedUploadUrl: state.signedUrl, info: state.info, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
}) }));
import { POST as prepare } from '@/app/api/posts/uploads/route';
import { POST as publish } from '@/app/api/posts/route';
import { verifyUploadTicket } from '@/lib/postUploads';
const request = (body: unknown, bearer = false) => new Request('https://app.example/api/posts', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer mobile-session' } : {}) }, body: JSON.stringify(body),
});
const file = { name: 'photo.jpg', size: 8 * 1024 * 1024, type: 'image/jpeg' };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = 'test-key-with-enough-entropy';
  state.user = '00000000-0000-4000-8000-000000000001'; state.role = 'student';
  state.rpc.mockResolvedValue({ data: 'post-1', error: null });
  state.info.mockResolvedValue({ data: { size: file.size }, error: null });
  state.signedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null });
});
async function ticket() { return (await (await prepare(request({ files: [file] }))).json()).ticket; }

describe('authorized post uploads', () => {
  it.each([false, true])('publishes complete uploads atomically for cookie or mobile sessions (bearer=%s)', async bearer => {
    const upload_ticket = await ticket();
    const response = await publish(request({ content: 'Hello', upload_ticket }, bearer));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('create_post_with_attachments', expect.objectContaining({
      target_user_id: state.user, target_content: 'Hello',
      target_attachments: [expect.objectContaining({ file_size: file.size, file_name: file.name })],
    }));
  });
  it('never creates the post when an upload is missing or incomplete', async () => {
    const upload_ticket = await ticket();
    state.info.mockResolvedValue({ data: null, error: { status: 404 } });
    expect((await publish(request({ content: 'Hello', upload_ticket }))).status).toBe(400);
    state.info.mockResolvedValue({ data: { size: 10 }, error: null });
    expect((await publish(request({ content: 'Hello', upload_ticket }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('preserves the iPhone app’s attachment-only posts', async () => {
    const upload_ticket = await ticket();
    expect((await publish(request({ content: '', upload_ticket }, true))).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('create_post_with_attachments', expect.objectContaining({ target_content: '' }));
  });
  it('rejects another user’s ticket, tampering, anonymous users and applicants', async () => {
    const upload_ticket = await ticket();
    state.user = '00000000-0000-4000-8000-000000000002';
    expect((await publish(request({ content: 'Hello', upload_ticket }))).status).toBe(400);
    state.user = ''; expect((await prepare(request({ files: [] }))).status).toBe(401);
    state.user = '00000000-0000-4000-8000-000000000001'; state.role = 'applicant';
    expect((await prepare(request({ files: [] }))).status).toBe(403);
    state.role = 'student';
    expect((await publish(request({ content: 'Hello', upload_ticket: upload_ticket + 'x' }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('keeps the draft ID when attachments change', async () => {
    const previous_ticket = await ticket();
    const response = await prepare(request({ files: [], previous_ticket }));
    const next = await response.json();
    expect((await verifyUploadTicket(next.ticket, state.user)).postId).toBe((await verifyUploadTicket(previous_ticket, state.user)).postId);
  });
  it('reports database failures without accepting a partial save', async () => {
    const upload_ticket = await ticket();
    state.rpc.mockResolvedValue({ error: { code: 'XX000', message: 'internal detail' } });
    const response = await publish(request({ content: 'Private post text', upload_ticket }));
    expect(response.status).toBe(500);
    expect(state.report).toHaveBeenCalledWith('post.publish', expect.objectContaining({ code: 'XX000' }));
    expect(await response.text()).not.toContain('internal detail');
  });
});
