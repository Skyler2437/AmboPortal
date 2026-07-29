"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventRSVP, EventRSVPOption } from "@ambo/database/types";

type RsvpButton = { status: string; label: string; activeClass: string };

export function EventRsvpSection({
    isEditing,
    editRsvpOptions,
    setEditRsvpOptions,
    rsvpOptions,
    rsvps,
    myRsvp,
    currentUserId,
    loadingRsvp,
    going,
    maybe,
    rsvpButtons,
    canViewExplanations,
    onRsvp,
}: {
    isEditing: boolean;
    editRsvpOptions: string[];
    setEditRsvpOptions: (options: string[]) => void;
    rsvpOptions: EventRSVPOption[];
    rsvps: EventRSVP[];
    myRsvp: string | undefined;
    currentUserId: string;
    loadingRsvp: boolean;
    going: EventRSVP[];
    maybe: EventRSVP[];
    rsvpButtons: RsvpButton[];
    canViewExplanations: boolean;
    onRsvp: (status: string, rsvpOptionId?: string, explanation?: string) => Promise<boolean>;
}) {
    const [explanationStatus, setExplanationStatus] = useState<"maybe" | "no" | null>(null);
    const [explanation, setExplanation] = useState("");
    const trimmedExplanation = explanation.trim();
    const explanationIsValid = trimmedExplanation.length >= 50
        && trimmedExplanation.length <= 500;
    const myRsvpRow = rsvps.find((rsvp) => rsvp.user_id === currentUserId);

    const chooseRsvp = (status: string, rsvpOptionId?: string) => {
        if (status === "maybe" || status === "no") {
            setExplanationStatus(status);
            setExplanation(myRsvpRow?.status === status ? myRsvpRow.explanation || "" : "");
            return;
        }
        void onRsvp(status, rsvpOptionId);
    };

    const saveExplainedRsvp = async () => {
        if (!explanationStatus || !explanationIsValid) return;
        const saved = await onRsvp(explanationStatus, undefined, trimmedExplanation);
        if (saved) {
            setExplanationStatus(null);
            setExplanation("");
        }
    };

    return (
        <div className="space-y-4">
            {isEditing ? (
                <>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">RSVP Options</h3>
                    <p className="text-xs text-muted-foreground">Add custom RSVP options (leave empty for default Going/Maybe/Can&apos;t go).</p>
                    <div className="space-y-2">
                        {editRsvpOptions.map((opt, idx) => (
                            <div key={idx} className="flex gap-2">
                                <Input
                                    value={opt}
                                    onChange={(e) => {
                                        const updated = [...editRsvpOptions];
                                        updated[idx] = e.target.value;
                                        setEditRsvpOptions(updated);
                                    }}
                                    placeholder={`Option ${idx + 1}`}
                                    className="h-8 text-sm"
                                />
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-500"
                                    onClick={() => setEditRsvpOptions(editRsvpOptions.filter((_, i) => i !== idx))}
                                    aria-label="Remove RSVP option"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                        {editRsvpOptions.length < 10 && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => setEditRsvpOptions([...editRsvpOptions, ""])}
                            >
                                <Plus className="h-3 w-3 mr-1" /> Add Option
                            </Button>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">RSVP</h3>
                        <div className="flex gap-2 flex-wrap justify-end">
                            {rsvpOptions.length > 0 ? (
                                <>
                                    {rsvpOptions.map((opt) => {
                                        const isSelected = myRsvp === "going" && rsvps.find(r => r.user_id === currentUserId)?.rsvp_option_id === opt.id;
                                        return (
                                            <Button
                                                key={opt.id}
                                                variant={isSelected ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => chooseRsvp("going", opt.id)}
                                                disabled={loadingRsvp}
                                                className={cn(
                                                    "h-8 transition-colors",
                                                    isSelected && "bg-green-600 hover:bg-green-700 border-green-600 text-white",
                                                    !isSelected && "text-muted-foreground"
                                                )}
                                            >
                                                {opt.label}
                                            </Button>
                                        );
                                    })}
                                    {rsvpButtons
                                        .filter((btn) => btn.status !== "going")
                                        .map((btn) => (
                                            <Button
                                                key={btn.status}
                                                variant={myRsvp === btn.status ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => chooseRsvp(btn.status)}
                                                disabled={loadingRsvp}
                                                className={cn(
                                                    "h-8 transition-colors",
                                                    myRsvp === btn.status && btn.status === "maybe" && "bg-amber-500 hover:bg-amber-600 border-amber-500 text-white",
                                                    myRsvp !== btn.status && "text-muted-foreground",
                                                )}
                                            >
                                                {btn.label}
                                            </Button>
                                        ))}
                                </>
                            ) : (
                                rsvpButtons.map((btn) => (
                                    <Button
                                        key={btn.status}
                                        variant={myRsvp === btn.status ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => chooseRsvp(btn.status)}
                                        disabled={loadingRsvp}
                                        className={cn(
                                            "h-8 transition-colors",
                                            myRsvp === btn.status && btn.status === "going" && "bg-green-600 hover:bg-green-700 border-green-600 text-white",
                                            myRsvp === btn.status && btn.status === "maybe" && "bg-amber-500 hover:bg-amber-600 border-amber-500 text-white",
                                            myRsvp !== btn.status && "text-muted-foreground"
                                        )}
                                    >
                                        {btn.label}
                                    </Button>
                                ))
                            )}
                        </div>
                    </div>

                    {explanationStatus && (
                        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                            <div>
                                <p className="text-sm font-medium">
                                    Explain why you selected {explanationStatus === "maybe" ? "Maybe" : "Can’t Go"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Please explain your response in 50–500 characters. Only admins can view it.
                                </p>
                            </div>
                            <Textarea
                                value={explanation}
                                onChange={(event) => setExplanation(event.target.value)}
                                maxLength={500}
                                rows={4}
                                placeholder="Enter your explanation…"
                                aria-label="RSVP explanation"
                            />
                            <div className="flex items-center justify-between gap-3">
                                <span
                                    className={cn(
                                        "text-xs",
                                        trimmedExplanation.length > 0 && trimmedExplanation.length < 50
                                            ? "text-red-600"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {trimmedExplanation.length}/500 characters
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setExplanationStatus(null);
                                            setExplanation("");
                                        }}
                                        disabled={loadingRsvp}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => void saveExplainedRsvp()}
                                        disabled={!explanationIsValid || loadingRsvp}
                                    >
                                        Save RSVP
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        {rsvpOptions.length > 0 ? (
                            <div className="text-sm space-y-1">
                                {rsvpOptions.map((opt) => {
                                    const optRsvps = rsvps.filter(r => r.rsvp_option_id === opt.id);
                                    if (optRsvps.length === 0) return null;
                                    return (
                                        <p key={opt.id}>
                                            <span className="font-medium text-foreground">{opt.label} ({optRsvps.length}): </span>
                                            <span className="text-muted-foreground">
                                                {optRsvps.map((r) => `${r.users?.first_name || ""} ${r.users?.last_name || ""}`).map(n => n.trim()).filter(Boolean).join(", ")}
                                            </span>
                                        </p>
                                    );
                                })}
                                {rsvps.some((r) => !r.rsvp_option_id && r.status === "going") && (
                                    <p>
                                        <span className="font-medium text-foreground">Other: </span>
                                        <span className="text-muted-foreground">
                                            {rsvps.filter(r => !r.rsvp_option_id && r.status === "going").map((r) => `${r.users?.first_name || ""} ${r.users?.last_name || ""}`).map(n => n.trim()).filter(Boolean).join(", ")}
                                        </span>
                                    </p>
                                )}
                                {maybe.length > 0 && (
                                    <p>
                                        <span className="font-medium text-foreground">Maybe ({maybe.length}): </span>
                                        <span className="text-muted-foreground">
                                            {maybe.map((r) => `${r.users?.first_name || ""} ${r.users?.last_name || ""}`).map(n => n.trim()).filter(Boolean).join(", ")}
                                        </span>
                                    </p>
                                )}
                                {rsvps.length === 0 && (
                                    <p className="text-sm text-muted-foreground italic">No RSVPs yet.</p>
                                )}
                            </div>
                        ) : (
                            (going.length > 0 || maybe.length > 0) ? (
                                <div className="text-sm space-y-1">
                                    {going.length > 0 && (
                                        <p>
                                            <span className="font-medium text-foreground">Going ({going.length}): </span>
                                            <span className="text-muted-foreground">
                                                {going.map((r) => `${r.users?.first_name || ""} ${r.users?.last_name || ""}`).map(n => n.trim()).filter(Boolean).join(", ")}
                                            </span>
                                        </p>
                                    )}
                                    {maybe.length > 0 && (
                                        <p>
                                            <span className="font-medium text-foreground">Maybe ({maybe.length}): </span>
                                            <span className="text-muted-foreground">
                                                {maybe.map((r) => `${r.users?.first_name || ""} ${r.users?.last_name || ""}`).map(n => n.trim()).filter(Boolean).join(", ")}
                                            </span>
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">No RSVPs yet.</p>
                            )
                        )}
                    </div>

                    {canViewExplanations && rsvps.some((rsvp) => (
                        (rsvp.status === "maybe" || rsvp.status === "no") && rsvp.explanation
                    )) && (
                        <div className="space-y-2 rounded-lg border p-3">
                            <h4 className="text-sm font-semibold">RSVP explanations</h4>
                            {rsvps
                                .filter((rsvp) => (
                                    (rsvp.status === "maybe" || rsvp.status === "no")
                                    && rsvp.explanation
                                ))
                                .map((rsvp) => (
                                    <div key={rsvp.user_id} className="text-sm">
                                        <p className="font-medium">
                                            {rsvp.users?.first_name} {rsvp.users?.last_name}
                                            <span className="ml-1 font-normal text-muted-foreground">
                                                · {rsvp.status === "maybe" ? "Maybe" : "Can’t Go"}
                                            </span>
                                        </p>
                                        <p className="whitespace-pre-wrap text-muted-foreground">
                                            {rsvp.explanation}
                                        </p>
                                    </div>
                                ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
