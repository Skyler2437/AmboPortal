"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SERVICE_TYPES } from "@ambo/database/types";

type Submission = {
  id: string;
  user_id: string;
  service_date: string;
  service_type: string;
  credits: number;
  hours: number;
  feedback: string | null;
  status: string;
  created_at?: string;
  users: { first_name: string; last_name: string; email: string } | null;
};

export default function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Partial<Submission>>({});

  useEffect(() => {
    fetch(`/api/admin/submissions/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setSubmission(data);
        setForm({
          service_date: data.service_date,
          service_type: data.service_type,
          credits: data.credits,
          hours: data.hours,
          feedback: data.feedback ?? "",
          status: data.status,
        });
      })
      .catch(() => toast.error("Failed to load submission"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, feedback: form.feedback || null }),
    });
    if (res.ok) {
      toast.success("Submission updated", {
        description: `Status set to ${form.status}`,
      });
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error("Failed to save", {
        description: data.error || "Please try again.",
      });
    }
    setSaving(false);
  };

  const statusColor =
    submission?.status === "Approved"
      ? "bg-green-100 text-green-800 border-green-200"
      : submission?.status === "Denied"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-yellow-100 text-yellow-800 border-yellow-200";

  if (loading) {
    return (
      <div className="space-y-4 max-w-xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="max-w-xl mx-auto text-center py-12">
        <p className="text-muted-foreground mb-4">Submission not found.</p>
        <Button asChild variant="outline">
          <Link href="/admin">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Breadcrumbs />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold leading-tight">Submission Detail</h1>
          {submission.users && (
            <p className="text-sm text-muted-foreground">
              {submission.users.first_name} {submission.users.last_name} &middot; {submission.users.email}
            </p>
          )}
        </div>
        <Badge className={`ml-auto ${statusColor}`}>{submission.status}</Badge>
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSave} className="space-y-4 bg-white border rounded-xl p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="submission-date">Date</Label>
            <DateTimePicker
              id="submission-date"
              mode="date"
              value={form.service_date || ""}
              onChange={(value) => setForm((f) => ({ ...f, service_date: value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={form.service_type}
              onValueChange={(val) => setForm((f) => ({ ...f, service_type: val }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Hours</Label>
            <Input
              type="number"
              step="0.1"
              value={form.hours ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, hours: parseFloat(e.target.value) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Credits</Label>
            <Input
              type="number"
              step="0.1"
              value={form.credits ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, credits: parseFloat(e.target.value) }))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={form.status}
            onValueChange={(val) => setForm((f) => ({ ...f, status: val }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Feedback</Label>
          <Textarea
            value={form.feedback || ""}
            onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))}
            placeholder="Optional feedback for the student"
            rows={3}
          />
        </div>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </form>
    </div>
  );
}
