import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Server configuration missing" }, 500);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);
  const studentId = authData.user.id;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("role").eq("id", studentId).maybeSingle();
  if (profileError || String(profile?.role ?? "").toUpperCase() !== "STUDENT") {
    return json({ error: "Student account required" }, 403);
  }
  let body: { device_key?: string; session_id?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const deviceKey = String(body.device_key ?? "").trim();
  if (!/^[a-f0-9-]{24,80}$/i.test(deviceKey)) return json({ error: "Invalid device identifier" }, 400);

  // Verify an attendance record exists for this authenticated student.
  let recordQuery = admin.from("attendance_records").select("session_id,student_id,checked_in_at")
    .eq("student_id", studentId).order("checked_in_at", { ascending: false }).limit(1);
  if (body.session_id) recordQuery = admin.from("attendance_records").select("session_id,student_id,checked_in_at")
    .eq("student_id", studentId).eq("session_id", body.session_id).limit(1);
  const { data: records, error: recordError } = await recordQuery;
  if (recordError) return json({ error: "Could not verify attendance" }, 500);
  const record = records?.[0];
  if (!record?.session_id) return json({ error: "No matching attendance record" }, 403);

  const userAgent = (req.headers.get("user-agent") || "").slice(0, 500) || null;
  const now = new Date().toISOString();
  const { data: device, error: deviceError } = await admin.from("student_devices").upsert({
    student_id: studentId, device_key: deviceKey, last_seen_at: now, user_agent: userAgent,
  }, { onConflict: "student_id,device_key" }).select("id").single();
  if (deviceError || !device) return json({ error: "Could not save device record" }, 500);

  const { error: eventError } = await admin.from("attendance_device_events").upsert({
    student_id: studentId, session_id: record.session_id, device_id: device.id,
    user_agent: userAgent, recorded_at: record.checked_in_at || now,
  }, { onConflict: "session_id,student_id" });
  if (eventError) return json({ error: "Could not save attendance device event" }, 500);
  return json({ ok: true, session_id: record.session_id, device_audit_recorded: true });
});
