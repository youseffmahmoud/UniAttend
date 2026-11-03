-- UniAttend: secure manual attendance-code fallback.
-- Run this migration once in Supabase SQL Editor AFTER reviewing it.
-- Existing QR functions/tables and attendance records are not dropped or rewritten.

create table if not exists public.attendance_manual_codes (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    session_id uuid not null unique references public.attendance_sessions(id) on delete cascade,
    code_hash text not null,
    created_by uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default pg_catalog.now(),
    expires_at timestamptz not null
);

create index if not exists attendance_manual_codes_expiry_idx
    on public.attendance_manual_codes(expires_at);

create table if not exists public.attendance_manual_code_attempts (
    id bigint generated always as identity primary key,
    student_id uuid not null references public.profiles(id) on delete cascade,
    attempted_at timestamptz not null default pg_catalog.now()
);

create index if not exists attendance_manual_code_attempts_student_time_idx
    on public.attendance_manual_code_attempts(student_id, attempted_at desc);

alter table public.attendance_manual_codes enable row level security;
alter table public.attendance_manual_code_attempts enable row level security;
revoke all on table public.attendance_manual_codes from public, anon, authenticated, service_role;
revoke all on table public.attendance_manual_code_attempts from public, anon, authenticated, service_role;

create or replace function public.create_manual_attendance_code(p_session_id uuid)
returns table(manual_code text, code_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_uid uuid := auth.uid();
    v_session public.attendance_sessions%rowtype;
    v_bytes bytea;
    v_number bigint;
    v_code text;
    v_expiry timestamptz;
    v_try integer;
    v_available boolean := false;
begin
    if v_uid is null then
        raise exception 'يجب تسجيل الدخول أولًا';
    end if;
    if not exists (
        select 1 from public.profiles p
        where p.id = v_uid and pg_catalog.upper(p.role) = 'DOCTOR'
    ) then
        raise exception 'هذه العملية متاحة لحساب الدكتور فقط';
    end if;

    select s.* into v_session
    from public.attendance_sessions s
    where s.id = p_session_id
      and s.doctor_id = v_uid
      and s.is_active = true
      and s.starts_at <= pg_catalog.now()
      and s.ends_at > pg_catalog.now();
    if not found then
        raise exception 'الجلسة غير نشطة أو لا تملك صلاحية إدارتها';
    end if;

    -- Generate a cryptographically random six-digit code and avoid collisions
    -- with any currently active manual code across sessions.
    for v_try in 1..10 loop
        v_bytes := extensions.gen_random_bytes(4);
        v_number := pg_catalog.get_byte(v_bytes, 0)::bigint * 16777216
                  + pg_catalog.get_byte(v_bytes, 1)::bigint * 65536
                  + pg_catalog.get_byte(v_bytes, 2)::bigint * 256
                  + pg_catalog.get_byte(v_bytes, 3)::bigint;
        v_code := pg_catalog.lpad(pg_catalog.mod(v_number, 1000000)::text, 6, '0');
        select not exists (
            select 1
            from public.attendance_manual_codes m
            join public.attendance_sessions s on s.id = m.session_id
            where m.expires_at > pg_catalog.now()
              and s.is_active = true
              and s.ends_at > pg_catalog.now()
              and m.code_hash = extensions.crypt(v_code, m.code_hash)
        ) into v_available;
        if v_available then exit; end if;
    end loop;
    if not v_available then
        raise exception 'تعذر إصدار كود فريد الآن؛ حاول مرة أخرى';
    end if;

    v_expiry := least(pg_catalog.now() + interval '60 seconds', v_session.ends_at);
    insert into public.attendance_manual_codes(session_id, code_hash, created_by, created_at, expires_at)
    values (v_session.id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), v_uid, pg_catalog.now(), v_expiry)
    on conflict (session_id) do update
      set code_hash = excluded.code_hash,
          created_by = excluded.created_by,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at;

    return query select v_code, v_expiry;
end;
$function$;

create or replace function public.check_in_with_manual_code(
    p_manual_code text,
    p_latitude double precision,
    p_longitude double precision
)
returns table(
    success boolean,
    attendance_id uuid,
    course_name text,
    checked_in_at timestamptz,
    distance_m double precision,
    message text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_student uuid := auth.uid();
    v_attempts bigint;
    v_session public.attendance_sessions%rowtype;
    v_course_name text;
    v_distance double precision;
    v_record_id uuid;
    v_checked_at timestamptz := pg_catalog.now();
begin
    if v_student is null then
        raise exception 'يجب تسجيل الدخول بحساب الطالب أولًا';
    end if;
    if not exists (
        select 1 from public.profiles p
        where p.id = v_student and pg_catalog.upper(p.role) = 'STUDENT'
    ) then
        raise exception 'يجب استخدام حساب طالب لتسجيل الحضور';
    end if;

    -- Serialize per-student attempts and persist failed attempts by returning a
    -- result row (raising an exception would roll back the attempt log).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_student::text));
    delete from public.attendance_manual_code_attempts a
    where a.attempted_at < pg_catalog.now() - interval '24 hours';
    insert into public.attendance_manual_code_attempts(student_id, attempted_at)
    values (v_student, pg_catalog.now());
    select pg_catalog.count(*) into v_attempts
    from public.attendance_manual_code_attempts a
    where a.student_id = v_student
      and a.attempted_at > pg_catalog.now() - interval '10 minutes';
    if v_attempts > 10 then
        return query select false, null::uuid, null::text, null::timestamptz, null::double precision,
            'محاولات كثيرة. انتظر 10 دقائق ثم حاول مرة أخرى.'::text;
        return;
    end if;

    if p_manual_code is null or p_manual_code !~ '^[0-9]{6}$' then
        return query select false, null::uuid, null::text, null::timestamptz, null::double precision,
            'كود الحضور غير صحيح أو انتهت صلاحيته.'::text;
        return;
    end if;
    if p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90
       or p_longitude not between -180 and 180 then
        return query select false, null::uuid, null::text, null::timestamptz, null::double precision,
            'تعذر تحديد موقع الطالب؛ حدّث الموقع وحاول مرة أخرى.'::text;
        return;
    end if;

    select s.* into v_session
    from public.attendance_manual_codes m
    join public.attendance_sessions s on s.id = m.session_id
    where m.expires_at > pg_catalog.now()
      and m.code_hash = extensions.crypt(pg_catalog.trim(p_manual_code), m.code_hash)
      and s.is_active = true
      and s.starts_at <= pg_catalog.now()
      and s.ends_at > pg_catalog.now()
    limit 1;
    if not found then
        return query select false, null::uuid, null::text, null::timestamptz, null::double precision,
            'كود الحضور غير صحيح أو انتهت صلاحيته أو الجلسة غير نشطة.'::text;
        return;
    end if;

    select c.name into v_course_name
    from public.courses c where c.id = v_session.course_id;
    if not found then
        return query select false, null::uuid, null::text, null::timestamptz, null::double precision,
            'الكورس المرتبط بجلسة الحضور غير موجود.'::text;
        return;
    end if;

    v_distance := 6371000.0 * 2.0 * pg_catalog.asin(
        pg_catalog.sqrt(least(1.0, greatest(0.0,
            pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_latitude - v_session.latitude) / 2.0), 2)
            + pg_catalog.cos(pg_catalog.radians(v_session.latitude))
            * pg_catalog.cos(pg_catalog.radians(p_latitude))
            * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_longitude - v_session.longitude) / 2.0), 2)
        )))
    );
    if v_distance > v_session.radius_m then
        return query select false, null::uuid, null::text, null::timestamptz, v_distance,
            ('أنت خارج نطاق الحضور المسموح. المسافة التقريبية ' || pg_catalog.round(v_distance)::text || ' متر.')::text;
        return;
    end if;

    insert into public.attendance_records(
        session_id, course_id, student_id, checked_in_at, latitude, longitude, distance_m
    ) values (
        v_session.id, v_session.course_id, v_student, v_checked_at, p_latitude, p_longitude, v_distance
    ) on conflict (session_id, student_id) do nothing
    returning id into v_record_id;

    if v_record_id is null then
        return query select false, null::uuid, null::text, null::timestamptz, v_distance,
            'تم تسجيل حضورك في هذه الجلسة من قبل.'::text;
        return;
    end if;

    return query select true, v_record_id, v_course_name, v_checked_at, v_distance,
        'تم تسجيل الحضور بنجاح.'::text;
end;
$function$;

revoke all on function public.create_manual_attendance_code(uuid) from public, anon;
revoke all on function public.check_in_with_manual_code(text, double precision, double precision) from public, anon;
grant execute on function public.create_manual_attendance_code(uuid) to authenticated;
grant execute on function public.check_in_with_manual_code(text, double precision, double precision) to authenticated;
