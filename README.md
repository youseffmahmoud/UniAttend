# UniAttend — Updated Project

## What is included
- `index.html`: login and student registration; login supports Student, Doctor, and Admin roles.
- `dashboard.html`: student dashboard with QR scanning and a manual-code fallback UI.
- `doctor-dashboard.html`: doctor dashboard, course editing, session controls, archive/restore of past lectures without deleting attendance, manual session coordinates, and CSV export.
- `attendance-analysis.html`: separate smart attendance analysis page linked from the doctor dashboard.
- `supabase/functions/log-attendance-device/index.ts`: optional browser-device audit logging after a successful attendance record; IP addresses are not collected.
- `admin-dashboard.html`: admin overview, profiles list, doctor account creation with an admin-defined password, course assignment, and session ending.
- `set-password.html`: legacy password setup page for any older invitation-based accounts.
- `css/` and `js/`: page-specific styles and scripts.
- `supabase/functions/admin-create-doctor/index.ts`: secure Edge Function for admin-only doctor account creation.
- `database/admin-policies.sql`: additive admin RLS policies.
- `database/manual-attendance-code-migration.sql`: secure 6-digit manual fallback code with 60-second expiry and server-side radius validation.
- `database/feature-migration.sql`: session archiving and browser-device audit tables (without IP) plus additive ownership policies.
- `database/optional-gps-qr-migration.sql`: makes GPS optional for QR session creation and QR check-in; QR token/session validation and duplicate prevention remain server-side.
- `SUPABASE-SETUP-AR.md`: Arabic, step-by-step Supabase database setup and validation guide.

## Doctor account creation
The admin dashboard creates a confirmed Supabase Auth doctor account using the email and password entered by the administrator. The doctor can sign in immediately; no invitation email or forced password-reset step is required. This is handled only by the `admin-create-doctor` Edge Function using the server-side service-role key.

## Important setup steps (in order)
1. Extract the ZIP and upload all files with the same folder structure to your HTTPS host.
2. Check `supabase-config.js` has the correct Supabase URL and publishable/anon key. Never place a service-role key in browser files.
3. Back up your database and verify the actual live schema in Supabase Table Editor/SQL Editor before applying any migration. Test in a staging project first.
4. If the expected columns exist, apply `database/manual-attendance-code-migration.sql`. It expects `attendance_records` to contain `session_id`, `course_id`, `student_id`, `checked_in_at`, `distance_m`, `latitude`, and `longitude`, and it expects the `extensions` crypto functions used by the script. Do not run it if those assumptions do not match.
5. Apply `database/feature-migration.sql` after confirming `profiles(id)`, `attendance_sessions(id, doctor_id)`, and `attendance_records(session_id, student_id, checked_in_at)` match your database. This adds an archive flag and optional browser-device audit tables; it does not delete existing attendance records.
6. Review the current RLS policies, then review and apply `database/admin-policies.sql` only if its table/column assumptions match your live schema. These policies are additive and do not replace old policies; conflicting policies may still need careful reconciliation.
7. Deploy the optional browser-device audit Edge Function: `supabase functions deploy log-attendance-device`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as server-side secrets. Optionally set `APP_ORIGIN` to the exact website origin. Never expose the service-role key.
8. Deploy the admin-only doctor account creation Edge Function: `supabase functions deploy admin-create-doctor`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_ORIGIN` as secrets. Set `APP_ORIGIN` to the exact HTTPS website origin allowed to call the function.
9. Create the first administrator privately through Supabase Auth Dashboard. Then assign `profiles.role = 'ADMIN'` to that verified Auth UUID from the SQL Editor. Do not provide public admin registration.
10. Test with separate student, doctor, and admin accounts before production. Existing RLS policies, QR/manual RPC signatures, SMTP, and Edge Function secrets must be verified against the live project; this package cannot apply SQL or deploy functions on your behalf.

## Manual attendance code
The doctor QR panel includes a button to issue a six-digit backup code. This separate manual-code flow still uses GPS and server-side radius validation. Apply `database/manual-attendance-code-migration.sql` only after confirming the existing live schema matches its expected columns (`attendance_records.course_id`, `latitude`, `longitude`, plus `session_id`, `student_id`, `checked_in_at`, `distance_m`). The student UI calls:
`check_in_with_manual_code(p_manual_code, p_latitude, p_longitude)`.
The database function must exist with this exact signature (or the JavaScript arguments must be adjusted to the deployed signature). It must validate the code, session, expiry, user identity, radius, and duplicate attendance on the server. The browser code is not a security boundary.

## Browser-device audit (no IP)
- The device key is an optional random browser-scoped identifier, not a hardware serial number or reliable proof of physical identity. It can change if browser storage is cleared or a different browser/device is used.
- IP addresses are not collected, displayed, exported, or used by the app. If an older migration created `attendance_device_events.ip_address`, run `database/remove-ip-tracking.sql` after taking a backup to remove historical values.
- The Edge Function verifies that the signed-in student has an attendance record before writing the device event. If the check-in RPC does not return a session ID, the function attempts to use the latest attendance record for that student.

## Smart attendance analysis
- The CSV analyzer is rule-based and explainable; it is not a trained machine-learning model.
- It flags duplicates, missing fields, invalid times/coordinates, poor GPS accuracy, and distances exceeding the configured radius when the needed columns exist.
- The provided export includes stored distance, session radius, session coordinates, name, university ID, course, and timestamps. The current schema shown by the supplied code does not expose student GPS coordinates or GPS accuracy in `attendance_records`; those checks will only run if the CSV contains those fields.
- Flags mean "needs review", not proof of misconduct. GPS accuracy and shared network/device environments can produce false positives.

## GPS verification status
The QR attendance flow no longer requests student GPS by default. Doctors can create a QR session without location coordinates. Apply `database/optional-gps-qr-migration.sql` in Supabase SQL Editor to update the two live RPCs: the rotating QR token, active-session/time checks, student role check, and unique `(session_id, student_id)` duplicate prevention remain enforced server-side. When coordinates are available they may be stored/calculated for reporting, but distance/radius does not reject QR attendance. The migration makes the session and attendance coordinate columns nullable; back up first and test in staging.

The six-digit manual fallback code is a separate RPC (`check_in_with_manual_code`) and has not been changed by this QR migration. Its current client flow still requests GPS; share that function definition separately if you want the manual fallback to follow the same optional-GPS policy.

## Safety and limitations
- The browser uses the publishable key only. Do not put a Supabase service-role key in any HTML/JS file.
- The Edge Function checks the caller's JWT and the `ADMIN` role on the server before creating a confirmed doctor account with the password supplied by the admin.
- The admin dashboard intentionally does not offer destructive profile deletion or arbitrary role changes from the browser.
- Do not assume the project is fully configured just because files load. Verify RLS, invitation email delivery, function deployment, and the actual live schema before production use.
- Open the app over HTTPS or localhost for camera/GPS access.
