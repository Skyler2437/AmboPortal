# Supabase Migration Runbook

The default AmboPortal workflow is to apply production database migrations from the ChatGPT/Codex task through the authenticated Supabase connection. Skyler should not need to copy SQL into the online SQL Editor.

## Production target

- Project name: `AmboPortal`
- Project ID/ref: `lazwwkysaygqkskpbzbd`
- Region: `us-east-2`

There is another accessible project named `uPortal`. Never infer the target from recency or organization alone. Before every write, list the available projects and match both the **AmboPortal** name and the exact project ID above.

## Authorization

Production schema and data mutations require clear authorization in the current task. A useful one-time authorization is:

> Apply the reviewed AmboPortal migration to production, verify it, and fix any migration-specific issues you find.

That authorization covers the migration, its required verification queries, and Supabase advisors. It does not authorize unrelated data edits or a different Supabase project.

## Current migration-history model

This project historically applied many SQL files manually, so the remote `supabase_migrations.schema_migrations` history does not contain every file under `apps/web/supabase/migrations/`.

Until that history is deliberately reconciled:

- do not run `supabase db push` blindly;
- do not mark old migrations applied without comparing the live schema;
- use the authenticated Supabase connection to apply one reviewed migration at a time;
- keep the SQL migration file in Git as the source record;
- record the remote migration result and verify the live schema.

The online SQL Editor is a fallback only when the authenticated connection is unavailable.

## Standard workflow

### 1. Inspect and review

1. Read the complete migration SQL.
2. Identify whether it changes schema, RLS, functions, triggers, storage, or user data.
3. Check for destructive operations, long table locks, non-idempotent data rewrites, and missing rollback considerations.
4. For exposed `public` tables, require RLS and appropriately scoped policies.
5. For functions:
   - prefer `SECURITY INVOKER`;
   - use `SECURITY DEFINER` only when genuinely required;
   - set a safe `search_path`;
   - revoke default `PUBLIC` execution when appropriate;
   - avoid deprecated `auth.role()` authorization patterns.
6. Confirm any new Data API table has the intended grants and RLS behavior.

### 2. Confirm the target

Use the Supabase connection to list projects. Stop unless the target is exactly:

```text
AmboPortal — lazwwkysaygqkskpbzbd
```

Then list remote migrations and inspect the live objects touched by the migration. If the desired schema already exists, do not reapply SQL blindly; determine whether this is an untracked historical migration.

### 3. Apply the migration

For production-ready DDL, use the Supabase migration operation with:

- `project_id: lazwwkysaygqkskpbzbd`;
- a concise snake_case migration name matching the local file's descriptive suffix;
- the exact reviewed SQL from the migration file.

Use raw SQL execution for read-only verification and carefully scoped data operations, not as the default way to apply DDL.

Apply only one migration at a time. Never run multiple production migrations in parallel.

### 4. Verify immediately

After a successful apply:

1. List remote migrations and confirm the new entry exists.
2. Run targeted read-only SQL to verify every object or behavior changed.
3. For tables, confirm columns, constraints, indexes, grants, and RLS state.
4. For functions, confirm signature, security mode, owner/grants, and a safe test invocation when possible.
5. For policies, inspect the policy expressions and test the expected allowed/denied access path when practical.
6. Run both Supabase security and performance advisors after DDL.
7. Investigate new advisor findings caused by the migration. Do not silently ignore them.

A migration is not complete until verification passes.

### 5. Report

Tell Skyler:

- the project ID targeted;
- the migration name;
- what changed;
- verification queries/results;
- security/performance advisor results;
- any remaining manual or application-deployment step.

Never print or store database passwords, access tokens, service-role keys, session secrets, or private user data in the task or repository.

## Failure handling

- If authentication is missing, ask Skyler to complete the Supabase connection once, then continue in the same task.
- If the migration partially fails, inspect the live schema before retrying.
- After two or three failed attempts, stop repeating the same operation and reassess the SQL and database state.
- If a migration is already present but absent from remote history, report the discrepancy; do not re-run destructive statements merely to create a history entry.
- Use the SQL Editor only if the Supabase connection cannot perform the required operation, and explain why.

## Future cleanup

The long-term ideal is to reconcile all local migration files with remote migration history and then deploy with a single migration pipeline. Until that dedicated reconciliation is completed and tested, the per-migration Supabase connection workflow above is safer than a blind `db push`.
