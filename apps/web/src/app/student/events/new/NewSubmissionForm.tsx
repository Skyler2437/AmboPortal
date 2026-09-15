"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, History } from "lucide-react";

import { SERVICE_TYPES } from "@ambo/database/types";
import { submissionSchema } from "@/lib/validations";
import { emptySubmissionForm, schoolServiceDate, confirmSubmissionResponse } from "@/lib/submissionForm";

const NOTES_MAX_LENGTH = 500;

export function NewSubmissionForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState(emptySubmissionForm);

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const parsed = submissionSchema.safeParse({
      user_id: userId,
      service_type: form.service_type,
      service_date: form.service_date,
      hours: form.hours,
      credits: form.tour_credits,
      feedback: form.notes.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      await confirmSubmissionResponse(res);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch"
        ? err.message
        : "Network error. Your entries have been kept. Please try again.");
    }

    setLoading(false);
  };

  if (success) {
    return (
      <Card className="max-w-md mx-auto animate-in zoom-in-95 duration-200">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-xl">Submitted!</h3>
            <p className="text-muted-foreground text-sm">
              Your service hours have been logged successfully.
            </p>
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <Button
              onClick={() => {
                setSuccess(false);
                setForm(emptySubmissionForm());
              }}
            >
              Log Another
            </Button>
            <Button variant="outline" onClick={() => router.push("/student")}>
              View Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl mx-auto shadow-none">
      <CardHeader className="border-b p-5 sm:p-7">
        <CardTitle className="text-2xl font-medium tracking-tight"><h1>Log Service Hours</h1></CardTitle>
        <CardDescription>
          Enter the details of your completed service event.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="service-type">Service Type</Label>
            <select
              id="service-type"
              className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.service_type}
              onChange={(e) => update("service_type", e.target.value)}
              required
              disabled={loading}
            >
              <option value="" disabled>Choose a service type</option>
              {SERVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Choose Other if your event is not listed, then describe it in the notes.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-date">Service Date</Label>
            <Input
              id="service-date"
              type="date"
              value={form.service_date}
              max={schoolServiceDate()}
              aria-describedby="service-date-help"
              onChange={(e) => update("service_date", e.target.value)}
              required
              disabled={loading}
            />
            <p id="service-date-help" className="text-xs text-muted-foreground">Service dates use Pacific Time.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hours">Hours Served</Label>
              <Input
                id="hours"
                type="number"
                step="any"
                max="24"
                min="0"
                value={form.hours}
                onChange={(e) => update("hours", e.target.value)}
                placeholder="2"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credits">Tour Credits</Label>
              <Input
                id="credits"
                type="number"
                step="1"
                min="0"
                value={form.tour_credits}
                onChange={(e) => update("tour_credits", e.target.value)}
                placeholder="0"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notes">Notes / Feedback</Label>
              <span className={`text-xs ${form.notes.length > NOTES_MAX_LENGTH ? "text-red-500" : "text-muted-foreground"}`}>
                {form.notes.length}/{NOTES_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => {
                if (e.target.value.length <= NOTES_MAX_LENGTH) {
                  update("notes", e.target.value);
                }
              }}
              placeholder="How did the event go? Any issues?"
              className="resize-none min-h-[100px]"
            />
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Log"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center border-t p-4 bg-muted/50 rounded-b-xl">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => router.push("/student")}>
          <History className="mr-2 h-3 w-3" />
          View Submission History
        </Button>
      </CardFooter>
    </Card>
  );
}
