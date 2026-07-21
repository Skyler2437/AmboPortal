import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260720_event_views_attendance.sql"
);

function readMigration(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("event views and attendance migration", () => {
  it("defines the event view and attendance storage contracts", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.event_views");
    expect(sql).toContain("unique (event_id, user_id)");
    expect(sql).toContain("create table if not exists public.event_attendance");
    expect(sql).toContain("primary key (event_id, user_id)");
    expect(sql).toContain(
      "check (status in ('present', 'absent', 'excused_absent'))"
    );
  });

  it("enables RLS and grants only the intended direct table access", () => {
    const sql = readMigration();

    expect(sql).toContain(
      "create index if not exists idx_event_views_event_id on public.event_views(event_id)"
    );
    expect(sql).toContain(
      "create index if not exists idx_event_views_user_id on public.event_views(user_id)"
    );
    expect(sql).toContain(
      "create index if not exists idx_event_attendance_user_id on public.event_attendance(user_id)"
    );
    expect(sql).toContain(
      "alter table public.event_views enable row level security"
    );
    expect(sql).toContain(
      "grant select, insert on public.event_views to authenticated"
    );
    expect(sql).toContain(
      "alter table public.event_attendance enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.event_attendance from anon, authenticated"
    );
    expect(sql).toContain(
      "grant select on public.event_attendance to authenticated"
    );
  });

  it("defines a locked-down event manager authorization helper", () => {
    const sql = readMigration();

    expect(sql).toContain(
      "create or replace function public.can_manage_event(check_event_id uuid)"
    );
    expect(sql).toMatch(
      /public\.can_manage_event\(check_event_id uuid\)[\s\S]*security definer[\s\S]*set search_path = ''[\s\S]*e\.created_by = auth\.uid\(\)/
    );
    expect(sql).toContain(
      "u.role in ('admin', 'superadmin') or e.created_by = auth.uid()"
    );
    expect(sql).toContain(
      "revoke all on function public.can_manage_event(uuid) from public"
    );
    expect(sql).toContain(
      "grant execute on function public.can_manage_event(uuid) to authenticated"
    );
  });

  it("keeps event views attributable and hides non-present attendance from peers", () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /create policy event_views_select_authenticated[\s\S]*for select to authenticated using \(true\)/
    );
    expect(sql).toMatch(
      /create policy event_views_insert_own[\s\S]*for insert to authenticated with check \(user_id = auth\.uid\(\)\)/
    );
    expect(sql).toMatch(
      /create policy event_attendance_select_visible[\s\S]*public\.can_manage_event\(event_id\)[\s\S]*status = 'present'[\s\S]*u\.role in \('student', 'admin', 'superadmin'\)/
    );
    expect(sql).not.toMatch(
      /create policy event_attendance_(insert|update|delete)/
    );
  });

  it("defines one authorized, validated, atomic attendance save RPC", () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /create or replace function public\.save_event_attendance\(\s*target_event_id uuid,\s*changes jsonb\s*\)/
    );
    expect(sql).toMatch(
      /public\.save_event_attendance\([\s\S]*language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/
    );
    expect(sql).toContain(
      "if auth.uid() is null or not public.can_manage_event(target_event_id) then"
    );
    expect(sql).toContain("if jsonb_typeof(changes) <> 'array' then");
    expect(sql).toContain(
      "raise exception 'Each change requires a valid user_id' using errcode = '22023'"
    );
    expect(sql).toContain(
      "raise exception 'Duplicate user_id in attendance changes' using errcode = '22023'"
    );
    expect(sql).toContain("where id = changed_user_id and role = 'student'");
    expect(sql).toMatch(
      /if changed_status is null then[\s\S]*delete from public\.event_attendance/
    );
    expect(sql).toContain(
      "elsif changed_status in ('present', 'absent', 'excused_absent') then"
    );
    expect(sql).toContain("on conflict (event_id, user_id) do update");
    expect(sql).toContain(
      "raise exception 'Invalid attendance status' using errcode = '22023'"
    );
    expect(sql).toContain(
      "revoke all on function public.save_event_attendance(uuid, jsonb) from public"
    );
    expect(sql).toContain(
      "grant execute on function public.save_event_attendance(uuid, jsonb) to authenticated"
    );
  });

  it("replaces broad event and RSVP-option mutations with manager policies", () => {
    const sql = readMigration();

    expect(sql).toContain(
      'drop policy if exists "Members can insert events" on public.events'
    );
    expect(sql).toMatch(
      /create policy events_insert_own[\s\S]*created_by = auth\.uid\(\)[\s\S]*u\.role in \('student', 'admin', 'superadmin'\)/
    );
    expect(sql).toMatch(
      /create policy events_update_manager[\s\S]*using \(public\.can_manage_event\(id\)\)[\s\S]*with check \(public\.can_manage_event\(id\)\)/
    );
    expect(sql).toMatch(
      /create policy events_delete_manager[\s\S]*using \(public\.can_manage_event\(id\)\)/
    );
    expect(sql).toContain(
      'drop policy if exists "Members can manage rsvp options" on public.event_rsvp_options'
    );
    expect(sql).toMatch(
      /create policy event_rsvp_options_select_authenticated[\s\S]*for select to authenticated[\s\S]*using \(true\)/
    );
    for (const operation of ["insert", "update", "delete"]) {
      expect(sql).toContain(
        `create policy event_rsvp_options_${operation}_manager`
      );
    }
    expect(sql).toContain("public.can_manage_event(event_id)");
  });

  it("replaces the permissive live post insert policy with self-attribution", () => {
    const sql = readMigration();

    expect(sql).toContain(
      'drop policy if exists "Authenticated users can create posts" on public.posts'
    );
    expect(sql).toMatch(
      /create policy posts_insert_own on public\.posts\s+for insert to authenticated\s+with check \(user_id = auth\.uid\(\)\)/
    );
    expect(sql.match(/create policy posts_[\w]+ on public\.posts/g)).toHaveLength(
      1
    );
  });
});
