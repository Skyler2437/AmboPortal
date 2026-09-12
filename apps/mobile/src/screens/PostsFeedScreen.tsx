import { Button } from 'react-native-paper';
import React, { useRef } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { usePosts } from '@/hooks/usePosts';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/PostCard';
import { PostListSkeleton } from '@/components/SkeletonLoader';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Screen, Fab } from '@/components/ui';
import { useListScreen } from '@/hooks/useListScreen';
import { space } from '@/lib/theme';
import type { AppRole } from '@/lib/roles';

/**
 * Posts feed shared by the admin and student routes. Role only determines the
 * navigation prefix.
 */
export function PostsFeedScreen({ role }: { role: AppRole }) {
  const router = useRouter();
  const { posts, loading, error, hasMore, refetch, fetchMore, toggleLike } = usePosts();
  const { isInitialLoading, listError, refreshControl } = useListScreen({ data: posts, loading, error, refetch });

  const viewedRef = useRef<Set<string>>(new Set());
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 1000 }).current;
  const onViewableItemsChanged = useRef(async ({ viewableItems }: { viewableItems: { key?: string; item?: any }[] }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) return;
    for (const v of viewableItems) {
      const postId = v.item?.id;
      if (!postId || viewedRef.current.has(postId)) continue;
      viewedRef.current.add(postId);
      supabase
        .from('post_views')
        .upsert({ post_id: postId, user_id: uid }, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
        .then(() => {});
    }
  }).current;

  if (isInitialLoading) return <PostListSkeleton />;
  if (listError) return <ErrorState message={listError} onRetry={refetch} />;

  return (
    <Screen background="surface">
      <FlatList
        ListHeaderComponent={role === 'admin' ? <Button icon="clock-outline" onPress={() => router.push('/(admin)/posts/scheduled' as Parameters<typeof router.push>[0])}>Scheduled posts</Button> : null}
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            id={item.id}
            isPoll={item.is_poll}
            content={item.content}
            createdAt={item.created_at}
            author={item.users}
            commentCount={item.comments?.[0]?.count || 0}
            likeCount={item.like_count}
            viewCount={item.view_count}
            attachments={item.attachments}
            liked={item.liked}
            onToggleLike={() => { toggleLike(item.id).catch(() => {}); }}
            onPress={() => router.push(`/(${role})/posts/${item.id}` as Parameters<typeof router.push>[0])}
          />
        )}
        contentContainerStyle={posts.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="message-text-outline"
            title="No posts yet"
            subtitle="Be the first to post something!"
          />
        }
        refreshControl={refreshControl}
        onEndReached={hasMore ? fetchMore : undefined}
        onEndReachedThreshold={0.5}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
      />
      <Fab
        icon="plus"
        label="Create new post"
        onPress={() => router.push(`/(${role})/posts/new` as Parameters<typeof router.push>[0])}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg },
  emptyContainer: { flex: 1, padding: space.lg },
});
