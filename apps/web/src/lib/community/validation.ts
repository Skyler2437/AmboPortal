import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
export const communityPostSchema = z.object({
  content: z.string().trim().min(1, "Enter a post or poll question.").max(5000),
  publish_at: timestamp.nullable().optional().default(null),
  poll: z.object({
    options: z.array(z.string().trim().min(1, "Every option needs text.").max(200))
      .min(2, "Add at least two options.").max(6, "Use no more than six options.")
      .refine(options => new Set(options.map(s => s.toLowerCase())).size === options.length,
        "Each option must be different."),
    closes_at: timestamp.nullable().optional().default(null),
  }).strict().nullable().optional().default(null),
}).strict().superRefine((value, ctx) => {
  const now = Date.now();
  const publish = value.publish_at ? Date.parse(value.publish_at) : now;
  if (value.publish_at && publish <= now) {
    ctx.addIssue({ code: "custom", path: ["publish_at"], message: "Choose a future publishing time." });
  }
  if (value.poll?.closes_at && Date.parse(value.poll.closes_at) <= publish) {
    ctx.addIssue({ code: "custom", path: ["poll", "closes_at"], message: "The poll must close after it is published." });
  }
});
export const voteSchema = z.object({ option_id: z.string().uuid() }).strict();
export const postIdSchema = z.string().uuid();
