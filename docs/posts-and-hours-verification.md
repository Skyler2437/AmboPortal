# Posts and hours: local verification (September 12, 2026)

## Implemented

- Web service hours use the canonical service-type selector (including Other), zero default tour credits, decimal hours, and an editable service date consistently evaluated in Pacific Time.
- The submission API returns a persisted ID. The form only reports success after a JSON confirmation; expired sessions, login HTML and network errors retain the form.
- Admins can create text posts or polls immediately, or schedule them; admins manage their own pending posts and superadmins can manage all pending posts.
- Polls have 2–6 distinct options and an optional closing time. Students and staff each have one replaceable vote until closing. Only totals and the caller's choice are exposed.
- Both platforms show scheduled management and polls. Advanced posts currently exclude attachments; the existing ordinary attachment flow remains available.
- Application portal expansion and user deactivation are deferred.

## Verification completed

- Web: 270 Vitest tests pass, including 51 submission tests and 29 community API/auth tests. TypeScript and lint pass (existing warnings only). The production web build passes with new authenticated routes marked dynamic.
- Mobile: 146 Vitest tests pass, TypeScript and lint pass (existing warnings only). A mounted regression test covers a stale poll GET completing after a confirmed vote.
- Database: actual migration executed in local PostgreSQL through PGlite. Tests pass for private table/function grants, role enforcement, validation, replacement votes, closing, cross-poll rejection, invisible scheduled drafts, publish-once behavior, delayed publication, demotion, and transactional rollback.
- Browser: real form/components at 320, 390 and 768 pixel widths with no horizontal overflow. Intercepted test responses exercise 401, HTML instead of confirmation, network failure, persisted-ID confirmation, reset defaults, decimal hours and Other notes. Poll selection/revoting and scheduled creation/edit/cancel work with test responses.
- iOS: Release build compiled with zero errors, installed on iPhone 17 Pro simulator, and visibly launched to sign-in. No live post or vote was created. The installed bundle is newer than the final mobile edits.
- Independent reviewers checked hours, web/API, mobile, and integrated security/compatibility. Findings fixed: inconsistent date zones and stale vote refreshes. Scoped re-review passed.

## Release boundaries

On September 12, Skyler authorized creating a feature branch and applying the reviewed migration. Branch `athena-09-12-2026` was created and production migration `20260912072651` was applied and verified. Skyler subsequently signed off on the Release build and authorized the commit/push/PR workflow. No production post or student record write has been performed.

The temporary browser fixture was removed before the production web build. Browser response interception checks UI behavior without claiming a live database write or a physical installed-PWA test. The reported student's exact phone failure still needs their error/device details for attribution.

The migration is `apps/web/supabase/migrations/20260912140601_scheduled_posts_and_polls.sql`. Follow `docs/supabase-migration-runbook.md`: production authorization, project identity, application, schema/grants/RPC/cron checks and both advisors are complete; see docs/scheduled-posts-and-polls-database.md for the results. Real pg_cron execution is now verified on the empty production queue. Overlapping workers and actual webhook delivery remain live verification boundaries.

The repository requires Skyler's confirmation that the Release build is good before push. A feature branch requires an explicit request; direct commits/pushes to main also require explicit authorization. Production EAS/App Store release remains a separate later step.
