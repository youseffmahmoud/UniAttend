-- UniAttend: make GPS advisory/optional for QR attendance.
-- BACK UP the database and test in a staging project first.
-- This migration replaces only the two existing RPCs, preserving their signatures/return types.
-- It does NOT alter existing attendance rows, RLS policies, or QR-token issuance logic.

-- Nullable coordinates are required because GPS can now be omitted by either side.
-- These columns are already referenced by the supplied live RPC definitions.
ALTER TABLE public.attendance_sessions
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL;

ALTER TABLE public.attendance_records
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL,
    ALTER COLUMN distance_m DROP NOT NULL;


CREATE OR REPLACE FUNCTION public.create_attendance_session(
    p_course_id uuid,
    p_duration_minutes integer,
    p_latitude double precision,
    p_longitude double precision,
    p_radius_m integer,
    p_qr_rotation_seconds integer,
    p_qr_validity_seconds integer
)
RETURNS TABLE(
    session_id uuid,
    qr_token text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session_id uuid;
    v_start timestamptz := now();
    v_end timestamptz;
    v_token text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول أولًا';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND upper(p.role) = 'DOCTOR'
    ) THEN
        RAISE EXCEPTION 'الحساب ليس حساب دكتور';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = p_course_id AND c.doctor_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'الكورس غير موجود أو لا يتبع حسابك';
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 1 AND 240 THEN
        RAISE EXCEPTION 'مدة الجلسة غير صحيحة';
    END IF;

    -- Both coordinates may be NULL. If one is supplied, both must be valid.
    IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
        RAISE EXCEPTION 'أدخل إحداثيي الموقع معًا أو اتركهما فارغين';
    END IF;
    IF p_latitude IS NOT NULL AND (
        p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    ) THEN
        RAISE EXCEPTION 'إحداثيات الموقع غير صحيحة';
    END IF;

    IF p_radius_m IS NULL OR p_radius_m NOT BETWEEN 10 AND 200 THEN
        RAISE EXCEPTION 'نطاق الحضور يجب أن يكون بين 10 و200 متر';
    END IF;

    IF p_qr_rotation_seconds IS NULL OR p_qr_rotation_seconds NOT BETWEEN 5 AND 120
       OR p_qr_validity_seconds IS NULL OR p_qr_validity_seconds NOT BETWEEN 5 AND 300 THEN
        RAISE EXCEPTION 'إعدادات صلاحية QR غير صحيحة';
    END IF;

    v_end := v_start + make_interval(mins => p_duration_minutes);

    INSERT INTO public.attendance_sessions (
        course_id, doctor_id, starts_at, ends_at, is_active,
        latitude, longitude, radius_m, qr_rotation_seconds, qr_validity_seconds
    ) VALUES (
        p_course_id, auth.uid(), v_start, v_end, true,
        p_latitude, p_longitude, p_radius_m, p_qr_rotation_seconds, p_qr_validity_seconds
    ) RETURNING id INTO v_session_id;

    SELECT i.qr_token INTO v_token
    FROM public.issue_attendance_qr_token(v_session_id) i;

    RETURN QUERY SELECT v_session_id, v_token, v_start, v_end;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_in_with_qr(
    p_qr_token text,
    p_latitude double precision,
    p_longitude double precision
)
RETURNS TABLE(
    attendance_id uuid,
    course_name text,
    checked_in_at timestamp with time zone,
    distance_m double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_student uuid := auth.uid();
    v_session public.attendance_sessions%ROWTYPE;
    v_course_name text;
    v_distance double precision := NULL;
    v_record_id uuid;
    v_checked_at timestamptz := pg_catalog.now();
BEGIN
    IF v_student IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول بحساب الطالب أولًا';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_student AND pg_catalog.upper(p.role) = 'STUDENT'
    ) THEN
        RAISE EXCEPTION 'يجب استخدام حساب طالب لتسجيل الحضور';
    END IF;

    IF p_qr_token IS NULL OR pg_catalog.length(pg_catalog.trim(p_qr_token)) < 20 THEN
        RAISE EXCEPTION 'رمز QR غير صالح';
    END IF;

    -- GPS is optional. Reject malformed supplied coordinates, but accept both NULL.
    IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
        RAISE EXCEPTION 'إحداثيات الموقع غير مكتملة';
    END IF;
    IF p_latitude IS NOT NULL AND (
        p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    ) THEN
        RAISE EXCEPTION 'إحداثيات موقع الطالب غير صحيحة';
    END IF;

    SELECT s.* INTO v_session
    FROM public.attendance_qr_tokens t
    JOIN public.attendance_sessions s ON s.id = t.session_id
    WHERE t.token_value = pg_catalog.trim(p_qr_token)
      AND t.expires_at > pg_catalog.now()
      AND s.is_active = true
      AND s.starts_at <= pg_catalog.now()
      AND s.ends_at > pg_catalog.now()
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'رمز QR غير صالح أو انتهت صلاحيته أو الجلسة غير فعالة';
    END IF;

    SELECT c.name INTO v_course_name
    FROM public.courses c WHERE c.id = v_session.course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الكورس المرتبط بجلسة الحضور غير موجود';
    END IF;

    -- If both sides have coordinates, calculate distance for reporting only.
    -- Deliberately do NOT reject attendance based on distance/radius.
    IF p_latitude IS NOT NULL AND v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        v_distance := 6371000.0 * 2.0 * pg_catalog.asin(
            pg_catalog.sqrt(
                LEAST(1.0, GREATEST(0.0,
                    pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_latitude - v_session.latitude) / 2.0), 2)
                    + pg_catalog.cos(pg_catalog.radians(v_session.latitude))
                    * pg_catalog.cos(pg_catalog.radians(p_latitude))
                    * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_longitude - v_session.longitude) / 2.0), 2)
                ))
            )
        );
    END IF;

    INSERT INTO public.attendance_records (
        session_id, course_id, student_id, checked_in_at,
        latitude, longitude, distance_m
    ) VALUES (
        v_session.id, v_session.course_id, v_student, v_checked_at,
        p_latitude, p_longitude, v_distance
    )
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING id INTO v_record_id;

    IF v_record_id IS NULL THEN
        RAISE EXCEPTION 'تم تسجيل حضورك في هذه الجلسة من قبل';
    END IF;

    RETURN QUERY SELECT v_record_id, v_course_name, v_checked_at, v_distance;
END;
$function$;

-- Refresh PostgREST's schema cache after applying the migration.
NOTIFY pgrst, 'reload schema';
