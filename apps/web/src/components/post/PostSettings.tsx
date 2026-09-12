"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type PostSettingsValue = {
  scheduled: boolean; publishAt: string; isPoll: boolean; options: string[]; closesAt: string;
};
export const emptyPostSettings = (): PostSettingsValue => ({
  scheduled: false, publishAt: "", isPoll: false, options: ["", ""], closesAt: "",
});
export function localDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function postSettingsPayload(content: string, value: PostSettingsValue) {
  if (value.scheduled && !value.publishAt) throw new Error("Choose a publishing date and time.");
  return {
    content,
    publish_at: value.scheduled ? new Date(value.publishAt).toISOString() : null,
    poll: value.isPoll ? {
      options: value.options,
      closes_at: value.closesAt ? new Date(value.closesAt).toISOString() : null,
    } : null,
  };
}

export function PostSettings({ value, onChange, disabled = false, requireSchedule = false }: {
  value: PostSettingsValue; onChange: (value: PostSettingsValue) => void; disabled?: boolean; requireSchedule?: boolean;
}) {
  const update = (patch: Partial<PostSettingsValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Post options</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.isPoll} onChange={e => update({ isPoll: e.target.checked })} />
        Make this a poll
      </label>
      {value.isPoll && <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Use the post text as your question. Each person selects one answer. Results show totals only.</p>
        {value.options.map((option, index) => <div key={index} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`poll-option-${index}`}>Option {index + 1}</Label>
            <Input id={`poll-option-${index}`} value={option} maxLength={200}
              onChange={e => update({ options: value.options.map((s, i) => i === index ? e.target.value : s) })} />
          </div>
          {value.options.length > 2 && <Button type="button" variant="ghost" aria-label={`Remove option ${index + 1}`}
            onClick={() => update({ options: value.options.filter((_, i) => i !== index) })}>Remove</Button>}
        </div>)}
        {value.options.length < 6 && <Button type="button" variant="outline" size="sm" onClick={() => update({ options: [...value.options, ""] })}>Add option</Button>}
        <div className="space-y-1">
          <Label htmlFor="poll-close">Poll closes (optional)</Label>
          <Input id="poll-close" type="datetime-local" value={value.closesAt} onChange={e => update({ closesAt: e.target.value })} />
          <p className="text-xs text-muted-foreground">Leave blank to keep voting open.</p>
        </div>
      </div>}
      {!requireSchedule && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.scheduled} onChange={e => update({ scheduled: e.target.checked })} />
        Schedule for later
      </label>}
      {value.scheduled && <div className="space-y-1">
        <Label htmlFor="post-publish">Publish date and time</Label>
        <Input id="post-publish" type="datetime-local" value={value.publishAt} onChange={e => update({ publishAt: e.target.value })} />
        <p className="text-xs text-muted-foreground">Publishes within about a minute of this time. Notifications go out when published.</p>
      </div>}
      {(value.scheduled || value.isPoll) && <p className="text-xs text-muted-foreground">Times use your device’s timezone. Scheduled posts and polls currently support text without attachments.</p>}
    </fieldset>
  );
}
