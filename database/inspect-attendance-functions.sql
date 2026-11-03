-- UniAttend: READ-ONLY diagnostic. Run in Supabase SQL Editor and copy the results.
-- This reveals the exact deployed RPC definitions so the GPS requirement can be changed safely.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_attendance_session',
    'issue_attendance_qr_token',
    'check_in_with_qr',
    'create_manual_attendance_code',
    'check_in_with_manual_code'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);
