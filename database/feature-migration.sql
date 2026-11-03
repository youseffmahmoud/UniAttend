-- UniAttend feature migration (review schema + take a backup before applying)
-- Adds archive flags and optional browser-device audit tables (no IP collection). It does not delete attendance records.

alter table public.attendance_sessions
  add column if not exists is_archived boolean not null default false;

create table if not exists public.student_devices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  device_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now(),
  unique (student_id, device_key)
);

create table if not exists public.attendance_device_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  device_id uuid references public.student_devices(id) on delete set null,
  user_agent text,
  recorded_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists idx_student_devices_student on public.student_devices(student_id);
create index if not exists idx_device_events_session on public.attendance_device_events(session_id);
create index if not exists idx_device_events_student_time on public.attendance_device_events(student_id, recorded_at desc);

alter table public.student_devices enable row level security;
alter table public.attendance_device_events enable row level security;

grant select on public.student_devices, public.attendance_device_events to authenticated;
revoke insert, update, delete on public.student_devices, public.attendance_device_events from anon, authenticated;
grant all on public.student_devices, public.attendance_device_events to service_role;

-- Students can read only their own registered browser/device identifiers.
drop policy if exists uniattend_student_read_own_devices on public.student_devices;
create policy uniattend_student_read_own_devices on public.student_devices
for select to authenticated using (student_id = auth.uid());

-- A student can read their own audit events.
drop policy if exists uniattend_student_read_own_device_events on public.attendance_device_events;
create policy uniattend_student_read_own_device_events on public.attendance_device_events
for select to authenticated using (student_id = auth.uid());

-- Doctors can read browser-device audit events only for sessions they own.
drop policy if exists uniattend_doctor_read_session_device_events on public.attendance_device_events;
create policy uniattend_doctor_read_session_device_events on public.attendance_device_events
for select to authenticated using (
  exists (
    select 1 from public.attendance_sessions s
    where s.id = attendance_device_events.session_id and s.doctor_id = auth.uid()
  )
);

drop policy if exists uniattend_doctor_read_session_devices on public.student_devices;
create policy uniattend_doctor_read_session_devices on public.student_devices
for select to authenticated using (
  exists (
    select 1 from public.attendance_device_events e
    join public.attendance_sessions s on s.id = e.session_id
    where e.device_id = student_devices.id and s.doctor_id = auth.uid()
  )
);

-- Additive ownership policies for editing courses and archiving/restoring sessions.
-- Existing policies remain in place; verify they do not conflict with these policies.
drop policy if exists uniattend_doctor_update_own_courses on public.courses;
create policy uniattend_doctor_update_own_courses on public.courses
for update to authenticated using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

drop policy if exists uniattend_doctor_update_own_sessions on public.attendance_sessions;
create policy uniattend_doctor_update_own_sessions on public.attendance_sessions
for update to authenticated using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- Inserts into student_devices and attendance_device_events are performed by the Edge Function
-- with the server-side service role only after verifying the caller and a real attendance record.
-- Never grant service_role to the browser or expose SUPABASE_SERVICE_ROLE_KEY in JS/HTML.
