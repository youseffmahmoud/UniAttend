"use strict";
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
function downloadCsv(filename, rows) { const csv="\uFEFF"+rows.map(row=>row.map(value=>{const s=String(value??"");return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
let analyzedRows = [], flaggedRows = [];
function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase()
        .replace(/[\s\-./()]+/g, "_")
        .replace(/[^\w\u0600-\u06FF]/g, "");
}
function parseCsv(text) {
    // Small RFC-4180-style parser: supports quoted commas and escaped quotes.
    const input = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"' && field.length === 0) quoted = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field.replace(/\r$/, "")); if (row.some(v => v.trim())) rows.push(row); row = []; field = ""; }
        else field += ch;
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(v => v.trim())) rows.push(row); }
    // If semicolon-delimited, parse it again using semicolon as separator.
    if (rows.length && rows[0].length === 1 && rows[0][0].includes(";")) {
        return parseCsvWithDelimiter(input, ";");
    }
    return rows;
}
function parseCsvWithDelimiter(input, delimiter) {
    const rows = []; let row = [], field = "", quoted = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"' && field.length === 0) quoted = true;
        else if (ch === delimiter) { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field.replace(/\r$/, "")); if (row.some(v => v.trim())) rows.push(row); row = []; field = ""; }
        else field += ch;
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(v => v.trim())) rows.push(row); }
    return rows;
}
function firstValue(row, aliases) {
    for (const key of aliases) {
        const value = row[key];
        if (value !== undefined && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}
function numberValue(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(String(value).replace(/[^\d.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
}
function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function analyzeAttendanceRows(rawRows) {
    if (!rawRows || rawRows.length < 2) throw new Error("ملف CSV فارغ أو لا يحتوي على صفوف بيانات.");
    const headers = rawRows[0].map(normalizeHeader);
    const rows = rawRows.slice(1).map(values => {
        const row = {};
        headers.forEach((h, i) => { if (h) row[h] = String(values[i] ?? "").trim(); });
        return row;
    }).filter(row => Object.values(row).some(Boolean));

    const seen = new Set();
    const analyzed = rows.map((row, index) => {
        const flags = [];
        const name = firstValue(row, ["full_name", "student_name", "name", "الاسم", "اسم_الطالب"]);
        const universityId = firstValue(row, ["university_id", "student_university_id", "student_id_number", "الرقم_الجامعي"]);
        const sessionId = firstValue(row, ["session_id", "session", "lecture_id", "الجلسة"]);
        const course = firstValue(row, ["course_name", "course_code", "course", "المحاضرة", "الكورس"]);
        const distance = numberValue(firstValue(row, ["distance_m", "recorded_distance_m", "distance", "المسافة"]));
        const radius = numberValue(firstValue(row, ["radius_m", "allowed_radius_m", "radius", "نطاق_السماح"]));
        const accuracy = numberValue(firstValue(row, ["accuracy_m", "gps_accuracy_m", "location_accuracy_m", "student_accuracy_m"]));
        const studentLat = numberValue(firstValue(row, ["student_latitude", "student_lat", "latitude", "student_latitude_deg"]));
        const studentLon = numberValue(firstValue(row, ["student_longitude", "student_lon", "longitude", "student_longitude_deg"]));
        const sessionLat = numberValue(firstValue(row, ["session_latitude", "doctor_latitude", "lecture_latitude", "session_lat"]));
        const sessionLon = numberValue(firstValue(row, ["session_longitude", "doctor_longitude", "lecture_longitude", "session_lon"]));
        const checkedAt = firstValue(row, ["checked_in_at", "attendance_time", "timestamp", "وقت_الحضور"]);
        const duplicateKey = (sessionId || course || "unknown-session") + "|" + (universityId || name || "row-" + index);

        if (seen.has(duplicateKey)) flags.push("تكرار لنفس الطالب في الجلسة داخل الملف");
        seen.add(duplicateKey);

        let calculatedDistance = null;
        if ([studentLat, studentLon, sessionLat, sessionLon].every(Number.isFinite)) {
            if (Math.abs(studentLat) <= 90 && Math.abs(sessionLat) <= 90 &&
                Math.abs(studentLon) <= 180 && Math.abs(sessionLon) <= 180) {
                calculatedDistance = haversineMeters(studentLat, studentLon, sessionLat, sessionLon);
            } else {
                flags.push("إحداثيات GPS خارج النطاق المتوقع");
            }
        }
        const effectiveDistance = distance ?? calculatedDistance;
        if (effectiveDistance !== null && radius !== null && effectiveDistance > radius) {
            if (accuracy !== null && accuracy > 100) {
                flags.push("الموقع خارج النطاق المسموح لكن دقة GPS ضعيفة؛ يلزم تحقق يدوي");
            } else {
                flags.push("المسافة المسجلة أكبر من نطاق الجلسة");
            }
        }
        if (accuracy !== null && accuracy > 100) flags.push("دقة GPS منخفضة (أكبر من 100 متر)");
        if (checkedAt && Number.isNaN(new Date(checkedAt).getTime())) flags.push("وقت الحضور غير قابل للقراءة");
        if (!universityId && !name) flags.push("بيانات هوية الطالب ناقصة");
        if (!checkedAt) flags.push("وقت الحضور غير موجود");
        if (effectiveDistance === null) flags.push("لا توجد مسافة أو إحداثيات كافية لفحص الموقع");

        const needsReview = flags.length > 0;
        return {
            ...row, _index: index + 2, _name: name || "غير معروف", _universityId: universityId || "—",
            _session: course || sessionId || "غير محددة", _distance: effectiveDistance,
            _flags: flags, _needsReview: needsReview
        };
    });
    const deviceStudents = new Map();
    analyzed.forEach(row => { const device=firstValue(row,["device_id","device_key","device"]),student=row._universityId!=="—"?row._universityId:row._name;if(device){if(!deviceStudents.has(device))deviceStudents.set(device,new Set());deviceStudents.get(device).add(student);} });
    analyzed.forEach(row => { const device=firstValue(row,["device_id","device_key","device"]);if(device&&(deviceStudents.get(device)?.size||0)>1)row._flags.push("معرّف المتصفح ظهر مع أكثر من حساب؛ مؤشر للمراجعة فقط وليس إثباتًا على المخالفة");row._needsReview=row._flags.length>0; });
    return analyzed;
}
function setAnalysisMessage(text,type="info"){const el=$("analysisMessage");el.textContent=text;el.className="msg show "+type;}
function renderAnalysis(rows){analyzedRows=rows;flaggedRows=rows.filter(r=>r._needsReview);const good=rows.length-flaggedRows.length;$("analysisSummary").classList.remove("hidden");$("analysisSummary").innerHTML=[["إجمالي السجلات",rows.length],["بدون تنبيهات",good],["تحتاج مراجعة",flaggedRows.length],["فحص الموقع",rows.some(r=>r._distance!==null)?"متاح جزئيًا":"بيانات غير كافية"]].map(([label,value])=>`<div class="analysis-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");$("analysisResults").innerHTML=rows.length?rows.map(row=>{const flags=row._flags.length?row._flags.map(esc).join("<br>"):"لم تظهر مؤشرات واضحة";const distance=row._distance===null?"—":Math.round(row._distance)+" م";const device=firstValue(row,["device_id","device_key","device"]);return `<tr><td>${esc(row._name)}</td><td>${esc(row._universityId)}</td><td>${esc(row._session)}</td><td>${esc(distance)}</td><td>${esc(device||"—")}</td><td class="flag-cell">${flags}</td><td><span class="pill ${row._needsReview?"warn":"good"}">${row._needsReview?"تحتاج مراجعة":"لا توجد مؤشرات"}</span></td></tr>`;}).join(""):'<tr><td colspan="7" class="empty">لا توجد سجلات قابلة للتحليل.</td></tr>';$('downloadFlaggedButton').disabled=!flaggedRows.length;}
async function analyzeSelectedCsv(){const file=$("attendanceCsvFile").files?.[0];if(!file){setAnalysisMessage("اختار ملف CSV الأول.","warning");return;}if(file.size>10*1024*1024){setAnalysisMessage("حجم الملف أكبر من 10 ميجابايت.","error");return;}if(!/\.csv$/i.test(file.name)){setAnalysisMessage("ارفع ملف CSV فقط.","error");return;}$("analyzeAttendanceButton").disabled=true;try{const rows=analyzeAttendanceRows(parseCsv(await file.text()));renderAnalysis(rows);setAnalysisMessage("اكتمل التحليل. التنبيهات مؤشرات للمراجعة وليست دليلًا تلقائيًا على المخالفة.","success");}catch(error){console.error("Attendance analysis failed:",error);setAnalysisMessage(error.message||"تعذر تحليل الملف.","error");}finally{$("analyzeAttendanceButton").disabled=false;}}
function exportFlaggedRows(){if(!flaggedRows.length)return;const rows=[["row_number","student_name","university_id","session","distance_m","device_id","review_flags","review_status"]];flaggedRows.forEach(r=>rows.push([r._index,r._name,r._universityId,r._session,r._distance??"",firstValue(r,["device_id","device_key","device"]),r._flags.join(" | "),"Needs manual review"]));downloadCsv("UniAttend-review-needed.csv",rows);}
$("analyzeAttendanceButton").addEventListener("click",analyzeSelectedCsv);$("downloadFlaggedButton").addEventListener("click",exportFlaggedRows);
let analysisClient = null;
(async()=>{try{if(!window.supabase?.createClient||typeof SUPABASE_URL==="undefined"||typeof SUPABASE_PUBLISHABLE_KEY==="undefined")throw Error("راجع إعدادات Supabase.");const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);analysisClient=client;const {data:{user},error}=await client.auth.getUser();if(error)throw error;if(!user){location.replace("index.html");return;}const {data:profile,error:pe}=await client.from("profiles").select("role,full_name").eq("id",user.id).maybeSingle();if(pe)throw pe;if(String(profile?.role||"").toUpperCase()!=="DOCTOR"){location.replace("index.html");return;}$("doctorName").textContent=profile.full_name||user.email||"الدكتور";}catch(e){setAnalysisMessage("تعذر التحقق من حساب الدكتور: "+(e.message||"خطأ غير معروف"),"error");}})();
$("logoutButton").addEventListener("click",async()=>{try{const c=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);await c.auth.signOut();}finally{location.replace("index.html");}});
