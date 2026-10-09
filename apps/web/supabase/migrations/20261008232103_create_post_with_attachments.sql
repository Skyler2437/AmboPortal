-- Called only by the authenticated server route, after verifying signed uploads.
-- Keep publication and attachment rows in one transaction so notifications cannot
-- escape a failed save. A stable draft ID makes a lost-response retry safe.
create function public.create_post_with_attachments(
  target_post_id uuid,
  target_user_id uuid,
  target_content text,
  target_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_id uuid;
  existing_post public.posts%rowtype;
  existing_attachments jsonb;
  sorted_attachments jsonb;
begin
  if not exists (
    select 1 from public.users where id = target_user_id
      and role in ('student', 'admin', 'superadmin')
  ) then
    raise exception 'Not authorized to post' using errcode = '42501';
  end if;
  if target_post_id is null or target_content is null
    or char_length(btrim(target_content)) > 5000
    or (btrim(target_content) = '' and coalesce(jsonb_array_length(target_attachments), 0) = 0) then
    raise exception 'Invalid post content' using errcode = '22023';
  end if;
  if target_attachments is null or jsonb_typeof(target_attachments) <> 'array'
    or jsonb_array_length(target_attachments) > 5 then
    raise exception 'Invalid post attachments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(target_attachments) a
    where jsonb_typeof(a) <> 'object'
      or nullif(a->>'id', '') is null or nullif(a->>'file_url', '') is null
      or nullif(a->>'file_name', '') is null or nullif(a->>'file_type', '') is null
      or a->>'file_size' is null
      or (a->>'file_size')::bigint not between 1 and 10485760
  ) then
    raise exception 'Invalid post attachment' using errcode = '22023';
  end if;

  insert into public.posts(id, user_id, content)
    values(target_post_id, target_user_id, target_content)
    on conflict (id) do nothing returning id into inserted_id;

  if inserted_id is null then
    select * into existing_post from public.posts where id = target_post_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'file_url', file_url, 'file_name', file_name,
      'file_type', file_type, 'file_size', file_size
    ) order by id), '[]'::jsonb) into existing_attachments
      from public.post_attachments where post_id = target_post_id;
    select coalesce(jsonb_agg(a order by a->>'id'), '[]'::jsonb)
      into sorted_attachments from jsonb_array_elements(target_attachments) a;
    if existing_post.user_id is distinct from target_user_id
      or existing_post.content is distinct from target_content
      or existing_attachments is distinct from sorted_attachments then
      raise exception 'This draft was already published. Check the post feed before starting another post.'
        using errcode = 'PT409';
    end if;
    return target_post_id;
  end if;

  insert into public.post_attachments(id, post_id, uploaded_by, file_url, file_name, file_type, file_size)
    select (a->>'id')::uuid, target_post_id, target_user_id,
      a->>'file_url', a->>'file_name', a->>'file_type', (a->>'file_size')::bigint
    from jsonb_array_elements(target_attachments) a;
  return target_post_id;
end;
$$;
revoke execute on function public.create_post_with_attachments(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_post_with_attachments(uuid, uuid, text, jsonb) to service_role;
