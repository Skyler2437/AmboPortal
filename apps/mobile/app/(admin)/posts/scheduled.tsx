import { space } from '@/lib/theme';
import React, { useCallback, useState } from 'react';
import { ScrollView, View, Alert, RefreshControl } from 'react-native';
import { ActivityIndicator, Button, Card, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { communityRequest, validatePostDraft, type ScheduledPost } from '@/lib/communityPosts';
import { PostDraftControls } from '@/components/PostDraftControls';

export default function ScheduledPostsScreen() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || '';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await communityRequest<{ posts: ScheduledPost[] }>(await token(), '/scheduled');
      if (!Array.isArray(result.posts)) throw new Error('Scheduled posts could not be loaded. Try again.');
      setPosts(result.posts); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load scheduled posts.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const save = async () => {
    if (!editing || busy) return;
    const validation = validatePostDraft(editing);
    if (validation || !editing.publish_at) { Alert.alert('Check your post', validation || 'Choose a future publication time.'); return; }
    setBusy(true);
    try {
      const result = await communityRequest<{ post: ScheduledPost }>(await token(), `/scheduled/${editing.id}`, 'PATCH', { content: editing.content, publish_at: editing.publish_at, poll: editing.poll });
      if (!result.post?.id) throw new Error('Save was not confirmed. Refresh to check the scheduled post.');
      setEditing(null); await load();
    } catch (e) { Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  };
  const cancel = (post: ScheduledPost) => Alert.alert('Cancel scheduled post?', 'This post will be removed from the schedule and will not publish.', [
    { text: 'Keep post', style: 'cancel' },
    { text: 'Cancel post', style: 'destructive', onPress: async () => {
      setBusy(true);
      try {
        const result = await communityRequest<{ ok: boolean }>(await token(), `/scheduled/${post.id}`, 'DELETE');
        if (!result.ok) throw new Error('Cancellation was not confirmed. Refresh to check the post.');
        await load();
      } catch (e) { Alert.alert('Could not cancel', e instanceof Error ? e.message : 'Try again.'); }
      finally { setBusy(false); }
    } },
  ]);
  if (editing) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + space.lg, gap: space.lg }}>
    <Text variant="titleLarge">Edit scheduled post</Text>
    <TextInput label={editing.poll ? 'Poll question' : 'Post text'} multiline value={editing.content} disabled={busy} onChangeText={content => setEditing({ ...editing, content })} />
    <PostDraftControls draft={editing} onChange={draft => setEditing({ ...editing, ...draft })} scheduleRequired disabled={busy} />
    <Button mode="contained" loading={busy} disabled={busy} onPress={save}>Save changes</Button>
    <Button disabled={busy} onPress={() => setEditing(null)}>Discard changes</Button>
  </ScrollView>;
  return <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + space.lg, gap: space.lg }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
    <Text>Pending posts are visible here until publication. Times use your device’s local time zone.</Text>
    {loading && <ActivityIndicator />}
    {error ? <View><Text accessibilityRole="alert">{error}</Text><Button onPress={load}>Try again</Button></View> : null}
    {!loading && !error && posts.length === 0 && <Text>No scheduled posts.</Text>}
    {posts.map(post => <Card key={post.id}><Card.Content>
      <Text variant="titleMedium">{post.content}</Text>
      <Text>Publishes {post.publish_at ? new Date(post.publish_at).toLocaleString() : 'soon'}</Text>
      {post.poll && <Text>Poll · {post.poll.options.length} options</Text>}
    </Card.Content>{post.can_manage !== false && <Card.Actions>
      <Button disabled={busy} onPress={() => setEditing(post)}>Edit</Button>
      <Button disabled={busy} onPress={() => cancel(post)}>Cancel post</Button>
    </Card.Actions>}</Card>)}
  </ScrollView>;
}
