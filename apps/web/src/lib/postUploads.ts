import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { checkFileExtension, MAX_FILE_SIZE } from '@/lib/validations';

export const POST_UPLOAD_BUCKET = 'post-attachments';
export const uploadFileSchema = z.object({
  name: z.string().min(1).max(240).refine(checkFileExtension, 'This file type is not allowed.'),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  type: z.string().max(150).default('application/octet-stream'),
});
const attachmentSchema = uploadFileSchema.extend({ id: z.string().uuid(), path: z.string() });
const ticketSchema = z.object({ postId: z.string().uuid(), files: z.array(attachmentSchema).max(5) });
export type UploadTicket = z.infer<typeof ticketSchema>;
const audience = 'ambo-post-upload';
function key() {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error('Missing upload signing key');
  // Domain separation: an upload ticket can never be used as a login session.
  return new TextEncoder().encode(`${audience}:${secret}`);
}
export function createUploadPlan(userId: string, files: z.infer<typeof uploadFileSchema>[], postId: string = randomUUID()): UploadTicket {
  return { postId, files: files.map(file => {
    const id = randomUUID();
    const name = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    return { ...file, type: file.type || 'application/octet-stream', id, path: `${userId}/${postId}/${id}_${name}` };
  }) };
}
export async function signUploadTicket(userId: string, plan: UploadTicket) {
  return new SignJWT(plan).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuer(audience).setAudience(audience).setIssuedAt().setExpirationTime('2h').sign(key());
}
export async function verifyUploadTicket(ticket: string, userId: string): Promise<UploadTicket> {
  const { payload } = await jwtVerify(ticket, key(), { algorithms: ['HS256'], issuer: audience, audience, subject: userId });
  return ticketSchema.parse(payload);
}
