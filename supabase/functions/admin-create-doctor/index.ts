import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appOrigin = Deno.env.get("APP_ORIGIN") ?? "";
const allowedOrigin = (() => {
  try {
    const parsed = new URL(appOrigin);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return "";
    return parsed.origin;
  } catch {
    return "";
  }
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (!allowedOrigin) return json({ error: "Server origin configuration is invalid." }, 500);

  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    return json({ error: "Origin not allowed." }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration is incomplete." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }

  try {
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Invalid session." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerProfile, error: roleError } = await adminClient
      .from("profiles").select("role").eq("id", callerData.user.id).maybeSingle();

    if (roleError) return json({ error: "Could not verify permissions." }, 403);
    if (String(callerProfile?.role ?? "").trim().toUpperCase() !== "ADMIN") {
      return json({ error: "Administrator permission required." }, 403);
    }

    let body: {
      full_name?: string;
      email?: string;
      university_id?: string;
      password?: string;
    };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const fullName = String(body.full_name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const universityId = String(body.university_id ?? "").trim();
    const password = String(body.password ?? "");
    const validEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);

    if (!fullName || fullName.length > 120 || !validEmail || email.length > 254 ||
        !universityId || universityId.length > 40 || password.length < 8 || password.length > 72) {
      return json({ error: "Enter a valid name, email, university ID, and password (8–72 characters)." }, 400);
    }

    const { data: existingProfiles, error: duplicateError } = await adminClient
      .from("profiles").select("id").eq("university_id", universityId).limit(1);
    if (duplicateError) return json({ error: "Could not check university ID." }, 500);
    if (existingProfiles?.length) return json({ error: "This university ID is already registered." }, 409);

    // Create a confirmed account with the admin-provided password.
    // No invitation email or mandatory password-reset step is involved.
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        university_id: universityId,
        role: "DOCTOR",
      },
    });

    if (createError || !created.user) {
      return json({ error: createError?.message || "Could not create doctor account." }, 400);
    }

    const userId = created.user.id;

    // Verify the database trigger created the expected profile before returning success.
    const { data: profile, error: profileError } = await adminClient
      .from("profiles").select("role").eq("id", userId).maybeSingle();

    if (profileError || !profile ||
        String(profile.role ?? "").trim().toUpperCase() !== "DOCTOR") {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
      return json({
        error: "The database did not create this account with the DOCTOR role.",
        details: cleanupError ? "Account cleanup failed; inspect Supabase Auth and profiles." : "The Auth account was removed.",
      }, 500);
    }

    const { error: updateError } = await adminClient.from("profiles")
      .update({ full_name: fullName, university_id: universityId })
      .eq("id", userId);

    if (updateError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
      return json({
        error: "Could not save doctor profile details.",
        details: cleanupError ? "Account cleanup failed; inspect Supabase Auth and profiles." : "The Auth account was removed.",
      }, 500);
    }

    return json({ success: true, user_id: userId, message: "Doctor account created successfully." });
  } catch (error) {
    console.error("Create doctor error:", error);
    return json({ error: "An unexpected server error occurred." }, 500);
  }
});
