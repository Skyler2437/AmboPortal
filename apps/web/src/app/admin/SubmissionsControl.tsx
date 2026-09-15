"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { SERVICE_TYPES } from "@ambo/database/types";
import { toast } from "sonner";
import { fetchAllPages } from "@/lib/fetch-all-pages";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, AlertCircle } from "lucide-react";
import { SubmissionsTable } from "@/components/admin/SubmissionsTable";
import type { SubmissionTableRow as SubRow } from "@/lib/submissionTable";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function SubmissionsControl() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<SubRow | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const [editForm, setEditForm] = useState<Partial<SubRow>>({});
  const [csvError, setCsvError] = useState("");
  const [csvSuccess, setCsvSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    try {
      // Fetch every page — a single capped page hides older submissions and
      // makes the status counts and search silently wrong.
      const all = await fetchAllPages<SubRow>("/api/admin/submissions");
      setRows(all);
    } catch {
      toast.error("Failed to load submissions");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const startEdit = useCallback((row: SubRow) => {
    setEditingRow(row);
    setEditForm({
      service_date: row.service_date,
      service_type: row.service_type,
      credits: row.credits,
      hours: row.hours,
      feedback: row.feedback ?? "",
      status: row.status,
    });
    setEditDialogOpen(true);
  }, []);

  const onEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;
    const res = await fetch(`/api/admin/submissions/${editingRow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editForm,
        feedback: editForm.feedback || null,
      }),
    });
    if (res.ok) {
      setEditDialogOpen(false);
      toast.success("Submission updated");
      fetchSubmissions();
    } else {
      toast.error("Failed to update submission");
    }
  };

  const quickAction = useCallback(async (row: SubRow, newStatus: "Approved" | "Denied") => {
    const res = await fetch(`/api/admin/submissions/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      toast.success(`Submission ${newStatus.toLowerCase()}`, {
        description: row.users ? `${row.users.first_name} ${row.users.last_name}` : undefined,
      });
      fetchSubmissions();
    } else {
      toast.error(`Failed to ${newStatus.toLowerCase()} submission`);
    }
  }, [fetchSubmissions]);

  const csvInputRef = useRef<HTMLInputElement>(null);

  const onCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    setCsvSuccess("");
    setUploading(true);

    const formData = new FormData();
    formData.set("file", file);
    const res = await fetch("/api/admin/submissions/csv", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(`Uploaded ${data.count ?? 0} row(s)`);
      setCsvSuccess(`Uploaded ${data.count ?? 0} row(s).`);
      fetchSubmissions();
    } else {
      setCsvError(data.error || "Upload failed.");
    }
    if (csvInputRef.current) csvInputRef.current.value = "";
    setUploading(false);
  };

  if (loading)
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading">Service submissions</h1>
        <p className="page-description">Review the hours and tour credits logged by your ambassadors.</p>
      </div>
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={onCsvFileSelected}
      />

      <SubmissionsTable
        rows={rows}
        onEdit={startEdit}
        onQuickAction={quickAction}
        onUpload={() => csvInputRef.current?.click()}
        uploading={uploading}
        uploadFeedback={<>
          {csvError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{csvError}</AlertDescription></Alert>}
          {csvSuccess && <Alert className="bg-green-50 text-green-800 border-green-200"><Check className="h-4 w-4 text-green-600" /><AlertDescription>{csvSuccess}</AlertDescription></Alert>}
        </>}
      />

      {/* Edit Dialog (desktop) */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Submission</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editForm.service_date || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, service_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={editForm.service_type}
                  onValueChange={(val) => setEditForm((f) => ({ ...f, service_type: val }))}
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
              <div className="space-y-2">
                <Label>Hours</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={editForm.hours || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, hours: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Credits</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={editForm.credits || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, credits: parseFloat(e.target.value) }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(val) => setEditForm((f) => ({ ...f, status: val }))}
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
            <div className="space-y-2">
              <Label>Feedback</Label>
              <Textarea
                value={editForm.feedback || ""}
                onChange={(e) => setEditForm(f => ({ ...f, feedback: e.target.value }))}
                placeholder="Optional feedback for the student"
              />
            </div>

            <DialogFooter>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
