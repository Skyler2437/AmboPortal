import { NextResponse } from 'next/server';
import { z } from 'zod';
import { communityActor, mutationLimit, readBody, fail } from '@/lib/community/server';
import { createUploadPlan, signUploadTicket, verifyUploadTicket, uploadFileSchema, POST_UPLOAD_BUCKET } from '@/lib/postUploads';
import { reportOperationError } from '@/lib/reportOperationError';

const requestSchema = z.object({ files: z.array(uploadFileSchema).max(5), previous_ticket: z.string().max(16000).optional() });

export async function POST(req: Request) {
  try {
    const auth = await communityActor(req);
    if (auth.response) return auth.response;
    const limited = await mutationLimit(auth.actor.userId);
    if (limited) return limited;
    const input = requestSchema.safeParse(await readBody(req));
    if (!input.success) return fail('Choose up to 5 supported files, each between 1 byte and 10MB.');
    let postId: string | undefined;
    if (input.data.previous_ticket) {
      try { postId = (await verifyUploadTicket(input.data.previous_ticket, auth.actor.userId)).postId; }
      catch { return fail('This upload expired. Copy your text and start a new post.', 400); }
    }
    const plan = createUploadPlan(auth.actor.userId, input.data.files, postId);
    const storage = auth.db.storage.from(POST_UPLOAD_BUCKET);
    const uploads = [];
    for (const file of plan.files) {
      const { data, error } = await storage.createSignedUploadUrl(file.path, { upsert: false });
      if (error || !data) {
        reportOperationError('post.prepare_upload', error);
        return fail('Could not prepare the attachments. Please try again.', 503);
      }
      uploads.push({ signedUrl: data.signedUrl });
    }
    return NextResponse.json({ ticket: await signUploadTicket(auth.actor.userId, plan), uploads });
  } catch (error) {
    if (error instanceof SyntaxError) return fail('Invalid request. Please try again.');
    if (error instanceof Error && error.message === 'BODY_TOO_LARGE') return fail('This post is too large.', 413);
    reportOperationError('post.prepare_upload', error);
    return fail('Could not prepare the post. Please try again.', 500);
  }
}
