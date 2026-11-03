-- UniAttend admin access policies
-- Review the current schema/policies before running this migration in production.
-- This helper avoids recursive RLS lookups when checking profiles.role.

create or replace function public.uniattend_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(p.role::text) = 'ADMIN'
  );
$$;

revoke all on function public.uniattend_is_admin() from public;
grant execute on function public.uniattend_is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists uniattend_admin_read_profiles on public.profiles;
create policy uniattend_admin_read_profiles
on public.profiles for select to authenticated
using (public.uniattend_is_admin());

drop policy if exists uniattend_admin_read_courses on public.courses;
create policy uniattend_admin_read_courses
on public.courses for select to authenticated
using (public.uniattend_is_admin());

drop policy if exists uniattend_admin_insert_courses on public.courses;
create policy uniattend_admin_insert_courses
on public.courses for insert to authenticated
with check (public.uniattend_is_admin());

drop policy if exists uniattend_admin_update_courses on public.courses;
create policy uniattend_admin_update_courses
on public.courses for update to authenticated
using (public.uniattend_is_admin())
with check (public.uniattend_is_admin());

-- No admin DELETE policy is added here: deleting a course may cascade into attendance records.

drop policy if exists uniattend_admin_read_sessions on public.attendance_sessions;
create policy uniattend_admin_read_sessions
on public.attendance_sessions for select to authenticated
using (public.uniattend_is_admin());

drop policy if exists uniattend_admin_update_sessions on public.attendance_sessions;
create policy uniattend_admin_update_sessions
on public.attendance_sessions for update to authenticated
using (public.uniattend_is_admin())
with check (public.uniattend_is_admin());

drop policy if exists uniattend_admin_read_attendance_records on public.attendance_records;
create policy uniattend_admin_read_attendance_records
on public.attendance_records for select to authenticated
using (public.uniattend_is_admin());
