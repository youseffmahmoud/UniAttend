-- UniAttend: stop storing IP addresses in browser-device attendance audit events.
-- Back up the database first. This removes historical IP values from this audit table only.
-- It does NOT modify attendance records, QR tokens, sessions, or student profiles.

do $$
begin
  if to_regclass('public.attendance_device_events') is not null then
    execute 'alter table public.attendance_device_events drop column if exists ip_address';
  end if;
end
$$;

notify pgrst, 'reload schema';
