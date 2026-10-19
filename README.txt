UniAttend —  Project

Main pages:
- index.html: login and student registration
- student-dashboard.html: Student Dashboard
- doctor-dashboard.html: Doctor Dashboard
- dashboard.html: backward-compatible redirect to student-dashboard.html

Assets:
- css/login.css
- css/student-dashboard.css
- css/doctor-dashboard.css
- js/login.js
- js/student-dashboard.js
- js/doctor-dashboard.js
- supabase-config.js

Database:
- database/ is reserved for SQL scripts. No schema migration was added because the provided files do not include the full database schema.

Attendance export:
- Doctor Dashboard includes a CSV export action per attendance session.
- It expects attendance_records.session_id and attendance_records.student_id, checked_in_at, distance_m.
- If your actual attendance_records table uses a different session reference column, the query must be adjusted to match it.
- Supabase RLS policies still apply; the browser publishable key is not a secret, but never put a service-role key in frontend files.

Run via your existing HTTPS hosting or localhost (camera/GPS require secure context).
