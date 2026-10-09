// Run against local PostgreSQL; never writes to the live project.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const post = '00000000-0000-4000-8000-000000000003';
const attachment = { id: '00000000-0000-4000-8000-000000000004', file_url: 'https://storage.example/photo.jpg', file_name: 'photo.jpg', file_type: 'image/jpeg', file_size: 100 };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.users(id uuid primary key, role text);
    create table public.posts(id uuid primary key, user_id uuid references public.users, content text);
    create table public.post_attachments(id uuid primary key, post_id uuid references public.posts,
      file_url text not null, file_name text not null, file_type text not null,
      file_size bigint not null check(file_size > 0), uploaded_by uuid references public.users);
    create table public.notification_test_log(post_id uuid);
    create function public.test_notify() returns trigger language plpgsql as $$
      begin insert into public.notification_test_log values(new.id); return new; end $$;
    create trigger test_notify after insert on public.posts for each row execute function public.test_notify();
    grant all on all tables in schema public to service_role;
  `);
  await db.query('insert into public.users values ($1,\'student\'),($2,\'applicant\')', [user, other]);
  await db.exec(await readFile(new URL('../migrations/20261008232103_create_post_with_attachments.sql', import.meta.url), 'utf8'));
  const save = (id = post, uid = user, content = 'Hello', attachments = [attachment]) => db.query(
    'select public.create_post_with_attachments($1,$2,$3,$4::jsonb)', [id, uid, content, JSON.stringify(attachments)]);
  await db.exec('set role service_role');
  await save();
  await save(); // A lost response followed by retry must not publish/notify twice.
  assert.equal((await db.query('select count(*)::int as n from posts')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from post_attachments')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from notification_test_log')).rows[0].n, 1);
  await assert.rejects(save(post, user, 'Changed draft'), /already published/);
  await assert.rejects(save(post, user, 'Hello', []), /already published/);
  await assert.rejects(save(post, other), /Not authorized/);
  const badPost = '00000000-0000-4000-8000-000000000005';
  // Reusing an attachment ID fails after post insertion: the whole transaction rolls back.
  await assert.rejects(save(badPost), /duplicate key/);
  assert.equal((await db.query('select count(*)::int as n from posts')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from notification_test_log')).rows[0].n, 1);
  await assert.rejects(save(badPost, user, 'Hello', Array(6).fill(attachment)), /attachments/);
  await assert.rejects(save(badPost, user, 'Hello', [{...attachment, file_size: 11 * 1024 * 1024}]), /attachment/);
  await assert.rejects(save(badPost, user, '', []), /content/);
  await save(badPost, user, '', [{...attachment, id: '00000000-0000-4000-8000-000000000006'}]);
  await db.exec('reset role');
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(save(), /permission denied/);
    await db.exec('reset role');
  }
  console.log('PASS: post and attachments commit together; retry does not duplicate posts/notifications; roles and attachment limits are enforced.');
} finally { await db.close(); }
