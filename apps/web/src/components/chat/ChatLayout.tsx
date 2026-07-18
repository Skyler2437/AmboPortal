"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Loader2, Plus, ChevronLeft, Settings, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MessageList } from "./MessageList";
import { Group } from "./types";

// Sort starred chats to the top, then by most-recent activity. Mirrors the
// server ordering so optimistic star toggles re-sort consistently.
function sortGroups(list: Group[]): Group[] {
    return [...list].sort((a, b) => {
        if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
        const aTime = a.last_message?.created_at || a.updated_at || a.created_at;
        const bTime = b.last_message?.created_at || b.updated_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
}
import { useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";

interface ChatLayoutProps {
    currentUserId: string;
    currentUserFirstName?: string;
    currentUserLastName?: string;
    currentUserAvatarUrl?: string;
    pageTitle?: string;
    basePath: string;
}

export function ChatLayout({ currentUserId, currentUserFirstName = "", currentUserLastName = "", currentUserAvatarUrl = "", pageTitle, basePath }: ChatLayoutProps) {
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [unreadGroups, setUnreadGroups] = useState<Set<string>>(new Set());
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // ── Dynamic viewport height for mobile keyboard handling ──
    const [mobileStyle, setMobileStyle] = useState<React.CSSProperties | null>(null);
    const baseHeightRef = useRef(0);

    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        baseHeightRef.current = vv.height;

        const computedNavHeight =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-nav-height")) || 80;

        const update = () => {
            if (window.innerWidth >= 768) {
                setMobileStyle(null);
                return;
            }

            if (vv.height > baseHeightRef.current * 0.9) {
                baseHeightRef.current = Math.max(baseHeightRef.current, vv.height);
            }

            const isKeyboardOpen = vv.height < baseHeightRef.current * 0.75;
            const height = isKeyboardOpen ? vv.height : vv.height - computedNavHeight;

            setMobileStyle({
                height: `${height}px`,
                top: `${vv.offsetTop}px`,
            });
        };

        update();
        vv.addEventListener("resize", update);
        vv.addEventListener("scroll", update);
        window.addEventListener("resize", update);
        return () => {
            vv.removeEventListener("resize", update);
            vv.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    }, []);

    // Sync with URL param
    useEffect(() => {
        const groupId = searchParams.get("group");
        setSelectedGroupId(groupId || null);
    }, [searchParams]);

    const selectGroup = (id: string) => {
        setSelectedGroupId(id || null);
        // Mark group as read when selected
        if (id) {
            setUnreadGroups(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            // Persist last-read timestamp
            try {
                const key = `chat_last_read_${currentUserId}`;
                const stored = JSON.parse(localStorage.getItem(key) || "{}");
                stored[id] = new Date().toISOString();
                localStorage.setItem(key, JSON.stringify(stored));
            } catch {}
            void fetch(`/api/chat/groups/${id}/read`, { method: "POST" }).catch(() => {
                // The local unread indicator remains optimistic. Selecting the
                // conversation again retries persistence if this request fails.
            });
        }
        const params = new URLSearchParams(window.location.search);
        if (id) {
            params.set("group", id);
        } else {
            params.delete("group");
        }
        const qs = params.toString();
        window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    };

    const fetchGroups = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/chat/groups");
            if (res.ok) {
                const data = await res.json();
                const fetchedGroups = data.groups as Group[];
                setGroups(fetchedGroups);

                // Compute unread groups based on last_message vs stored last-read
                try {
                    const key = `chat_last_read_${currentUserId}`;
                    const stored = JSON.parse(localStorage.getItem(key) || "{}");
                    const unread = new Set<string>();
                    for (const g of fetchedGroups) {
                        const lastMsg = g.last_message;
                        if (lastMsg && lastMsg.sender_id !== currentUserId) {
                            const lastReadTime = stored[g.id];
                            if (!lastReadTime || new Date(lastMsg.created_at) > new Date(lastReadTime)) {
                                unread.add(g.id);
                            }
                        }
                    }
                    setUnreadGroups(unread);
                } catch {}
            } else {
                console.error("Error fetching groups:", await res.text());
                toast.error("Failed to load chat groups");
            }
        } catch (error) {
            console.error("Error fetching groups:", error);
            toast.error("Failed to load chat groups");
        }
        setLoading(false);
    };

    const toggleStar = async (groupId: string, starred: boolean) => {
        // Optimistically update + re-sort, then reconcile with the server.
        setGroups(prev => sortGroups(prev.map(g => (g.id === groupId ? { ...g, starred } : g))));
        try {
            const res = await fetch(`/api/chat/groups/${groupId}/star`, {
                method: starred ? "POST" : "DELETE",
            });
            if (!res.ok) throw new Error("Failed to update star");
        } catch {
            // Revert on failure.
            setGroups(prev => sortGroups(prev.map(g => (g.id === groupId ? { ...g, starred: !starred } : g))));
            toast.error("Couldn't update star");
        }
    };

    useEffect(() => {
        fetchGroups();
    }, [currentUserId]);

    const selectedGroup = groups.find(g => g.id === selectedGroupId);

    return (
        <div
            className="fixed inset-x-0 top-0 z-30 md:relative md:inset-auto md:z-auto flex md:border md:rounded-lg overflow-hidden bg-background"
            style={
                // The 4rem here matches an h-16 nav bar: the mobile bottom nav
                // (fallback before visualViewport kicks in) and, on desktop, the
                // TopNav above this container. If either nav height changes,
                // this calc must change with it.
                mobileStyle ?? { height: "calc(100dvh - 4rem - env(safe-area-inset-bottom, 0px))" }
            }
        >
            {/* Sidebar - Visible on Desktop, or on Mobile when no chat selected */}
            <div className={cn(
                "w-full md:w-80 flex-col",
                selectedGroupId ? "hidden md:flex" : "flex"
            )}>
                <div className="flex flex-col h-full border-r bg-background">
                    <div className="p-4 border-b flex items-center justify-between">
                        <div>
                            {pageTitle && (
                                <p className="text-xs text-muted-foreground leading-none mb-1">{pageTitle}</p>
                            )}
                            <h2 className="font-semibold text-lg leading-none">Chats</h2>
                        </div>
                    </div>
                    <ScrollArea className="flex-1">
                        {loading ? (
                            <div className="flex justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="p-4 text-center text-muted-foreground text-sm">
                                No chats yet. Start one!
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1 p-2">
                                {groups.map((group) => {
                                    const others = (group.participants || []).filter(
                                        p => p.user && p.user.id !== currentUserId
                                    );

                                    let displayName = group.name;
                                    if (!displayName) {
                                        const names = others.map(p => p.user.first_name);
                                        displayName = names.length > 0
                                            ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "")
                                            : "Empty Group";
                                    }

                                    // Like mobile: use the first other participant's avatar/initials.
                                    const primary = others[0]?.user;
                                    const avatarUrl = primary?.avatar_url;
                                    const initials = `${(primary?.first_name || displayName || "?")[0] || "?"}${(primary?.last_name || "")[0] || ""}`.toUpperCase();

                                    const isUnread = unreadGroups.has(group.id);
                                    const isSelected = selectedGroupId === group.id;

                                    return (
                                        <div
                                            key={group.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => selectGroup(group.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    selectGroup(group.id);
                                                }
                                            }}
                                            className={cn(
                                                "group flex items-center gap-2 rounded-md py-2.5 px-3 w-full cursor-pointer text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                isSelected ? "bg-muted" : "hover:bg-muted/60"
                                            )}
                                        >
                                            <Avatar className="h-9 w-9 shrink-0">
                                                {avatarUrl && <AvatarImage src={avatarUrl} alt="" className="object-cover" />}
                                                <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                                                    {initials}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <div className={cn("truncate", isUnread ? "font-bold" : "font-medium")}>
                                                    {displayName}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {new Date(group.updated_at || group.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            {isUnread && (
                                                <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleStar(group.id, !group.starred);
                                                }}
                                                aria-label={group.starred ? "Unstar chat" : "Star chat"}
                                                aria-pressed={!!group.starred}
                                                className={cn(
                                                    "shrink-0 rounded-md p-1 transition-opacity",
                                                    group.starred
                                                        ? "text-amber-500 opacity-100"
                                                        : "text-muted-foreground opacity-0 hover:text-amber-500 group-hover:opacity-100 focus-visible:opacity-100"
                                                )}
                                            >
                                                <Star className={cn("h-4 w-4", group.starred && "fill-current")} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </ScrollArea>

                    {/* Floating + button inside sidebar on mobile, bottom-right */}
                    <div className="absolute bottom-6 right-6 md:bottom-4 md:right-4 z-50">
                        <Link
                            href={`${basePath}/new`}
                            className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="h-6 w-6" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* Main Content - Visible on Desktop, or on Mobile when chat selected */}
            <div className={cn(
                "flex-1 flex-col min-w-0 bg-background",
                selectedGroupId ? "flex" : "hidden md:flex"
            )}>
                {selectedGroupId && selectedGroup ? (
                    <div className="flex flex-col h-full overflow-hidden">
                        {/* Chat header - always pinned at top */}
                        <div className="shrink-0 border-b bg-background z-10">
                            <div className="flex items-center justify-between px-3 h-14">
                                <div className="flex items-center gap-1 min-w-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="md:hidden shrink-0 -ml-1 h-9 w-9"
                                        onClick={() => selectGroup("")}
                                        aria-label="Back to chat list"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </Button>
                                    <h3 className="font-semibold truncate text-base">
                                        {selectedGroup.name || "Chat"}
                                    </h3>
                                </div>
                                <Link href={`${basePath}/${selectedGroupId}/edit`}>
                                    <Button variant="ghost" size="icon" aria-label="Chat settings">
                                        <Settings className="h-4 w-4" />
                                    </Button>
                                </Link>
                            </div>
                        </div>

                        {/* Messages + Input area - fills remaining space */}
                        <div className="flex-1 min-h-0">
                            <MessageList groupId={selectedGroupId} currentUserId={currentUserId} currentUserFirstName={currentUserFirstName} currentUserLastName={currentUserLastName} currentUserAvatarUrl={currentUserAvatarUrl} />
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground p-4 text-center">
                        Select a chat to start messaging
                    </div>
                )}
            </div>
        </div>
    );
}
