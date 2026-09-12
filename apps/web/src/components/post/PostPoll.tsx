"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Poll = {
  post_id: string; closes_at: string | null; closed: boolean; total_votes: number; my_option_id: string | null;
  options: { id: string; label: string; votes: number }[];
};
export function PostPoll({ postId }: { postId: string }) {
  const generation = useRef(0);
  const voting = useRef(false);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (voting.current) return;
    const current = ++generation.current;
    try {
      const response = await fetch(`/api/community/posts/${postId}/poll`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load poll.");
      if (current === generation.current) { setPoll(data.poll); setError(""); }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Unable to load poll."); }
  }, [postId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);
  async function vote(optionId: string) {
    if (voting.current) return;
    voting.current = true;
    ++generation.current;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/community/posts/${postId}/poll`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ option_id: optionId }),
      });
      const data = await response.json();
      if (!response.ok || !data.poll) throw new Error(data.error || "Your vote could not be confirmed.");
      setPoll(data.poll);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save vote."); }
    finally { voting.current = false; setBusy(false); }
  }
  const closed = poll?.closed || (!!poll?.closes_at && Date.parse(poll.closes_at) <= Date.now());
  return <div className="mt-3 space-y-2" aria-label="Poll">
    {!poll && !error && <p className="text-sm text-muted-foreground">Loading poll…</p>}
    {poll?.options.map(option => <Button key={option.id} variant={poll.my_option_id === option.id ? "secondary" : "outline"}
      className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal text-left" disabled={busy || closed}
      aria-pressed={poll.my_option_id === option.id} onClick={() => vote(option.id)}>
      <span>{poll.my_option_id === option.id ? "✓ " : ""}{option.label}</span>
      <span className="shrink-0">{option.votes} · {poll.total_votes ? Math.round(option.votes / poll.total_votes * 100) : 0}%</span>
    </Button>)}
    {poll && <p className="text-xs text-muted-foreground" aria-live="polite">
      {poll.total_votes} {poll.total_votes === 1 ? "vote" : "votes"} · {closed ? "Voting closed" : "You can change your answer"}
      {poll.closes_at && ` · ${closed ? "Closed" : "Closes"} ${new Date(poll.closes_at).toLocaleString()}`}
    </p>}
    {error && <div role="alert" className="text-sm text-destructive">{error} <button disabled={busy} className="underline" onClick={load}>Refresh poll</button></div>}
  </div>;
}
