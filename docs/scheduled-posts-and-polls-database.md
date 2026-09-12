# Scheduled posts and polls: database handoff

Migration: `apps/web/supabase/migrations/20260912140601_scheduled_posts_and_polls.sql`.
Applied to production AmboPortal (`lazwwkysaygqkskpbzbd`) on September 12, 2026 after Skyler's explicit approval. Remote migration version: `20260912072651`, name: `scheduled_posts_and_polls`. The local timestamp differs from the server-assigned migration-history timestamp; both identify this exact SQL.

## Access and contracts

The four new tables have RLS enabled and no `PUBLIC`, `anon`, or `authenticated`
privileges. All new functions are security invoker with an empty search path and
execute privileges restricted to `service_role` (plus their owner). The server must
verify the caller and supply their actual user ID; these RPCs are not client APIs.

- `create_community_post(p_user_id, p_content, p_publish_at = null, p_poll = null)`
  returns `{id, scheduled}`. Only a live admin or superadmin may create. A supplied
  publication time must be future. Poll JSON is `{options: string[], closes_at: string | null}`.
  There must be 2–6 distinct, nonblank options of at most 200 characters each.
  The post content is the question. Closing time must follow intended publication.
- `publish_scheduled_posts()` returns the number published. It processes up to 100
  due drafts per invocation with row locks and `SKIP LOCKED`. Publication preserves
  the draft UUID, inserts the post and poll atomically, and deletes the draft.
  Deleted authors cascade; demoted authors' due drafts are discarded. An overdue
  poll is still published with its original closing time and appears closed.
- `cast_post_poll_vote(p_post_id, p_user_id, p_option_id)` returns void. Live
  students, admins, and superadmins can vote or change their vote until closing.
  A poll row lock serializes voting; a composite FK also prohibits cross-poll options.
- `get_post_poll(p_post_id, p_user_id)` returns null for a missing poll, otherwise
  `{post_id, closes_at, closed, options: [{id, label, votes}], total_votes, my_option_id}`.
  It accepts the same live roles as voting and never returns other voters' identities.

`posts.is_poll` is display metadata; the poll table remains authoritative.
Scheduled row updates also run poll validation. API edits/deletes must select the
affected pending row and report a missing row if publication won the race.

## Notifications and cron

Draft creation does not touch posts or post attachments. Existing `notify_post`
is reached only during publication or an immediate post creation. A failure while
creating a poll rolls back the post and its transactional notification request.
Production's actual webhook delivery still requires live verification after release.

The migration enables `pg_cron` and registers `publish-scheduled-posts` every minute
as the migration owner. No HTTP secret or separate app cron endpoint is needed.
Read-only inspection before implementation found `pg_cron` not yet installed.
After authorized deployment, inspect the extension, job, and `cron.job_run_details`
along with tables, grants, functions, constraints, and security/performance advisors.

## Local verification

The standalone test uses PostgreSQL through PGlite 0.5.8 and does not connect to any
remote database. Install it outside the repository to avoid changing app dependencies:

```sh
npm install --prefix /tmp/ambo-poll-db-tests --save-exact @electric-sql/pglite@0.5.8
PGLITE_MODULE=/tmp/ambo-poll-db-tests/node_modules/@electric-sql/pglite/dist/index.js node apps/web/supabase/tests/scheduled-posts-and-polls.mjs
```

It executes the migration against minimal existing users/posts fixtures, exercising
role checks, private table/RPC access, option validation, vote replacement and counts,
cross-poll rejection, closing, scheduled invisibility, publish-once behavior, delayed
poll closing, demotion, and rollback after a simulated poll insertion failure.

PGlite does not include pg_cron or multiple concurrent connections: only extension
installation is omitted and cron registration is stubbed. Actual cron execution,
overlapping workers/edits, production RLS integration, and webhook delivery require
release verification. The SQL row locks and FK constraints are present in the tested
migration; the harness does not claim to simulate concurrent workers.

## Production verification — September 12, 2026

- Verified AmboPortal name and project ID before application; new objects did not already exist.
- Migration operation returned success and remote history contains `20260912072651`.
- Confirmed all four tables, columns, PK/FK/check constraints, indexes, and validation trigger.
- Confirmed RLS is enabled, anonymous/authenticated table reads are denied, and service-role CRUD is allowed.
- Confirmed all seven functions use SECURITY INVOKER and an empty search_path. Anonymous/authenticated execution is denied; service-role execution is granted.
- `posts.is_poll` is non-null boolean, default false.
- `publish-scheduled-posts` is active every minute as postgres. First observed cron run succeeded at 07:27:00 Pacific on September 12, 2026, with an empty queue. This verifies real cron execution, not real post/notification delivery.
- Safe missing-poll read returns null. New draft, poll and vote tables are empty; no test posts or student records were created.
- Security and performance advisors compared before/after: no new WARN or ERROR findings. Four new [RLS enabled/no policy informational notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional for service-only tables with client privileges revoked. Three [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) are expected before feature use; indexes support ownership/FK/aggregate queries. Existing unrelated warnings remain unchanged.

Application code remains local on `athena-09-12-2026`. Skyler signed off on the Release build; branch push and PR verification are authorized. Production app deployment still requires merge. Live publication/notification delivery remains to be checked after deployment with an explicitly authorized real post.
