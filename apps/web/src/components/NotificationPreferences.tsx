"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Bell } from "lucide-react";
import { toast } from "sonner";

type Preferences = {
    chat_messages: boolean;
    new_posts: boolean;
    post_comments: boolean;
    events: boolean;
    event_comments: boolean;
};

const PREF_ITEMS: { key: keyof Preferences; label: string; description: string }[] = [
    { key: "chat_messages", label: "Chat Messages", description: "Messages in chats you're in" },
    { key: "new_posts", label: "New Posts", description: "New team posts" },
    { key: "post_comments", label: "Post Comments", description: "Comments on posts you've made" },
    { key: "events", label: "Events", description: "New events" },
    { key: "event_comments", label: "Event Comments", description: "Comments on events" },
];

export function NotificationPreferences() {
    const [prefs, setPrefs] = useState<Preferences | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/notification-preferences")
            .then((r) => r.json())
            .then((data) => {
                if (data.preferences) setPrefs(data.preferences);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleToggle = async (key: keyof Preferences) => {
        if (!prefs) return;
        const newValue = !prefs[key];
        // Optimistic update
        setPrefs({ ...prefs, [key]: newValue });

        try {
            const res = await fetch("/api/notification-preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [key]: newValue }),
            });
            if (!res.ok) {
                // Revert on failure
                setPrefs({ ...prefs, [key]: !newValue });
                toast.error("Failed to update preference");
            }
        } catch {
            setPrefs({ ...prefs, [key]: !newValue });
            toast.error("Failed to update preference");
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Notification Preferences
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <div className="flex justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : prefs ? (
                    PREF_ITEMS.map((item) => (
                        <div key={item.key} className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor={item.key} className="text-sm font-medium cursor-pointer">
                                    {item.label}
                                </Label>
                                <p className="text-xs text-muted-foreground">{item.description}</p>
                            </div>
                            <Switch
                                id={item.key}
                                checked={prefs[item.key]}
                                onCheckedChange={() => handleToggle(item.key)}
                            />
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground">Unable to load preferences.</p>
                )}
            </CardContent>
        </Card>
    );
}
