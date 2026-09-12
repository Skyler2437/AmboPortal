"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { communityPostSchema } from "@/lib/community/validation";
import { PostSettings, PostSettingsValue, localDateTime, postSettingsPayload } from "./PostSettings";

type Draft = { id: string; content: string; publish_at: string; poll: { options: string[]; closes_at: string | null } | null };
export function ScheduledPosts() {
  const [posts, setPosts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [content, setContent] = useState("");
  const [settings, setSettings] = useState<PostSettingsValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/community/posts/scheduled", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.posts)) throw new Error(data.error || "Unable to load scheduled posts.");
      setPosts(data.posts); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load scheduled posts."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function edit(post: Draft) {
    setEditing(post); setContent(post.content); setError("");
    setSettings({ scheduled: true, publishAt: localDateTime(post.publish_at), isPoll: !!post.poll,
      options: post.poll?.options || ["", ""], closesAt: localDateTime(post.poll?.closes_at || null) });
  }
  async function save() {
    if (!editing || !settings || busy) return;
    setBusy(true); setError("");
    try {
      const parsed = communityPostSchema.safeParse(postSettingsPayload(content, settings));
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const response = await fetch(`/api/community/posts/scheduled/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const data = await response.json();
      if (!response.ok || !data.post?.id) throw new Error(data.error || "Unable to save scheduled post.");
      setEditing(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save scheduled post."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!cancelId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/community/posts/scheduled/${cancelId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Unable to cancel scheduled post.");
      setCancelId(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to cancel scheduled post."); setCancelId(null); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-2xl space-y-4">
    <Link href="/admin/posts" className="text-sm underline">Back to posts</Link>
    <h1 className="text-2xl font-bold">Scheduled posts</h1>
    <p className="text-sm text-muted-foreground">Only pending posts appear here. Times use your device’s timezone.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {editing && settings ? <section className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Edit scheduled post</h2>
      <Textarea aria-label="Post text or poll question" value={content} onChange={e => setContent(e.target.value)} disabled={busy} />
      <PostSettings value={settings} onChange={setSettings} disabled={busy} requireSchedule />
      <div className="flex gap-2"><Button onClick={save} disabled={busy}>Save changes</Button>
        <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>Back</Button></div>
    </section> : <>
      <Button variant="outline" onClick={load}>Refresh</Button>
      {loading ? <p>Loading scheduled posts…</p> : posts.length === 0 ? <p>No scheduled posts.</p> : posts.map(post => <article key={post.id} className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-medium">{post.poll ? "Poll" : "Post"} · {new Date(post.publish_at).toLocaleString()}</p>
        <p className="whitespace-pre-wrap break-words">{post.content}</p>
        {post.poll && <ul className="list-inside list-disc text-sm">{post.poll.options.map((s, i) => <li key={i}>{s}</li>)}</ul>}
        <div className="flex gap-2"><Button variant="outline" onClick={() => edit(post)}>Edit</Button>
          <Button variant="ghost" onClick={() => setCancelId(post.id)}>Cancel scheduled post</Button></div>
      </article>)}
    </>}
    <ConfirmDialog open={!!cancelId} onOpenChange={open => { if (!open) setCancelId(null); }}
      title="Cancel scheduled post?" description="This post will be removed from the schedule and will not be published."
      confirmLabel="Cancel scheduled post" variant="destructive" loading={busy} onConfirm={cancel} />
  </div>;
}
