import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishPost, type PostUploadAttempt } from '../../../../packages/utils/src/postUpload';
import { redactUploadTelemetry } from '../../../../packages/utils/src/uploadTelemetry';

const file = { key: 'photo-1', name: 'photo.jpg', size: 8 * 1024 * 1024, type: 'image/jpeg', body: async () => new Blob([new Uint8Array(8 * 1024 * 1024)]) };
const plan = { ticket: 'signed-ticket', uploads: [{ signedUrl: 'https://storage.example/upload?token=secret' }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe('post upload and retry', () => {
  it('uploads bytes directly to storage and sends only JSON to the app, including for 8 MB files', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ post: { id: 'post-1' } }));
    vi.stubGlobal('fetch', request);
    expect(await publishPost({}, 'Hello', [file], { baseUrl: 'https://app.example', token: 'session-token' })).toEqual({ id: 'post-1' });
    expect(request.mock.calls.map(call => call[0])).toEqual(['https://app.example/api/posts/uploads', plan.uploads[0].signedUrl, 'https://app.example/api/posts']);
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'PUT', credentials: 'omit' });
    expect(request.mock.calls[1][1].headers.Authorization).toBeUndefined();
    expect(request.mock.calls[1][1].body).toBeInstanceOf(Blob);
    expect(request.mock.calls[1][1].body.size).toBe(file.size);
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ content: 'Hello', upload_ticket: plan.ticket });
    expect(request.mock.calls[2][1].headers.Authorization).toBe('Bearer session-token');
  });
  it('keeps the draft plan after an upload fails, and publishes nothing until retry succeeds', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(plan)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', request);
    const attempt: PostUploadAttempt = {};
    await expect(publishPost(attempt, 'Hello', [file])).rejects.toMatchObject({ stage: 'upload' });
    expect(request).toHaveBeenCalledTimes(2);
    // Upload may have reached storage despite a lost response.
    request.mockResolvedValueOnce(json({ error: 'Duplicate', statusCode: '409' }, 400)).mockResolvedValueOnce(json({ post: { id: 'post-1' } }));
    await publishPost(attempt, 'Hello', [file]);
    expect(request.mock.calls.filter(call => call[0] === '/api/posts/uploads')).toHaveLength(1);
  });
  it('retries a lost publish response with the same ticket without uploading again', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json({})).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', request);
    const attempt: PostUploadAttempt = {};
    await expect(publishPost(attempt, 'Hello', [file])).rejects.toMatchObject({ stage: 'publish' });
    request.mockResolvedValueOnce(json({ post: { id: 'post-1' } }));
    await publishPost(attempt, 'Hello', [file]);
    expect(request.mock.calls[2][1].body).toEqual(request.mock.calls[3][1].body);
  });
  it('keeps the same draft identity when attachments are changed after a failure', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(plan)).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', request);
    const attempt: PostUploadAttempt = {};
    await expect(publishPost(attempt, 'Hello', [file])).rejects.toThrow();
    request.mockResolvedValueOnce(json({ ticket: 'replacement-ticket', uploads: [] })).mockResolvedValueOnce(json({ post: { id: 'post-1' } }));
    await publishPost(attempt, 'Hello', []);
    expect(JSON.parse(request.mock.calls[2][1].body).previous_ticket).toBe(plan.ticket);
  });
});

it('redacts signed URLs and upload tickets in nested error and performance data', () => {
  const event = { spans: [{ description: 'PUT https://db.example/storage/v1/object/upload/sign/post-attachments/photo.jpg?token=secret', data: { status: 200 } }],
    request: { data: { upload_ticket: 'credential', previous_ticket: 'credential' } } };
  const clean = redactUploadTelemetry(event);
  expect(JSON.stringify(clean)).not.toMatch(/secret|credential/);
  expect(clean.spans[0].data.status).toBe(200);
  expect(event.request.data.upload_ticket).toBe('credential');
});
