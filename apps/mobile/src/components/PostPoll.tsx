import { space, radius } from '@/lib/theme';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Button, Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { communityRequest, type Poll } from '@/lib/communityPosts';

export function PostPoll({ postId }: { postId: string }) {
  const { tokens } = useThemedStyles(() => ({}));
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const votePending = useRef(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    if (votePending.current) return;
    const request = ++generation.current;
    try {
      const { data } = await supabase.auth.getSession();
      const result = await communityRequest<{ poll: Poll | null }>(data.session?.access_token || '', `/${postId}/poll`);
      if (request === generation.current) { setPoll(result.poll); setError(''); }
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not load poll. Try again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [postId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!poll?.closes_at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [poll?.closes_at]);
  const closed = poll?.closed || (!!poll?.closes_at && Date.parse(poll.closes_at) <= now);
  const vote = async (option_id: string) => {
    if (closed || votePending.current) return;
    votePending.current = true;
    const request = ++generation.current;
    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const result = await communityRequest<{ poll: Poll }>(data.session?.access_token || '', `/${postId}/poll`, 'POST', { option_id });
      if (!result.poll) throw new Error('Vote was not confirmed. Refresh the results and try again.');
      if (request === generation.current) { setPoll(result.poll); setError(''); }
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not save vote. Try again.'); }
    finally { votePending.current = false; setSaving(false); }
  };
  return <View style={{ gap: space.sm, marginTop: space.lg }}>
    {loading && <ActivityIndicator accessibilityLabel="Loading poll" />}
    {error ? <View><Text accessibilityRole="alert">{error}</Text><Button disabled={saving} onPress={event => { event.stopPropagation(); void load(); }}>Refresh poll</Button></View> : null}
    {poll && <>
      {poll.options.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: poll.my_option_id === option.id, disabled: !!closed || saving }} style={{ borderWidth: 1, borderColor: tokens.border, backgroundColor: poll.my_option_id === option.id ? tokens.surfaceVariant : tokens.surface, borderRadius: radius.md, padding: space.md }} disabled={closed || saving} onPress={event => { event.stopPropagation(); void vote(option.id); }} accessibilityLabel={`${option.label}, ${option.votes} votes${poll.my_option_id === option.id ? ', your choice' : ''}`}>
        <Text>{poll.my_option_id === option.id ? '✓ ' : ''}{option.label}</Text>
        <Text variant="bodySmall">{option.votes} votes ({poll.total_votes ? Math.round(option.votes / poll.total_votes * 100) : 0}%)</Text>
      </Pressable>)}
      <Text>{poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'} · {closed ? 'Poll closed' : 'Choose one option. You can change your vote.'}</Text>
      {poll.closes_at && <Text variant="bodySmall">{closed ? 'Closed' : 'Closes'} {new Date(poll.closes_at).toLocaleString()}</Text>}
      <Button compact disabled={saving} onPress={event => { event.stopPropagation(); void load(); }}>Refresh results</Button>
    </>}
  </View>;
}
