# Posts and Hours Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent work and review. Steps use checkbox syntax.

**Goal:** Reliable web hours submissions plus scheduled posts and polls on web/mobile.
**Architecture:** Server-only scheduled drafts, atomic database publication, private votes, cookie/Bearer authenticated APIs, platform-specific controls.
**Tech Stack:** Next.js, React Native/Expo, Supabase/Postgres, Vitest.
**Spec:** docs/superpowers/specs/2026-09-12-posts-and-hours-design.md

## Global Constraints
- 2–6 distinct poll options; only admin/superadmin creates polls or schedules.
- Student votes may change until closing; never expose voter identities.
- No commits, pushes, production migration or release without established authorization.
- Preserve existing ordinary posts and their attachment workflow.

### Task 1: Web hours
- [x] Add tests for allowed service types, decimal hours, dates, expired sessions, confirmed insert responses.
- [x] Update NewSubmissionForm, submissions API, validation, and targeted middleware API handling.
- [x] Run focused tests and verify phone-width form behavior.

### Task 2: Database publication and polls
- [x] Add migration with scheduled_posts, post_polls, post_poll_options, post_poll_votes; RLS and restricted grants.
- [x] Implement service-only RPCs create_community_post, publish_scheduled_posts, cast_post_poll_vote and get_post_poll.
- [x] Verify migration transaction, cron setup, race handling, privacy, and function grants.

### Task 3: Server and web post controls
- [x] Implement /api/community/posts (POST), /scheduled (GET), /scheduled/[id] (PATCH, DELETE), /[id]/poll (GET, POST).
- [x] Validate live role and cookie/Bearer identity; RPC writes return persisted data.
- [x] Add web composer settings, scheduled management and poll voting/results.
- [x] Test contracts and permission/error cases.

### Task 4: Native post controls
- [x] Add authenticated community API client, admin composer options and scheduled management screen.
- [x] Add poll voting/results on feed/detail; preserve normal attachment posts.
- [x] Run native tests/typecheck and Release build.

### Task 5: Review and verification
- [x] Review each independent change and integrated authorization/publication boundaries.
- [x] Run both suites, lint/typechecks/build and targeted browser checks.
- [x] Report local results and precise migration/release gates.

## Completion record

Local implementation and review are complete. See docs/posts-and-hours-verification.md for evidence and remaining production authorization/verification boundaries.
