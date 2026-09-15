"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { TeamTable } from "@/components/admin/TeamTable";
import type { TeamTableRow as UserRow } from "@/lib/teamTable";
import { toast } from "sonner";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function UserControl() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const [csvError, setCsvError] = useState("");
  const [csvSuccess, setCsvSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

  const [myRole, setMyRole] = useState<string>("student");

  const [addForm, setAddForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    role: "student",
  });
  const [addError, setAddError] = useState("");

  const [editForm, setEditForm] = useState<Partial<UserRow>>({});
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoadError("");
    try {
      const meRes = await fetch("/api/auth/session");
      if (!meRes.ok) throw new Error("Could not load session");
      const session = await meRes.json();
      setMyRole(session.user?.role || "student");
      // Fetch every page — a single capped page hides users past the 100th
      // alphabetically from the table and the search.
      const all = await fetchAllPages<UserRow>("/api/admin/users?includeTotals=true");
      setRows(all);
    } catch {
      setLoadError("Couldn’t load the team and student totals. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const onAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    const phone10 = addForm.phone.replace(/\D/g, "");
    if (phone10.length !== 10) {
      setAddError("Phone must be 10 digits.");
      return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...addForm, phone: phone10 }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAddDialogOpen(false);
      setAddForm({ first_name: "", last_name: "", phone: "", email: "", role: "student" });
      toast.success("User created", { description: `${addForm.first_name} ${addForm.last_name}` });
      fetchUsers();
    } else {
      setAddError(data.error || "Failed to add user.");
    }
  };

  const startEdit = useCallback((user: UserRow) => {
    setEditingUser(user);
    setEditForm({
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    });
    setEditDialogOpen(true);
  }, []);

  const onEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const res = await fetch(`/api/admin/users/${editingUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      setEditDialogOpen(false);
      toast.success("User updated");
      fetchUsers();
    } else {
      toast.error("Failed to update user");
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    setDeletingUser(true);
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("User deleted");
      setDeleteTarget(null);
      fetchUsers();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to delete user");
    }
    setDeletingUser(false);
  };

  const csvInputRef = useRef<HTMLInputElement>(null);

  const onCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    setCsvSuccess("");
    setUploading(true);

    const formData = new FormData();
    formData.set("file", file);
    const res = await fetch("/api/admin/users/csv", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setCsvSuccess(`Uploaded ${data.count ?? 0} row(s).`);
      fetchUsers();
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

  if (loadError) return <Alert variant="destructive">
    <AlertCircle className="h-4 w-4" />
    <AlertDescription className="space-y-3">
      <p>{loadError}</p>
      <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchUsers(); }}>Retry</Button>
    </AlertDescription>
  </Alert>;

  return (
    <div className="space-y-4">
      {/* Add User dialog (trigger rendered in the actions row below) */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new student or admin manually.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onAddSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={addForm.first_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={addForm.last_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                type="tel"
                placeholder="10-digit Phone"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="Email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={addForm.role}
                onValueChange={(val) => setAddForm((f) => ({ ...f, role: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit">Create User</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={onCsvFileSelected}
      />

      <TeamTable
        rows={rows}
        myRole={myRole}
        onEdit={startEdit}
        onDelete={setDeleteTarget}
        onAdd={() => setAddDialogOpen(true)}
        onUpload={() => csvInputRef.current?.click()}
        uploading={uploading}
        uploadFeedback={<>
          {csvError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{csvError}</AlertDescription></Alert>}
          {csvSuccess && <Alert className="border-green-200 bg-green-50 text-green-800"><Check className="h-4 w-4 text-green-600" /><AlertDescription>{csvSuccess}</AlertDescription></Alert>}
        </>}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete user"
        description={deleteTarget ? `This will permanently delete ${deleteTarget.first_name} ${deleteTarget.last_name} and all their data.` : ""}
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingUser}
        onConfirm={deleteUser}
      />

      {/* Edit Dialog (desktop) */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={editForm.first_name || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={editForm.last_name || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={editForm.phone || ""}
                onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={editForm.email || ""}
                onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(val) => setEditForm((f) => ({ ...f, role: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
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
