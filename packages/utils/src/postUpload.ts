export interface PostUploadFile {
  key: string;
  name: string;
  size: number;
  type: string;
  body: () => Promise<BodyInit>;
}
export interface PostUploadPlan {
  ticket: string;
  uploads: { signedUrl: string }[];
}
export interface PostUploadAttempt {
  plan?: PostUploadPlan;
  fingerprint?: string;
  uploaded?: boolean[];
}
export class PostUploadError extends Error {
  constructor(message: string, public readonly stage: string, public readonly status?: number) {
    super(message);
    this.name = 'PostUploadError';
  }
}
export async function publishPost(
  attempt: PostUploadAttempt,
  content: string,
  files: PostUploadFile[],
  options: { baseUrl?: string; token?: string } = {},
): Promise<{ id: string }> {
  const base = (options.baseUrl || '').replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const request = async (path: string, body: unknown, stage: string) => {
    let response: Response;
    try {
      response = await fetch(`${base}/api/posts${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new PostUploadError('Could not reach the server. Your draft is still here. Check your connection and try again.', stage);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || response.redirected || !data) {
      throw new PostUploadError(response.status === 401
        ? 'Your session expired. Sign in again before posting.'
        : data?.error || 'Could not save the post. Your draft is still here. Please try again.', stage, response.status);
    }
    return data;
  };

  const fingerprint = JSON.stringify(files.map(({ key, name, size, type }) => [key, name, size, type]));
  if (!attempt.plan || attempt.fingerprint !== fingerprint) {
    const plan = await request('/uploads', {
      files: files.map(({ name, size, type }) => ({ name, size, type })),
      previous_ticket: attempt.plan?.ticket,
    }, 'prepare');
    if (typeof plan.ticket !== 'string' || !Array.isArray(plan.uploads) || plan.uploads.length !== files.length) {
      throw new PostUploadError('Could not prepare the attachments. Please try again.', 'prepare');
    }
    attempt.plan = plan;
    attempt.fingerprint = fingerprint;
    attempt.uploaded = files.map(() => false);
  }
  const plan = attempt.plan!;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (attempt.uploaded?.[index]) continue;
    try {
      const response = await fetch(plan.uploads[index].signedUrl, {
        method: 'PUT', credentials: 'omit',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'cache-control': 'max-age=3600', 'x-upsert': 'false' },
        body: await file.body(),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        // A lost successful upload response can make a retry report Duplicate.
        // The server will still verify the stored object's size before publishing.
        const alreadyUploaded = [400, 409].includes(response.status)
          && (error?.error === 'Duplicate' || error?.statusCode === '409');
        if (!alreadyUploaded) throw new PostUploadError('An attachment could not upload. Your draft is still here. Please try again.', 'upload', response.status);
      }
      attempt.uploaded![index] = true;
    } catch (error) {
      if (error instanceof PostUploadError) throw error;
      throw new PostUploadError('An attachment could not upload. Your draft is still here. Check your connection and try again.', 'upload');
    }
  }
  const data = await request('', { content, upload_ticket: plan.ticket }, 'publish');
  if (!data.post?.id) throw new PostUploadError('Could not confirm the post was saved. Please try again.', 'publish');
  return data.post;
}
