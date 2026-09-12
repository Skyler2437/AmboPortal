"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, Paperclip, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { PostSettings, emptyPostSettings, postSettingsPayload } from "@/components/post/PostSettings";
import { communityPostSchema } from "@/lib/community/validation";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".csv", ".txt",
];

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowed(file: File) {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
}

export function CreatePostForm({ backPath, canManagePosts = false }: { backPath: string; canManagePosts?: boolean }) {
    const router = useRouter();
    const [content, setContent] = useState("");
    const [settings, setSettings] = useState(emptyPostSettings);
    const advanced = canManagePosts && (settings.scheduled || settings.isPoll);
    const [files, setFiles] = useState<File[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFilesSelected = (selected: FileList | null) => {
        if (!selected) return;
        const incoming = Array.from(selected);
        const accepted: File[] = [];
        for (const f of incoming) {
            if (!isAllowed(f)) {
                toast.error(`"${f.name}" — file type not allowed.`);
                continue;
            }
            if (f.size > MAX_FILE_BYTES) {
                toast.error(`"${f.name}" exceeds 10MB.`);
                continue;
            }
            accepted.push(f);
        }
        const combined = [...files, ...accepted];
        if (combined.length > MAX_FILES) {
            toast.error(`Maximum ${MAX_FILES} attachments per post.`);
        }
        setFiles(combined.slice(0, MAX_FILES));
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const removeFile = (idx: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleSubmit = async () => {
        if (!content.trim() || submitting) return;
        setSubmitting(true);
        setError("");

        try {
            let res: Response;
            if (advanced) {
                if (files.length) throw new Error("Remove attachments before scheduling or creating a poll.");
                const parsed = communityPostSchema.safeParse(postSettingsPayload(content, settings));
                if (!parsed.success) throw new Error(parsed.error.issues[0].message);
                res = await fetch("/api/community/posts", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
                });
            } else if (files.length > 0) {
                const form = new FormData();
                form.append("content", content);
                files.forEach((f) => form.append("files", f, f.name));
                res = await fetch("/api/posts", { method: "POST", body: form });
            } else {
                res = await fetch("/api/posts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content }),
                });
            }

            const data = await res.json().catch(() => ({}));

            if (res.ok && !res.redirected && (advanced ? data.id : data.post?.id)) {
                toast.success(settings.scheduled ? "Post scheduled" : "Post created");
                router.push(backPath);
            } else {
                setError(data.error || "Failed to create post.");
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Network error. Please try again.");
        }
        setSubmitting(false);
    };

    return (
        <div className="max-w-2xl mx-auto">
            <Card>
                <CardContent className="p-4 pt-4 space-y-4">
                    <Textarea
                        value={content}
                        onChange={(e) => {
                            setContent(e.target.value);
                            if (error) setError("");
                        }}
                        aria-label={settings.isPoll ? "Poll question" : "Post text"}
                        placeholder={settings.isPoll ? "Ask the team a question…" : "Share something with the team..."}
                        className="min-h-[160px] resize-none"
                        autoFocus
                    />

                    {canManagePosts && <PostSettings value={settings} onChange={setSettings} disabled={submitting} />}

                    {files.length > 0 && (
                        <div className="space-y-2">
                            {files.map((f, idx) => (
                                <div key={`${f.name}-${idx}`} className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeFile(idx)}
                                        className="text-muted-foreground hover:text-red-500"
                                        aria-label={`Remove ${f.name}`}
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept={ALLOWED_EXTENSIONS.join(",")}
                        onChange={(e) => handleFilesSelected(e.target.files)}
                    />

                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="flex justify-between items-center gap-2 flex-wrap">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={files.length >= MAX_FILES || advanced}
                        >
                            <Paperclip className="h-4 w-4 mr-2" />
                            Attach {files.length > 0 && `(${files.length}/${MAX_FILES})`}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => router.push(backPath)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={!content.trim() || submitting}
                            >
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {submitting ? "Saving..." : settings.scheduled ? "Schedule post" : "Post"}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
