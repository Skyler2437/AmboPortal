import { space } from '@/lib/theme';
import React, { useState } from 'react';
import { View, Platform } from 'react-native';
import { Button, Switch, Text, TextInput } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { PostDraft } from '@/lib/communityPosts';

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  return <View style={{ gap: space.sm }}>
    <Text>{label}: {new Date(value).toLocaleString()}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      <Button onPress={() => setMode(mode === 'date' ? null : 'date')} accessibilityLabel={`Choose ${label} date`}>Choose date</Button>
      <Button onPress={() => setMode(mode === 'time' ? null : 'time')} accessibilityLabel={`Choose ${label} time`}>Choose time</Button>
    </View>
    {mode && <DateTimePicker value={new Date(value)} mode={mode} display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, date) => {
      if (Platform.OS !== 'ios') setMode(null);
      if (event.type !== 'dismissed' && date) onChange(date.toISOString());
    }} />}
  </View>;
}
export function PostDraftControls({ draft, onChange, scheduleRequired = false, disabled = false }: {
  draft: PostDraft; onChange: (draft: PostDraft) => void; scheduleRequired?: boolean; disabled?: boolean;
}) {
  const future = () => new Date(Date.now() + 3600000).toISOString();
  return <View pointerEvents={disabled ? 'none' : 'auto'} style={{ gap: space.lg, padding: space.lg, opacity: disabled ? 0.5 : 1 }}>
    {!scheduleRequired && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text>Schedule for later</Text>
      <Switch accessibilityLabel="Schedule for later" value={!!draft.publish_at} onValueChange={value => onChange({ ...draft, publish_at: value ? future() : null })} />
    </View>}
    {draft.publish_at && <DateField label="Publication" value={draft.publish_at} onChange={publish_at => onChange({ ...draft, publish_at })} />}
    <Text variant="bodySmall">Times use your device’s local time zone.</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text>Add a poll</Text>
      <Switch accessibilityLabel="Add a poll" value={!!draft.poll} onValueChange={value => onChange({ ...draft, poll: value ? { options: ['', ''], closes_at: null } : null })} />
    </View>
    {draft.poll && <>
      <Text>Use your post text as the question. Each person can choose one option and change their vote until closing.</Text>
      {draft.poll.options.map((option, index) => <View key={index} style={{ gap: space.xs }}>
        <TextInput label={`Option ${index + 1}`} value={option} maxLength={200} onChangeText={label => onChange({ ...draft, poll: { ...draft.poll!, options: draft.poll!.options.map((old, i) => i === index ? label : old) } })} />
        {draft.poll!.options.length > 2 && <Button accessibilityLabel={`Remove option ${index + 1}`} onPress={() => onChange({ ...draft, poll: { ...draft.poll!, options: draft.poll!.options.filter((_, i) => i !== index) } })}>Remove</Button>}
      </View>)}
      {draft.poll.options.length < 6 && <Button onPress={() => onChange({ ...draft, poll: { ...draft.poll!, options: [...draft.poll!.options, ''] } })}>Add option</Button>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text>Set a closing time</Text>
        <Switch accessibilityLabel="Set a closing time" value={!!draft.poll.closes_at} onValueChange={value => onChange({ ...draft, poll: { ...draft.poll!, closes_at: value ? new Date(Math.max(Date.now(), Date.parse(draft.publish_at || '') || 0) + 86400000).toISOString() : null } })} />
      </View>
      {draft.poll.closes_at && <DateField label="Poll closing" value={draft.poll.closes_at} onChange={closes_at => onChange({ ...draft, poll: { ...draft.poll!, closes_at } })} />}
    </>}
  </View>;
}
