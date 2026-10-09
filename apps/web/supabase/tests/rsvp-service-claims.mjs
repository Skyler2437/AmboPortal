// Local PostgreSQL regression. PGLITE_MODULE points to a temporary PGlite install.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const student = '00000000-0000-4000-8000-000000000001';
const applicant = '00000000-0000-4000-8000-000000000002';
const event = '00000000-0000-4000-8000-000000000003';
const otherEvent = '00000000-0000-4000-8000-000000000004';
const option = '00000000-0000-4000-8000-000000000005';
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    create table public.users(id uuid primary key, role text not null);
    create table public.events(id uuid primary key);
    create table public.event_rsvp_options(id uuid primary key, event_id uuid references public.events);
    create table public.event_rsvps(
      event_id uuid references public.events, user_id uuid references public.users,
      status text check(status in ('going','maybe','no')),
      rsvp_option_id uuid references public.event_rsvp_options,
      primary key(event_id,user_id));
    grant select on public.users, public.event_rsvps to authenticated, service_role;
  `);
  const migrations = new URL('../migrations/', import.meta.url);
  await db.exec(await readFile(new URL('20260728160000_event_rsvp_explanations.sql', migrations), 'utf8'));
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('_fix_web_rsvp_service_claim.sql'))) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into public.users values ($1,\'student\'),($2,\'applicant\')', [student, applicant]);
  await db.query('insert into public.events values ($1),($2)', [event, otherEvent]);
  await db.query('insert into public.event_rsvp_options values ($1,$2)', [option, otherEvent]);
  const save = (status = 'going', user = student, explanation = null, choice = null) =>
    db.query('select public.save_event_rsvp_for_user($1,$2,$3,$4,$5)', [event, user, status, choice, explanation]);
  await db.exec('set role service_role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({role:'service_role'})]);
  // This fails on the old production function: it reads only the legacy claim.
  await save();
  assert.equal((await db.query('select status from public.event_rsvps')).rows[0].status, 'going');
  await save('maybe', student, 'A'.repeat(50));
  await assert.rejects(save('maybe', student, 'Too short'), /50 to 500/);
  await assert.rejects(save('going', applicant), /Not authorized/);
  await assert.rejects(save('going', student, null, option), /does not belong/);
  await save();
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.event_rsvp_explanations')).rows[0].n, 0);
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({role,sub:student})]);
    await assert.rejects(save(), /permission denied/);
    if (role === 'authenticated') {
      await db.query('select public.save_event_rsvp($1,$2)', [event, 'going']);
    }
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  for (const claims of [{role:'authenticated'}, {role:'anon'}, {}]) {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await assert.rejects(save(), /Service role required/);
  }
  await db.query("select set_config('request.jwt.claims', '', false)");
  await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await save(); // Legacy callers still work.
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({role:'authenticated'})]);
  await assert.rejects(save(), /Service role required/); // Current claims take priority.
  console.log('PASS: current service claims save RSVPs; user/anonymous access, validation, explanations, and the mobile wrapper remain protected.');
} finally {
  await db.close();
}
