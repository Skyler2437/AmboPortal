// Run against a temporary PGlite install; never connects to production.
// npm install --prefix /tmp/ambo-poll-db-tests --save-exact @electric-sql/pglite@0.5.8
// PGLITE_MODULE=/tmp/ambo-poll-db-tests/node_modules/@electric-sql/pglite/dist/index.js node apps/web/supabase/tests/scheduled-posts-and-polls.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the installed PGlite module path; see docs/scheduled-posts-and-polls-database.md');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.users(id uuid primary key, role text not null);
  create table public.posts(id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users(id) on delete cascade, content text,
    created_at timestamptz default now());
  create table public.test_notifications(post_id uuid);
  create function public.test_notify() returns trigger language plpgsql as $$
    begin insert into public.test_notifications values (new.id); return new; end $$;
  create trigger notify_post after insert on public.posts for each row execute function public.test_notify();
  grant select, update on public.users to service_role;
  grant all on public.posts, public.test_notifications to service_role;
  create schema cron;
  create table cron.test_jobs(name text, schedule text, command text);
  create function cron.schedule(text,text,text) returns integer language sql as $$
    insert into cron.test_jobs values ($1,$2,$3) returning 1; $$;
`);
const migration = await readFile(new URL('../migrations/20260912140601_scheduled_posts_and_polls.sql', import.meta.url), 'utf8');
// PGlite lacks pg_cron: execute every schema/function statement; stub only the job registrar.
await db.exec(migration.replace('create extension if not exists pg_cron;', ''));
const admin = '00000000-0000-0000-0000-000000000001';
const student = '00000000-0000-0000-0000-000000000002';
const applicant = '00000000-0000-0000-0000-000000000003';
const demoted = '00000000-0000-0000-0000-000000000004';
await db.query(`insert into public.users values ($1,'admin'),($2,'student'),($3,'applicant'),($4,'admin')`, [admin, student, applicant, demoted]);
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const create = (who, poll=null, publish=null) => scalar('select public.create_community_post($1,$2,$3,$4)', [who,'Question?',publish,poll]);
const get = (id, who=student) => scalar('select public.get_post_poll($1,$2)',[id,who]);
const vote = (id, option, who=student) => db.query('select public.cast_post_poll_vote($1,$2,$3)',[id,who,option]);
const poll = { options: ['One', 'Two'], closes_at: null };
const future = new Date(Date.now()+3600_000).toISOString();
const past = new Date(Date.now()-3600_000).toISOString();

await db.exec('set role service_role');
await assert.rejects(create(student), /Forbidden/);
await assert.rejects(create(admin,{options:['same',' SAME ']}), /distinct/);
await assert.rejects(create(admin,{options:['only']}), /2 to 6/);
await assert.rejects(create(admin,poll,past), /future/);
await assert.rejects(create(admin,{...poll,closes_at:future},future), /follow publication/);
const immediate = await create(admin,poll);
assert.equal(immediate.scheduled,false);
assert.equal(await scalar('select is_poll from public.posts where id=$1',[immediate.id]),true);
let result = await get(immediate.id);
assert.equal(result.total_votes,0);
await vote(immediate.id,result.options[0].id);
await vote(immediate.id,result.options[0].id);
await vote(immediate.id,result.options[1].id);
result = await get(immediate.id);
assert.equal(result.total_votes,1);
assert.deepEqual(result.options.map(o=>o.votes),[0,1]);
assert.equal(result.my_option_id,result.options[1].id);
assert.equal(JSON.stringify(result).includes(student),false);
await assert.rejects(get(immediate.id,applicant), /Forbidden/);
await assert.rejects(vote(immediate.id,result.options[0].id,applicant), /Forbidden/);
const second = await create(admin,poll);
await assert.rejects(vote(second.id,result.options[0].id), /Invalid poll option/);
await assert.rejects(db.query('insert into public.post_poll_votes values ($1,$2,$3)',[second.id,student,result.options[0].id]), /foreign key/);
await db.query('update public.post_polls set closes_at=$1 where post_id=$2',[past,immediate.id]);
await assert.rejects(vote(immediate.id,result.options[0].id), /closed/);
assert.equal((await get(immediate.id)).closed,true);
const plain = await create(admin);
assert.equal(await get(plain.id),null);

const draft = await create(admin,poll,future);
assert.equal(draft.scheduled,true);
assert.equal(await scalar('select count(*)::int from public.posts where id=$1',[draft.id]),0);
assert.equal(await scalar('select count(*)::int from public.test_notifications where post_id=$1',[draft.id]),0);
assert.equal(await scalar('select public.publish_scheduled_posts()'),0);
// A delayed runner publishes using the intended original close, even if already closed.
await db.query('update public.scheduled_posts set publish_at=$1,poll=$2 where id=$3',[
  new Date(Date.now()-7200_000).toISOString(),{...poll,closes_at:past},draft.id]);
assert.equal(await scalar('select public.publish_scheduled_posts()'),1);
assert.equal(await scalar('select public.publish_scheduled_posts()'),0);
assert.equal((await get(draft.id)).closed,true);
assert.equal(await scalar('select count(*)::int from public.test_notifications where post_id=$1',[draft.id]),1);
assert.equal(await scalar('select count(*)::int from public.scheduled_posts where id=$1',[draft.id]),0);
const doomed = await create(demoted,poll,future);
await db.query('update public.scheduled_posts set publish_at=$1 where id=$2',[past,doomed.id]);
await db.exec('reset role');
await db.query("update public.users set role='student' where id=$1",[demoted]);
await db.exec('set role service_role');
assert.equal(await scalar('select public.publish_scheduled_posts()'),0);
assert.equal(await scalar('select count(*)::int from public.scheduled_posts where id=$1',[doomed.id]),0);
assert.equal(await scalar('select count(*)::int from public.posts where id=$1',[doomed.id]),0);

// Even a failure AFTER the post/notification insert rolls the entire RPC back.
await db.exec('reset role');
await db.exec(`create function public.test_fail_poll() returns trigger language plpgsql as $$
 begin raise exception 'simulated poll failure'; end $$;
 create trigger test_fail_poll before insert on public.post_polls for each row execute function public.test_fail_poll();`);
const before = await scalar('select count(*)::int from public.posts');
const notices = await scalar('select count(*)::int from public.test_notifications');
await assert.rejects(create(admin,poll), /simulated poll failure/);
assert.equal(await scalar('select count(*)::int from public.posts'),before);
assert.equal(await scalar('select count(*)::int from public.test_notifications'),notices);
await db.exec('drop trigger test_fail_poll on public.post_polls');

for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  for (const table of ['scheduled_posts','post_polls','post_poll_options','post_poll_votes']) {
    await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  }
  await assert.rejects(create(admin,poll), /permission denied/);
  await assert.rejects(get(immediate.id), /permission denied/);
  await assert.rejects(vote(immediate.id,result.options[0].id), /permission denied/);
  await db.exec('reset role');
}
assert.equal(await scalar("select count(*)::int from cron.test_jobs where name='publish-scheduled-posts' and schedule='* * * * *'"),1);
assert.equal(await scalar("select count(*)::int from pg_class where relname in ('scheduled_posts','post_polls','post_poll_options','post_poll_votes') and relrowsecurity"),4);
await db.close();
console.log('PASS: migration executes; role/privacy, validation, votes, closing, delayed scheduling, demotion, atomic rollback and cron registration checks.');
