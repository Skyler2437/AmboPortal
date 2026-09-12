import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { handleAuthError } from '@/lib/authError';
import type { UserRole } from '@ambo/database';
import { File } from 'expo-file-system';
import { sanitizeFileName, type PickedAsset } from '@/lib/attachments';
import { DEMO_MODE, demoPosts } from '@/lib/demo';

const PAGE_SIZE = 20;

export interface Attachment {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
}

export interface Post {
  is_poll?: boolean;
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string;
  users: {
    first_name: string;
    last_name: string;
    avatar_url?: string;
    role: UserRole;
  };
  comments: { count: number }[];
  like_count: number;
  view_count: number;
  liked: boolean;
  attachments: Attachment[];
}

async function decoratePosts(rows: any[]): Promise<Post[]> {
  const posts = (rows || [])
    .filter((p) => p.users != null)
    .map((p: any) => ({
      ...p,
      attachments: p.post_attachments ?? [],
      like_count: p.post_likes?.[0]?.count ?? 0,
      view_count: p.post_views?.[0]?.count ?? 0,
      liked: false,
    })) as Post[];

  const ids = posts.map((p) => p.id);
  if (ids.length === 0) return posts;

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return posts;

  const { data: likedRows } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('user_id', uid)
    .in('post_id', ids);
  const likedSet = new Set((likedRows || []).map((r: any) => r.post_id));
  return posts.map((p) => ({ ...p, liked: likedSet.has(p.id) }));
}

function usePostsReal() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from('posts')
      .select('*, users(first_name, last_name, avatar_url, role), comments(count), post_likes(count), post_views(count), post_attachments(id, file_url, file_name, file_type, file_size)')
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (err) {
      // Auth-shaped error: sign out so the user lands on login instead of the
      // inline "Try Again" state that can't recover from a stale JWT.
      if (!handleAuthError(err)) {
        setError(err.message);
      }
    } else {
      const decorated = await decoratePosts(data || []);
      setPosts(decorated);
      setHasMore((data || []).length === PAGE_SIZE);
    }
    setLoading(false);
  }, []);

  const fetchMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;

    const { data, error: err } = await supabase
      .from('posts')
      .select('*, users(first_name, last_name, avatar_url, role), comments(count), post_likes(count), post_views(count), post_attachments(id, file_url, file_name, file_type, file_size)')
      .order('created_at', { ascending: false })
      .range(posts.length, posts.length + PAGE_SIZE - 1);

    if (!err && data) {
      const decorated = await decoratePosts(data);
      setPosts((prev) => [...prev, ...decorated]);
      setHasMore(data.length === PAGE_SIZE);
    }
    loadingMoreRef.current = false;
  }, [posts.length, hasMore]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const createPost = async (userId: string, content: string, attachments: PickedAsset[] = []) => {
    const { data: inserted, error: err } = await supabase
      .from('posts')
      .insert({ user_id: userId, content })
      .select('id')
      .single();
    if (err) throw err;
    const postId = inserted.id as string;

    for (const [i, asset] of attachments.entries()) {
      const bytes = await new File(asset.uri).bytes();
      const path = `${postId}/${Date.now()}_${i}_${sanitizeFileName(asset.name)}`;
      const { error: upErr } = await supabase.storage
        .from('post-attachments')
        .upload(path, bytes, { contentType: asset.mimeType || 'application/octet-stream' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('post-attachments').getPublicUrl(path);
      const { error: rowErr } = await supabase.from('post_attachments').insert({
        post_id: postId,
        file_url: urlData.publicUrl,
        file_name: asset.name,
        file_type: asset.mimeType || 'application/octet-stream',
        file_size: asset.size,
        uploaded_by: userId,
      });
      if (rowErr) throw rowErr;
    }

    await fetchPosts();
  };

  const editPost = async (postId: string, content: string) => {
    const { error: err } = await supabase
      .from('posts')
      .update({ content })
      .eq('id', postId);
    if (err) throw err;
    await fetchPosts();
  };

  const deletePost = async (postId: string) => {
    const { error: err } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);
    if (err) throw err;
    await fetchPosts();
  };

  const toggleLike = async (postId: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) return;

    let nowLiked = false;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        nowLiked = !p.liked;
        return { ...p, liked: nowLiked, like_count: p.like_count + (nowLiked ? 1 : -1) };
      })
    );

    try {
      if (nowLiked) {
        const { error: err } = await supabase
          .from('post_likes')
          .insert({ post_id: postId, user_id: uid });
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', uid);
        if (err) throw err;
      }
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked: !nowLiked, like_count: p.like_count + (nowLiked ? -1 : 1) }
            : p
        )
      );
      throw err;
    }
  };

  return { posts, loading, error, hasMore, refetch: fetchPosts, fetchMore, createPost, editPost, deletePost, toggleLike };
}

function usePostsDemo() {
  return {
    posts: demoPosts as Post[],
    loading: false,
    error: null as string | null,
    hasMore: false,
    refetch: async () => {},
    fetchMore: async () => {},
    createPost: async (_userId: string, _content: string, _attachments: PickedAsset[] = []) => {},
    editPost: async (_postId: string, _content: string) => {},
    deletePost: async (_postId: string) => {},
    toggleLike: async (_postId: string) => {},
  };
}

export const usePosts = DEMO_MODE ? usePostsDemo : usePostsReal;
