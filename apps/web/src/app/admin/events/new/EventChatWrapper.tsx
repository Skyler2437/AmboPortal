"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";

export function EventChatWrapper({ userId }: { userId: string }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [form, setForm] = useState({
        title: "",
        notes: "",
        start_time: "",
        end_time: "",
        max_rsvps: "",
        uniform: "Ambassador Polo with Navy Pants.",
    });

    const update = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        if (!form.title.trim()) {
            setError("Event title is required.");
            setLoading(false);
            return;
        }
        if (!form.start_time || !form.end_time) {
            setError("Start and end times are required.");
            setLoading(false);
            return;
        }

        const start = new Date(form.start_time);
        const end = new Date(form.end_time);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            setError("Invalid date/time.");
            setLoading(false);
            return;
        }

        if (end <= start) {
            setError("End time must be after start time.");
            setLoading(false);
            return;
        }

        try {
            const res = await fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: form.title.trim(),
                    description: form.notes.trim() || null,
                    start_time: start.toISOString(),
                    end_time: end.toISOString(),
                    uniform: form.uniform.trim(),
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || "Failed to create event.");
                setLoading(false);
                return;
            }

            router.push("/admin/events");
        } catch {
            setError("Network error. Please try again.");
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Event Details</CardTitle>
                <CardDescription>Enter the essential details for the new event.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="title">Event Title <span className="text-red-500">*</span></Label>
                        <Input
                            id="title"
                            value={form.title}
                            onChange={(e) => update("title", e.target.value)}
                            placeholder="e.g. Campus Tour, Open House"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes">Event Notes</Label>
                        <Textarea
                            id="notes"
                            value={form.notes}
                            onChange={(e) => update("notes", e.target.value)}
                            placeholder="Details about the event..."
                            className="min-h-[100px]"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="start_time">Start Time <span className="text-red-500">*</span></Label>
                            <DateTimePicker
                                id="start_time"
                                value={form.start_time}
                                onChange={(newStart) => {
                                    if (newStart) {
                                        const startDate = new Date(newStart);
                                        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
                                        // Adjust to local ISO string for input
                                        const off = endDate.getTimezoneOffset() * 60000;
                                        const localISOTime = (new Date(endDate.getTime() - off)).toISOString().slice(0, 16);
                                        setForm(prev => ({ ...prev, start_time: newStart, end_time: localISOTime }));
                                    } else {
                                        update("start_time", newStart);
                                    }
                                }}
                                required
                                disabled={loading}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="end_time">End Time <span className="text-red-500">*</span></Label>
                            <DateTimePicker
                                id="end_time"
                                value={form.end_time}
                                onChange={(value) => update("end_time", value)}
                                required
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="max_rsvps">People Needed (RSVP Slots)</Label>
                        <Input
                            id="max_rsvps"
                            type="number"
                            min="1"
                            step="1"
                            value={form.max_rsvps}
                            onChange={(e) => update("max_rsvps", e.target.value)}
                            placeholder="e.g. 5"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="uniform">Uniform Requirements</Label>
                        <Input
                            id="uniform"
                            value={form.uniform}
                            onChange={(e) => update("uniform", e.target.value)}
                            placeholder="e.g. Ambassador Polo with Navy Pants"
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {loading ? "Creating..." : "Create Event"}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

export default EventChatWrapper;
