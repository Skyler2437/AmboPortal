import { z } from "zod";
import { SERVICE_TYPES } from "@ambo/database/types";

export const postSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be 5000 characters or less"),
});

export const commentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(2000, "Comment must be 2000 characters or less"),
});

export const submissionSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  service_date: z.string().refine((val) => {
    const date = new Date(val);
    if (isNaN(date.getTime())) return false;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return date < tomorrow;
  }, "Service date must not be in the future"),
  service_type: z.enum(SERVICE_TYPES, {
    message: "Invalid service type",
  }),
  credits: z.coerce.number().min(0, "Credits must be non-negative").default(0),
  hours: z.coerce.number().min(0, "Hours must be non-negative").max(24, "Hours cannot exceed 24").default(0),
  feedback: z
    .string()
    .max(2000, "Feedback must be 2000 characters or less")
    .optional()
    .nullable()
    .transform((val) => val || null),
});

export const eventSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or less"),
  start_time: z.string().refine((val) => !isNaN(new Date(val).getTime()), "Invalid start time"),
  end_time: z.string().refine((val) => !isNaN(new Date(val).getTime()), "Invalid end time"),
  description: z
    .string()
    .max(5000, "Description must be 5000 characters or less")
    .optional()
    .nullable(),
  location: z.string().max(500).optional().nullable(),
  type: z.string().max(100).optional(),
  uniform: z.string().max(500).optional(),
  rsvp_options: z.array(z.string()).optional(),
}).refine(
  (data) => new Date(data.end_time) > new Date(data.start_time),
  { message: "End time must be after start time", path: ["end_time"] }
);

/**
 * Fields an event manager may change through the public event API.
 * Server-managed columns (calendar IDs, ownership, reminders, timestamps)
 * are intentionally absent and strict mode rejects attempts to smuggle them
 * into an update.
 */
export const eventUpdateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or less")
    .optional(),
  start_time: z.string()
    .refine((val) => !isNaN(new Date(val).getTime()), "Invalid start time")
    .optional(),
  end_time: z.string()
    .refine((val) => !isNaN(new Date(val).getTime()), "Invalid end time")
    .optional(),
  description: z
    .string()
    .max(5000, "Description must be 5000 characters or less")
    .nullable()
    .optional(),
  type: z.string().max(100, "Type must be 100 characters or less").optional(),
  uniform: z.string().max(500, "Uniform must be 500 characters or less").nullable().optional(),
  rsvp_options: z.array(z.union([
    z.string()
      .trim()
      .min(1, "RSVP option cannot be blank")
      .max(200, "RSVP option must be 200 characters or less"),
    z.object({
      id: z.string().uuid("Invalid RSVP option ID").optional(),
      label: z.string()
        .trim()
        .min(1, "RSVP option cannot be blank")
        .max(200, "RSVP option must be 200 characters or less"),
    }).strict(),
  ])).max(50, "An event can have at most 50 RSVP options").optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one editable field is required" },
);

export const userCreateSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(100, "First name must be 100 characters or less"),
  last_name: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(100, "Last name must be 100 characters or less"),
  phone: z.string().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
  email: z.string().email("Invalid email address"),
  role: z.enum(["student", "admin"]).optional(),
});

export const chatMessageSchema = z.object({
  groupId: z.string().uuid("Invalid group ID"),
  content: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(5000, "Message must be 5000 characters or less"),
});

/** Max JSON payload size in bytes (100KB) */
export const MAX_JSON_PAYLOAD = 100_000;

/** Max file upload size in bytes (10MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Max CSV upload size in bytes (5MB) */
export const MAX_CSV_SIZE = 5 * 1024 * 1024;

/** Allowed file extensions for resource uploads */
export const ALLOWED_FILE_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".csv", ".txt",
];

export function checkContentLength(req: Request, maxBytes: number = MAX_JSON_PAYLOAD): string | null {
  const contentLength = parseInt(req.headers.get("content-length") || "0");
  if (contentLength > maxBytes) {
    return "Payload too large";
  }
  return null;
}

export function checkFileExtension(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext);
}
