import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";
import { postSchema } from "@/lib/validations";
import { parsePagination, buildPaginatedResponse } from "@/lib/pagination";
import { communityActor, readBody, fail } from "@/lib/community/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createUploadPlan, verifyUploadTicket, uploadFileSchema, POST_UPLOAD_BUCKET, type UploadTicket } from "@/lib/postUploads";
import { reportOperationError } from "@/lib/reportOperationError";
import { sanitizeText } from "@/lib/sanitize";


export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { page, limit, from, to } = parsePagination(
            new URL(req.url),
            { page: 1, limit: 25 }
        );

        const supabase = createAdminClient();
        const { data, error, count } = await supabase
            .from("posts")
            .select(`
                *,
                users (
                    first_name,
                    last_name,
                    role,
                    avatar_url
                ),
                comments (count),
                post_likes (count),
                post_views (count),
                post_attachments (id, file_url, file_name, file_type, file_size)
            `, { count: "exact" })
            .order("created_at", { ascending: false })
            .range(from, to);

        if (error) {
            console.error("[GET /api/posts] Supabase error:", error);
            return NextResponse.json({ error: "Request failed" }, { status: 400 });
        }

        const postIds = (data || []).map((p) => p.id);
        const likedSet = new Set<string>();
        if (postIds.length > 0) {
            const { data: liked } = await supabase
                .from("post_likes")
                .select("post_id")
                .eq("user_id", session.userId)
                .in("post_id", postIds);
            (liked || []).forEach((row) => likedSet.add(row.post_id));
        }

        const enriched = (data || []).map((p) => ({
            ...p,
            like_count: p.post_likes?.[0]?.count ?? 0,
            view_count: p.post_views?.[0]?.count ?? 0,
            has_liked: likedSet.has(p.id),
            attachments: p.post_attachments ?? [],
        }));

        return NextResponse.json(buildPaginatedResponse(enriched, count || 0, { page, limit, from, to }));
    } catch (err) {
        console.error("[GET /api/posts] Unhandled error:", err);
        return NextResponse.json(
            { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    try {
        const auth = await communityActor(req);
        if (auth.response) return auth.response;
        const limited = await checkRateLimit(`posts:${auth.actor.userId}`, { maxRequests: 10, windowSeconds: 300 });
        if (!limited.allowed) return fail("Too many posts. Please wait before posting again.", 429);
        const storage = auth.db.storage.from(POST_UPLOAD_BUCKET);
        let rawContent: unknown;
        let plan: UploadTicket;
        if (req.headers.get("content-type")?.includes("multipart/form-data")) {
            // Compatibility for already-open web tabs. New clients upload directly.
            const form = await req.formData();
            rawContent = form.get("content");
            const files = form.getAll("files").filter((file): file is File => file instanceof File);
            const parsedFiles = uploadFileSchema.array().max(5).safeParse(files.map(file => ({
                name: file.name, size: file.size, type: file.type,
            })));
            if (!parsedFiles.success) return fail("Choose up to 5 supported files, each between 1 byte and 10MB.");
            if (!postSchema.safeParse({ content: rawContent }).success) return fail("Enter post text between 1 and 5,000 characters.");
            plan = createUploadPlan(auth.actor.userId, parsedFiles.data);
            // Upload before publishing. Any failure leaves the post unpublished.
            for (let index = 0; index < files.length; index++) {
                const file = files[index];
                const { error } = await storage.upload(plan.files[index].path, file, { upsert: false, contentType: plan.files[index].type });
                if (error) {
                    reportOperationError("post.upload", error);
                    return fail("An attachment could not upload. Please try again.", 503);
                }
            }
        } else {
            const body = await readBody(req) as { content?: unknown; upload_ticket?: unknown } | null;
            rawContent = body?.content;
            if (body?.upload_ticket !== undefined) {
                if (typeof body.upload_ticket !== "string") return fail("Invalid upload. Please try again.");
                try { plan = await verifyUploadTicket(body.upload_ticket, auth.actor.userId); }
                catch { return fail("This upload is invalid or expired. Copy your text and start a new post."); }
            } else {
                // Older clients can still create text-only posts.
                plan = createUploadPlan(auth.actor.userId, []);
            }
        }
        const parsed = postSchema.safeParse({ content: rawContent });
        const attachmentOnly = plan.files.length > 0 && typeof rawContent === "string" && !rawContent.trim();
        if (!parsed.success && !attachmentOnly) return fail(parsed.error.issues[0].message);
        const content = parsed.success ? sanitizeText(parsed.data.content) : "";
        if (!content.trim() && !plan.files.length) return fail("Enter some text for your post.");
        const attachments = [];
        for (const file of plan.files) {
            const { data, error } = await storage.info(file.path);
            if (error || !data) {
                reportOperationError("post.verify_upload", error);
                return fail("An attachment has not finished uploading. Please try again.");
            }
            const storedSize = data.size ?? data.metadata?.size;
            if (Number(storedSize) !== file.size) return fail("An attachment did not upload completely. Remove it and attach it again.");
            attachments.push({ id: file.id, file_url: storage.getPublicUrl(file.path).data.publicUrl,
                file_name: file.name, file_type: file.type, file_size: file.size });
        }
        const { error } = await auth.db.rpc("create_post_with_attachments", {
            target_post_id: plan.postId, target_user_id: auth.actor.userId,
            target_content: content, target_attachments: attachments,
        });
        if (error) {
            if (error.code === "PT409") return fail("This draft was already published. Check the post feed before starting another post.", 409);
            reportOperationError("post.publish", error);
            return fail("Could not save the post. Your draft is still here. Please try again.", 500);
        }
        const { data: post, error: readError } = await auth.db.from("posts")
            .select("*, users(first_name, last_name, role, avatar_url), post_attachments(id, file_url, file_name, file_type, file_size)")
            .eq("id", plan.postId).single();
        if (readError || !post) {
            reportOperationError("post.confirm", readError);
            return fail("Could not confirm the post was saved. Please try again.", 503);
        }
        return NextResponse.json({ post: { ...post, attachments: post.post_attachments || [] } });
    } catch (error) {
        if (error instanceof SyntaxError) return fail("Invalid request. Please try again.");
        if (error instanceof Error && error.message === "BODY_TOO_LARGE") return fail("This post is too large.", 413);
        reportOperationError("post.publish", error);
        return fail("Could not save the post. Your draft is still here. Please try again.", 500);
    }
}
