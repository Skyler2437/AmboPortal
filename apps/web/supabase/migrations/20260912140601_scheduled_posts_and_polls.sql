-- Private drafts and ballots are reachable only through the verified server API.
alter table public.posts add column is_poll boolean not null default false;

create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null check (length(btrim(content)) > 0),
  publish_at timestamptz not null check (isfinite(publish_at)),
  poll jsonb,
  created_at timestamptz not null default now()
);
create index scheduled_posts_due_idx on public.scheduled_posts(publish_at);
create index scheduled_posts_user_idx on public.scheduled_posts(user_id);

create table public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  closes_at timestamptz check (closes_at is null or isfinite(closes_at))
);
create table public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  sort_order integer not null check (sort_order between 0 and 5),
  unique (post_id, sort_order),
  unique (post_id, id)
);
create table public.post_poll_votes (
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  option_id uuid not null,
  primary key (post_id, user_id),
  foreign key (post_id, option_id)
    references public.post_poll_options(post_id, id) on delete cascade
);
create index post_poll_votes_user_idx on public.post_poll_votes(user_id);
create index post_poll_votes_option_idx on public.post_poll_votes(post_id, option_id);

alter table public.scheduled_posts enable row level security;
alter table public.post_polls enable row level security;
alter table public.post_poll_options enable row level security;
alter table public.post_poll_votes enable row level security;
revoke all on public.scheduled_posts, public.post_polls, public.post_poll_options,
  public.post_poll_votes from public, anon, authenticated;
grant all on public.scheduled_posts, public.post_polls, public.post_poll_options,
  public.post_poll_votes to service_role;

-- Shared validation also protects direct server updates of pending drafts.
create function public.validate_community_poll(p_poll jsonb, p_publish_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_option jsonb;
  v_seen text[] := '{}';
  v_label text;
  v_closes_at timestamptz;
begin
  if p_poll is null then return; end if;
  if jsonb_typeof(p_poll) is distinct from 'object'
    or jsonb_typeof(p_poll->'options') is distinct from 'array' then
    raise exception 'Poll options must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_poll->'options') not between 2 and 6 then
    raise exception 'Polls require 2 to 6 options' using errcode = '22023';
  end if;
  for v_option in select value from jsonb_array_elements(p_poll->'options') loop
    if jsonb_typeof(v_option) is distinct from 'string' then
      raise exception 'Poll options must be text' using errcode = '22023';
    end if;
    v_label := btrim(v_option #>> '{}');
    if length(v_label) not between 1 and 200 or lower(v_label) = any(v_seen) then
      raise exception 'Poll options must be distinct and contain 1 to 200 characters' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, lower(v_label));
  end loop;
  if p_poll->>'closes_at' is not null then
    v_closes_at := (p_poll->>'closes_at')::timestamptz;
    if not isfinite(v_closes_at) or v_closes_at <= p_publish_at then
      raise exception 'Poll closing time must follow publication' using errcode = '22023';
    end if;
  end if;
end;
$$;

create function public.validate_scheduled_post()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.validate_community_poll(new.poll, new.publish_at);
  return new;
end;
$$;
create trigger validate_scheduled_post before insert or update on public.scheduled_posts
  for each row execute function public.validate_scheduled_post();

-- Internal helper: same transaction as the posts insert / notification trigger.
create function public.insert_community_poll(p_post_id uuid, p_poll jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_poll is null then return; end if;
  insert into public.post_polls(post_id, closes_at)
  values (p_post_id, (p_poll->>'closes_at')::timestamptz);
  insert into public.post_poll_options(post_id, label, sort_order)
  select p_post_id, btrim(value), (ordinality - 1)::integer
  from jsonb_array_elements_text(p_poll->'options') with ordinality;
end;
$$;

create function public.create_community_post(
  p_user_id uuid, p_content text,
  p_publish_at timestamptz default null, p_poll jsonb default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  -- SHARE also prevents a concurrent role change until this transaction commits.
  perform 1 from public.users where id = p_user_id
    and role in ('admin', 'superadmin') for share;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_content is null or length(btrim(p_content)) = 0 then
    raise exception 'Post content is required' using errcode = '22023';
  end if;
  if p_publish_at is not null and
    (not isfinite(p_publish_at) or p_publish_at <= clock_timestamp()) then
    raise exception 'Scheduled publication must be in the future' using errcode = '22023';
  end if;
  perform public.validate_community_poll(p_poll, coalesce(p_publish_at, clock_timestamp()));
  if p_publish_at is not null then
    insert into public.scheduled_posts(user_id, content, publish_at, poll)
    values (p_user_id, btrim(p_content), p_publish_at, p_poll) returning id into v_id;
    return jsonb_build_object('id', v_id, 'scheduled', true);
  end if;
  insert into public.posts(user_id, content, is_poll)
  values (p_user_id, btrim(p_content), p_poll is not null) returning id into v_id;
  perform public.insert_community_poll(v_id, p_poll);
  return jsonb_build_object('id', v_id, 'scheduled', false);
end;
$$;

create function public.publish_scheduled_posts()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_draft public.scheduled_posts%rowtype;
  v_count integer := 0;
begin
  for v_draft in
    select * from public.scheduled_posts where publish_at <= clock_timestamp()
    order by publish_at, id limit 100 for update skip locked
  loop
    perform 1 from public.users where id = v_draft.user_id
      and role in ('admin', 'superadmin') for share;
    if not found then
      -- Deleted authors cascade; demoted authors cannot publish old admin drafts.
      delete from public.scheduled_posts where id = v_draft.id;
      continue;
    end if;
    insert into public.posts(id, user_id, content, is_poll)
    values (v_draft.id, v_draft.user_id, v_draft.content, v_draft.poll is not null);
    -- Do not revalidate against NOW: a delayed job may publish an already closed poll.
    perform public.insert_community_poll(v_draft.id, v_draft.poll);
    delete from public.scheduled_posts where id = v_draft.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.cast_post_poll_vote(p_post_id uuid, p_user_id uuid, p_option_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_closes_at timestamptz;
begin
  perform 1 from public.users where id = p_user_id
    and role in ('student', 'admin', 'superadmin') for share;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
  -- Serialize votes with poll edits/deletion and evaluate closure after obtaining the lock.
  select closes_at into v_closes_at from public.post_polls
    where post_id = p_post_id for update;
  if not found then raise exception 'Poll not found' using errcode = 'P0002'; end if;
  if v_closes_at is not null and v_closes_at <= clock_timestamp() then
    raise exception 'This poll is closed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.post_poll_options where post_id = p_post_id and id = p_option_id) then
    raise exception 'Invalid poll option' using errcode = '22023';
  end if;
  insert into public.post_poll_votes(post_id, user_id, option_id)
  values (p_post_id, p_user_id, p_option_id)
  on conflict (post_id, user_id) do update set option_id = excluded.option_id;
end;
$$;

create function public.get_post_poll(p_post_id uuid, p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not exists (select 1 from public.users where id = p_user_id
    and role in ('student', 'admin', 'superadmin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- One statement snapshot keeps totals, option counts and the caller's vote consistent.
  select jsonb_build_object(
    'post_id', p.post_id,
    'closes_at', p.closes_at,
    'closed', p.closes_at is not null and p.closes_at <= clock_timestamp(),
    'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label,
      'votes', (select count(*) from public.post_poll_votes v where v.post_id = p.post_id and v.option_id = o.id))
      order by o.sort_order) from public.post_poll_options o where o.post_id = p.post_id),
    'total_votes', (select count(*) from public.post_poll_votes v where v.post_id = p.post_id),
    'my_option_id', (select v.option_id from public.post_poll_votes v where v.post_id = p.post_id and v.user_id = p_user_id)
  ) into v_result from public.post_polls p where p.post_id = p_post_id;
  return v_result;
end;
$$;

revoke all on function public.validate_community_poll(jsonb, timestamptz),
  public.validate_scheduled_post(), public.insert_community_poll(uuid, jsonb),
  public.create_community_post(uuid, text, timestamptz, jsonb),
  public.publish_scheduled_posts(), public.cast_post_poll_vote(uuid, uuid, uuid),
  public.get_post_poll(uuid, uuid) from public, anon, authenticated;
grant execute on function public.validate_community_poll(jsonb, timestamptz),
  public.validate_scheduled_post(), public.insert_community_poll(uuid, jsonb),
  public.create_community_post(uuid, text, timestamptz, jsonb),
  public.publish_scheduled_posts(), public.cast_post_poll_vote(uuid, uuid, uuid),
  public.get_post_poll(uuid, uuid) to service_role;

-- Runs as the migration owner; no credentials, web endpoint or public draft access.
create extension if not exists pg_cron;
select cron.schedule('publish-scheduled-posts', '* * * * *', 'select public.publish_scheduled_posts()');
