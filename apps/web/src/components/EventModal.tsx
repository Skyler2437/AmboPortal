"use client";

import { useRef, useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Clock, Shirt, Loader2, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
    DrawerFooter,
    DrawerClose
} from "@/components/ui/drawer";
import type { EventDetails, EventComment, EventRSVP, EventRSVPOption, UserRole } from "@ambo/database/types";
import { EventRsvpSection } from "@/components/event/EventRsvpSection";
import { EventAttachmentsSection } from "@/components/event/EventAttachmentsSection";
import { EventCommentSection, EventCommentInput } from "@/components/event/EventCommentSection";

export function EventModal({
    event,
    onClose,
    currentUserId,
    userRole,
    onEventChanged,
}: {
    event: EventDetails;
    onClose: () => void;
    currentUserId: string;
    userRole: UserRole;
    onEventChanged?: () => void;
}) {
    // Data State
    const [comments, setComments] = useState<EventComment[]>([]);
    const [rsvps, setRsvps] = useState<EventRSVP[]>([]);
    const [rsvpOptions, setRsvpOptions] = useState<EventRSVPOption[]>([]);
    const [editRsvpOptions, setEditRsvpOptions] = useState<string[]>([]);
    const [attachments, setAttachments] = useState<Array<{ id: string; file_url: string; file_name: string; file_type: string; file_size: number }>>([]);
    const [uploadingAttachment, setUploadingAttachment] = useState(false);
    const attachmentInputRef = useRef<HTMLInputElement>(null);

    // Permission Logic
    const isSuperAdmin = userRole === "superadmin";
    const isAdmin = userRole === "admin";

    // Event Permission:
    // Superadmin: All.
    // Admin: Can edit own events? Can edit other admin events?
    // Rule: "Admin ... can delete ... any student user and their own, but not other admin users."
    // Does this apply to events? "An Admin user should be able to delete or edit a post, event, comment... of any student user and their own, but not other admin users."
    // Events usually created by admins.
    // So if Event A created by Admin A. Admin B cannot edit/delete it.

    const eventCreatorRole = event.users?.role || "admin"; // Default to admin for events if unknown, as usually admins create them.
    const isMyEvent = event.created_by === currentUserId;

    // Admin can edit if: it's mine OR creator is student (unlikely for events) OR I am superadmin.
    // If creator is another admin, I cannot edit.

    const canEditEvent = isSuperAdmin || isMyEvent || (isAdmin && eventCreatorRole === "student");

    // Comment Permission:
    const canEditComment = (comment: EventComment) => {
        const isMyComment = comment.user_id === currentUserId;
        const commentOwnerRole = comment.users?.role || "student";
        return isSuperAdmin || isMyComment || (isAdmin && commentOwnerRole === "student");
    };


    // UI State
    const [newComment, setNewComment] = useState("");
    const [loadingComment, setLoadingComment] = useState(false);
    const [loadingRsvp, setLoadingRsvp] = useState(false);

    // Edit Event State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<EventDetails>>({});
    const [saving, setSaving] = useState(false);

    // Edit Comment State
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [editCommentContent, setEditCommentContent] = useState("");


    const fetchData = async () => {
        try {
            const res = await fetch(`/api/events/comments?event_id=${event.id}`);
            if (res.ok) {
                const data = await res.json();
                setComments(data.comments || []);
                setRsvps(data.rsvps || []);
                setRsvpOptions(data.rsvp_options || []);
                setEditRsvpOptions((data.rsvp_options || []).map((o: EventRSVPOption) => o.label));
                setAttachments(data.attachments || []);
            }
        } catch (e) {
            console.error("Failed to fetch event data", e);
        }
    };

    const handleAttachmentUpload = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        setUploadingAttachment(true);
        try {
            const form = new FormData();
            Array.from(fileList).forEach((f) => form.append("files", f, f.name));
            const res = await fetch(`/api/events/${event.id}/attachments`, {
                method: "POST",
                body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setAttachments((prev) => [...prev, ...(data.attachments || [])]);
                toast.success("Attachment uploaded");
            } else {
                toast.error(data.error || "Failed to upload attachment");
            }
        } catch {
            toast.error("Failed to upload attachment");
        }
        setUploadingAttachment(false);
        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    };

    const deleteAttachment = async (attachmentId: string) => {
        const res = await fetch(`/api/events/${event.id}/attachments/${attachmentId}`, {
            method: "DELETE",
        });
        if (res.ok) {
            setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
            toast.success("Attachment removed");
        } else {
            toast.error("Failed to remove attachment");
        }
    };

    const isImageAttachment = (att: { file_type: string; file_name: string }) =>
        ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(att.file_type) ||
        /\.(jpe?g|png|gif|webp)$/i.test(att.file_name);

    const isDesktop = useMediaQuery("(min-width: 768px)");

    useEffect(() => {
        fetchData();
        setEditForm({
            title: event.title,
            description: event.description,
            uniform: event.uniform,
            start_time: event.start_time,
            end_time: event.end_time
        });
    }, [event.id]);

    // --- Comments Logic ---

    const postComment = async () => {
        if (!newComment.trim() || loadingComment) return;
        setLoadingComment(true);

        try {
            const res = await fetch("/api/events/comments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    event_id: event.id,
                    content: newComment.trim(),
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.comment) {
                    setComments((prev) => [...prev, data.comment]);
                } else if (Array.isArray(data.comments)) {
                    setComments(data.comments);
                }
                setNewComment("");
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || "Failed to post comment");
            }
        } catch (e) {
            console.error("Failed to post comment", e);
            toast.error("Failed to post comment");
        }
        setLoadingComment(false);
    };

    const deleteComment = async (commentId: string) => {
        const res = await fetch(`/api/events/comments/${commentId}`, { method: "DELETE" });
        if (res.ok) {
            setComments(comments.filter(c => c.id !== commentId));
            toast.success("Comment deleted");
        } else {
            toast.error("Failed to delete comment");
        }
    };

    const startEditComment = (comment: EventComment) => {
        setEditingCommentId(comment.id);
        setEditCommentContent(comment.content);
    };

    const saveCommentEdit = async (commentId: string) => {
        const res = await fetch(`/api/events/comments/${commentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: editCommentContent }),
        });
        if (res.ok) {
            const data = await res.json();
            setComments(comments.map(c => c.id === commentId ? { ...c, content: data.comment.content } : c));
            setEditingCommentId(null);
            toast.success("Comment updated");
        } else {
            toast.error("Failed to update comment");
        }
    };

    // --- RSVP Logic ---

    const handleRsvp = async (status: string, rsvpOptionId?: string, explanation?: string) => {
        if (loadingRsvp) return false;
        setLoadingRsvp(true);

        try {
            const res = await fetch("/api/events/rsvp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    event_id: event.id,
                    status,
                    ...(rsvpOptionId && { rsvp_option_id: rsvpOptionId }),
                    ...(explanation !== undefined && { explanation }),
                }),
            });

            if (res.ok) {
                await fetchData();
                onEventChanged?.();
                return true;
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || "Failed to update RSVP");
            }
        } catch (e) {
            console.error("Failed to update RSVP", e);
            toast.error("Failed to update RSVP");
        } finally {
            setLoadingRsvp(false);
        }
        return false;
    };

    // --- Event Logic ---

    const handleSaveEvent = async () => {
        setSaving(true);
        const res = await fetch(`/api/events/${event.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...editForm,
                rsvp_options: editRsvpOptions.filter(o => o.trim()),
            }),
        });

        if (res.ok) {
            const data = await res.json();
            if (data.gcal_sync && !data.gcal_sync.synced) {
                toast.error(`Event saved, but Google Calendar sync failed: ${data.gcal_sync.reason}`);
            } else {
                toast.success("Event updated");
            }
            setIsEditing(false);
            onEventChanged?.();
            onClose();
        } else {
            toast.error("Failed to update event");
        }
        setSaving(false);
    };

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleDeleteEvent = async () => {
        setDeleting(true);
        const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
        if (res.ok) {
            toast.success("Event deleted");
            setShowDeleteConfirm(false);
            onEventChanged?.();
            onClose();
        } else {
            toast.error("Failed to delete event");
        }
        setDeleting(false);
    };

    // --- Utilities ---

    const formatTime = (d: string) =>
        new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const formatDate = (d: string) =>
        new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    // datetime-local inputs deal in local wall-clock time; shift by the zone
    // offset before formatting (a bare toISOString() displays UTC, which then
    // shifts the event time on save).
    const toDatetimeLocal = (iso: string) => {
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };

    const going = rsvps.filter((r) => r.status === "going");
    const maybe = rsvps.filter((r) => r.status === "maybe");
    const myRsvp = rsvps.find(r => r.user_id === currentUserId)?.status;

    const rsvpButtons = [
        {
            status: "going",
            label: "Going",
            activeClass: "bg-green-600 hover:bg-green-700",
        },
        {
            status: "maybe",
            label: "Maybe",
            activeClass: "bg-amber-500 text-white hover:bg-amber-600",
        },
        {
            status: "no",
            label: "Can't go",
            activeClass: "",
        },
    ];

    const getInitials = (firstName?: string, lastName?: string) => {
        return `${(firstName || "?")[0]}${(lastName || "")[0] || ""}`.toUpperCase();
    };

    const Content = (
        <div className={cn("flex flex-col h-full", isDesktop ? "max-h-[85vh]" : "max-h-[85vh]")}>
            <div className="p-6 pb-4 border-b">
                <div className="flex items-start justify-between gap-4">
                    {isEditing ? (
                        <div className="w-full space-y-3">
                            <Input
                                value={editForm.title}
                                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                className="text-lg font-bold"
                                placeholder="Event Title"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    type="datetime-local"
                                    value={editForm.start_time ? toDatetimeLocal(editForm.start_time) : ""}
                                    onChange={e => setEditForm({ ...editForm, start_time: new Date(e.target.value).toISOString() })}
                                />
                                <Input
                                    type="datetime-local"
                                    value={editForm.end_time ? toDatetimeLocal(editForm.end_time) : ""}
                                    onChange={e => setEditForm({ ...editForm, end_time: new Date(e.target.value).toISOString() })}
                                />
                            </div>
                        </div>
                    ) : (
                        <div>
                            {isDesktop ? (
                                <DialogTitle className="text-xl">{event.title}</DialogTitle>
                            ) : (
                                <DrawerTitle className="text-xl text-left">{event.title}</DrawerTitle>
                            )}
                            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="h-4 w-4" />
                                    <span>{formatDate(event.start_time)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Clock className="h-4 w-4" />
                                    <span>{formatTime(event.start_time)} – {formatTime(event.end_time)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {canEditEvent && (
                        <div className="flex gap-1 shrink-0">
                            {isEditing ? (
                                <>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={handleSaveEvent} disabled={saving} aria-label="Save event">
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setIsEditing(false)} aria-label="Cancel editing">
                                        <X className="h-4 w-4" />
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setIsEditing(true)} aria-label="Edit event">
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => setShowDeleteConfirm(true)} aria-label="Delete event">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <ScrollArea className="flex-1 min-h-0 p-6">
                <div className="space-y-6 pb-20">
                    {isEditing ? (
                        <Textarea
                            value={editForm.description}
                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                            placeholder="Description"
                            className="min-h-[100px]"
                        />
                    ) : (
                        event.description && (
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                {event.description}
                            </p>
                        )
                    )}

                    {/* Uniform */}
                    <div className="flex items-start gap-3 p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900/50">
                        <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                            <Shirt className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-1">Uniform</h4>
                            {isEditing ? (
                                <Input
                                    value={editForm.uniform}
                                    onChange={e => setEditForm({ ...editForm, uniform: e.target.value })}
                                    className="h-8 text-sm"
                                    placeholder="Uniform Requirements"
                                />
                            ) : (
                                <p className="text-sm text-blue-900 dark:text-blue-100">{event.uniform || "Ambassador Polo with Navy Pants."}</p>
                            )}
                        </div>
                    </div>

                    {/* RSVP Section */}
                    <EventRsvpSection
                        isEditing={isEditing}
                        editRsvpOptions={editRsvpOptions}
                        setEditRsvpOptions={setEditRsvpOptions}
                        rsvpOptions={rsvpOptions}
                        rsvps={rsvps}
                        myRsvp={myRsvp}
                        currentUserId={currentUserId}
                        loadingRsvp={loadingRsvp}
                        going={going}
                        maybe={maybe}
                        rsvpButtons={rsvpButtons}
                        canViewExplanations={isAdmin || isSuperAdmin}
                        onRsvp={handleRsvp}
                    />

                    <Separator />

                    {/* Attachments Section */}
                    {(attachments.length > 0 || canEditEvent) && (
                        <EventAttachmentsSection
                            attachments={attachments}
                            canEditEvent={canEditEvent}
                            uploadingAttachment={uploadingAttachment}
                            attachmentInputRef={attachmentInputRef}
                            onUpload={handleAttachmentUpload}
                            onDelete={deleteAttachment}
                            isImageAttachment={isImageAttachment}
                        />
                    )}

                    <Separator />

                    {/* Comments Section */}
                    <EventCommentSection
                        comments={comments}
                        editingCommentId={editingCommentId}
                        editCommentContent={editCommentContent}
                        setEditCommentContent={setEditCommentContent}
                        canEditComment={canEditComment}
                        onStartEdit={startEditComment}
                        onDelete={deleteComment}
                        onSaveEdit={saveCommentEdit}
                        onCancelEdit={() => setEditingCommentId(null)}
                        getInitials={getInitials}
                    />
                </div>
            </ScrollArea>

            {/* Footer Input */}
            <div className="p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 mt-auto">
                <EventCommentInput
                    newComment={newComment}
                    setNewComment={setNewComment}
                    loadingComment={loadingComment}
                    onPost={postComment}
                />
            </div>
        </div>
    );

    if (isDesktop) {
        return (
            <>
                <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
                    <DialogContent className="sm:max-w-2xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden [&>button]:hidden">
                        {Content}
                    </DialogContent>
                </Dialog>
                <ConfirmDialog
                    open={showDeleteConfirm}
                    onOpenChange={setShowDeleteConfirm}
                    title="Delete event"
                    description="This will permanently delete this event, including all RSVPs and comments. This action cannot be undone."
                    confirmLabel="Delete"
                    variant="destructive"
                    loading={deleting}
                    onConfirm={handleDeleteEvent}
                />
            </>
        );
    }

    return (
        <>
            <Drawer open={true} onOpenChange={(open) => !open && onClose()}>
                <DrawerContent className="h-[95vh] rounded-t-[20px]">
                    {Content}
                </DrawerContent>
            </Drawer>
            <ConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Delete event"
                description="This will permanently delete this event, including all RSVPs and comments. This action cannot be undone."
                confirmLabel="Delete"
                variant="destructive"
                loading={deleting}
                onConfirm={handleDeleteEvent}
            />
        </>
    );
}
