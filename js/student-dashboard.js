
/* ==========================================
   UniAttend - Student Dashboard
   GPS accuracy improvement + QR attendance
   ========================================== */

// التأكد من تحميل إعدادات Supabase
if (
    !window.supabase ||
    typeof SUPABASE_URL === "undefined" ||
    typeof SUPABASE_PUBLISHABLE_KEY === "undefined"
) {
    console.error("Supabase configuration is missing.");

    document.getElementById("dashboardMessage").textContent =
        "تعذر تشغيل النظام: راجع إعدادات Supabase.";

    document.getElementById("dashboardMessage").className =
        "ua-message ua-error";

    throw new Error("Supabase configuration is missing.");
}

const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

const dashboardMessage =
    document.getElementById("dashboardMessage");

const pageTitle =
    document.getElementById("pageTitle");

const sections = {
    overview: document.getElementById("overviewSection"),
    scan: document.getElementById("scanSection"),
    history: document.getElementById("historySection")
};

const titles = {
    overview: "الرئيسية",
    scan: "تسجيل الحضور",
    history: "سجل الحضور"
};

// عرض رسائل الصفحة
function showDashboardMessage(text, isError = false) {
    dashboardMessage.textContent = text;
    dashboardMessage.className = isError
        ? "ua-message ua-error"
        : "ua-message";
}

// التنقل بين الأقسام
function openSection(sectionName) {
    if (!sections[sectionName]) return;

    Object.entries(sections).forEach(([name, section]) => {
        section.hidden = name !== sectionName;
    });

    document.querySelectorAll("[data-section]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.section === sectionName
        );
    });

    pageTitle.textContent = titles[sectionName];
}

document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => {
        openSection(button.dataset.section);
    });
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => {
        openSection(button.dataset.go);
    });
});

// ==========================================
// تحميل بيانات الطالب والتحقق من الصلاحيات
// ==========================================

async function loadStudent() {
    try {
        showDashboardMessage("جاري تحميل بيانات الطالب...");

        const {
            data: authData,
            error: authError
        } = await client.auth.getUser();

        if (authError) throw authError;

        if (!authData.user) {
            window.location.replace("index.html");
            return;
        }

        const user = authData.user;

        const {
            data: profile,
            error: profileError
        } = await client
            .from("profiles")
            .select("id, full_name, university_id, role")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) {
            console.error(
                "PROFILE LOAD FAILED:",
                profileError
            );

            throw profileError;
        }

        const role = String(profile?.role || "")
            .trim()
            .toLowerCase();

        if (!profile || role !== "student") {
            showDashboardMessage(
                "تعذر التحقق من صلاحية حساب الطالب. " +
                "تأكد من وجود سجل صحيح في profiles.",
                true
            );

            await client.auth.signOut();
            window.location.replace("index.html");
            return;
        }

        const name =
            profile.full_name ||
            user.user_metadata?.full_name ||
            "غير مسجل";

        document.getElementById("studentName").textContent =
            name;

        document.getElementById(
            "headerStudentName"
        ).textContent = name;

        document.getElementById(
            "studentUniversityId"
        ).textContent =
            profile.university_id ||
            user.user_metadata?.university_id ||
            "غير مسجل";

        document.getElementById("studentEmail").textContent =
            user.email || "غير متاح";

        showDashboardMessage("");

        console.log("STUDENT DASHBOARD LOADED:", {
            userId: user.id,
            role,
            profileLoaded: true
        });

    } catch (error) {
        console.error("Dashboard error:", error);

        showDashboardMessage(
            "تعذر تحميل بيانات الطالب: " +
            (error?.message || "خطأ غير معروف"),
            true
        );
    }
}

// ==========================================
// QR Scanner + Attendance
// ==========================================

let qrScanner = null;
let scanBusy = false;
let lastStudentLocation = null;

const scanButton = document.getElementById("scanQrButton");
const qrReaderElement = document.getElementById("qrReader");
const qrPlaceholderElement = document.getElementById("qrPlaceholder");

function showScanMessage(text, isError = false) {
    const el = document.getElementById("scanMessage");

    el.textContent = text;
    el.className = isError
        ? "ua-message ua-error"
        : "ua-message";
}

// استخراج Token من محتوى QR
function extractQrToken(decodedText) {
    const raw = String(decodedText || "").trim();

    if (!raw) return "";

    // QR قد يحتوي على رابط به token
    try {
        const url = new URL(raw);

        const token =
            url.searchParams.get("qr_token") ||
            url.searchParams.get("token") ||
            url.searchParams.get("token_value");

        if (token) return token.trim();

    } catch (_) {
        // قد يكون QR نصًا مباشرًا
    }

    // QR قد يحتوي على JSON
    try {
        const obj = JSON.parse(raw);

        if (obj && typeof obj === "object") {
            const token =
                obj.qr_token ||
                obj.token ||
                obj.token_value;

            if (token) return String(token).trim();
        }

    } catch (_) {
        // ليس JSON
    }

    return raw;
}

// إيقاف الكاميرا
async function stopQrScanner() {
    if (!qrScanner) return;

    const scannerToStop = qrScanner;
    qrScanner = null;

    try {
        if (scannerToStop.isScanning) {
            await scannerToStop.stop();
        }
    } catch (error) {
        console.warn("QR scanner stop warning:", error);
    }

    try {
        scannerToStop.clear();
    } catch (error) {
        console.warn("QR scanner clear warning:", error);
    }
}

// إعادة ضبط واجهة الماسح
function resetScannerUi() {
    qrReaderElement.style.display = "none";
    qrPlaceholderElement.style.display = "grid";

    scanButton.disabled = false;
    scanButton.textContent = "مسح رمز QR";
}

// ==========================================
// GPS: جمع عدة قراءات واختيار الأفضل
// ==========================================

function getStudentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(
                new Error(
                    "المتصفح لا يدعم تحديد الموقع الجغرافي."
                )
            );
            return;
        }

        let watchId = null;
        let bestPosition = null;
        let finished = false;

        // أقصى وقت لجمع القراءات
        const MAX_WAIT_MS = 10000;

        // لو وصلنا للدقة دي، نستخدم القراءة فورًا
        const GOOD_ACCURACY_METERS = 35;

        let timer = null;

        function cleanup() {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }

            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        }

        function finishWithBest() {
            if (finished) return;

            finished = true;
            cleanup();

            if (bestPosition) {
                resolve(bestPosition);
            } else {
                reject(
                    new Error(
                        "تعذر تحديد موقعك. تأكد من تشغيل GPS " +
                        "والسماح للموقع، ثم حاول مرة أخرى."
                    )
                );
            }
        }

        function onPosition(position) {
            if (finished) return;

            const candidate = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp
            };

            // الاحتفاظ بأفضل قراءة وصلت حتى الآن
            if (
                !bestPosition ||
                candidate.accuracy < bestPosition.accuracy
            ) {
                bestPosition = candidate;
            }

            // إذا كانت الدقة جيدة، لا داعي لانتظار بقية المهلة
            if (candidate.accuracy <= GOOD_ACCURACY_METERS) {
                finished = true;
                cleanup();
                resolve(candidate);
            }
        }

        function onError(error) {
            if (finished) return;

            const messages = {
                1: "اسمح للموقع باستخدام موقعك الجغرافي ثم حاول مرة أخرى.",
                2: "تعذر تحديد موقعك. تأكد من تشغيل خدمة الموقع.",
                3: "انتهت مهلة تحديد الموقع. حاول مرة أخرى."
            };

            // لو عندنا قراءة سابقة، استخدم أفضل قراءة
            if (bestPosition) {
                finishWithBest();
                return;
            }

            finished = true;
            cleanup();

            reject(
                new Error(
                    messages[error.code] ||
                    "تعذر تحديد موقعك."
                )
            );
        }

        timer = setTimeout(
            finishWithBest,
            MAX_WAIT_MS
        );

        try {
            watchId = navigator.geolocation.watchPosition(
                onPosition,
                onError,
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: MAX_WAIT_MS
                }
            );

        } catch (error) {
            finished = true;
            cleanup();

            reject(
                new Error(
                    "تعذر تشغيل تحديد الموقع. " +
                    "تحقق من أذونات المتصفح."
                )
            );
        }
    });
}

// ==========================================
// تسجيل الحضور بعد مسح QR
// ==========================================

async function handleScannedQr(decodedText) {
    if (scanBusy) return;

    scanBusy = true;
    scanButton.disabled = true;

    showScanMessage(
        "تمت قراءة رمز QR. جارٍ تحديث موقعك..."
    );

    try {
        const token = extractQrToken(decodedText);

        if (!token) {
            throw new Error("رمز QR فارغ أو غير صالح.");
        }

        // إيقاف الكاميرا قبل تحديث الموقع
        await stopQrScanner();
        resetScannerUi();

        scanButton.disabled = true;
        scanButton.textContent = "جارٍ تحديد الموقع...";

        // مهم: نطلب قراءة جديدة بعد مسح QR
        // ولا نعتمد على موقع قديم تم تحديده قبل فتح الكاميرا.
        showScanMessage(
            "جارٍ تحديث موقعك للتحقق من نطاق الحضور..."
        );

        const studentLocation = await getStudentLocation();

        lastStudentLocation = studentLocation;

        const accuracyMessage = document.getElementById(
            "studentLocationAccuracy"
        );

        if (accuracyMessage) {
            accuracyMessage.textContent =
                `دقة الموقع وقت التسجيل: حوالي ` +
                `${Math.round(studentLocation.accuracy)} متر.`;
        }

        if (studentLocation.accuracy > 100) {
            console.warn(
                "GPS accuracy is poor:",
                studentLocation.accuracy
            );

            showScanMessage(
                `دقة GPS الحالية حوالي ` +
                `${Math.round(studentLocation.accuracy)} متر. ` +
                "جارٍ التحقق من المسافة..."
            );
        }

        scanButton.textContent = "جارٍ تسجيل الحضور...";

        // نحافظ على اسم الدالة ومعاملاتها الحالية
        // المتوافقة مع token_value في Supabase.
        const { data, error } = await client.rpc(
            "check_in_with_qr",
            {
                p_qr_token: token,
                p_latitude: studentLocation.latitude,
                p_longitude: studentLocation.longitude
            }
        );

        if (error) throw error;

        const result = Array.isArray(data)
            ? data[0]
            : data;

        if (!result) {
            throw new Error(
                "لم يرجع النظام نتيجة لتسجيل الحضور."
            );
        }

        if (
            result.success === false ||
            result.ok === false
        ) {
            throw new Error(
                result.message ||
                result.error ||
                "لم يتم قبول تسجيل الحضور."
            );
        }

        showScanMessage(
            "تم تسجيل حضورك بنجاح" +
            (
                result.course_name
                    ? " في محاضرة: " + result.course_name
                    : ""
            ) +
            (
                result.checked_in_at
                    ? " — الوقت: " +
                      new Date(
                          result.checked_in_at
                      ).toLocaleTimeString("ar-EG")
                    : ""
            )
        );

        await loadAttendanceHistory();

    } catch (error) {
        console.error(
            "QR check-in failed:",
            error
        );

        showScanMessage(
            "لم يتم تسجيل الحضور: " +
            (error?.message || "خطأ غير معروف"),
            true
        );

        await stopQrScanner();
        resetScannerUi();

    } finally {
        scanBusy = false;
        lastStudentLocation = null;

        scanButton.disabled = false;
        scanButton.textContent = "مسح رمز QR";
    }
}

// ==========================================
// تشغيل الكاميرا ومسح QR
// ==========================================

scanButton.addEventListener("click", async () => {
    if (scanBusy) return;

    // لو الكاميرا شغالة، أوقفها
    if (qrScanner) {
        await stopQrScanner();
        resetScannerUi();

        lastStudentLocation = null;

        const locationMessage = document.getElementById(
            "studentLocationMessage"
        );

        const accuracyMessage = document.getElementById(
            "studentLocationAccuracy"
        );

        if (locationMessage) {
            locationMessage.textContent =
                "حدد موقعك من جديد قبل محاولة الحضور التالية.";
        }

        if (accuracyMessage) {
            accuracyMessage.textContent = "";
        }

        showScanMessage("تم إيقاف الكاميرا.");
        return;
    }

    if (!window.Html5Qrcode) {
        showScanMessage(
            "تعذر تحميل مكتبة قراءة QR. تحقق من اتصال الإنترنت " +
            "ثم أعد تحميل الصفحة.",
            true
        );
        return;
    }

    // الكاميرا والموقع يحتاجان HTTPS أو localhost
    if (
        !window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1"
    ) {
        showScanMessage(
            "الكاميرا وتحديد الموقع يحتاجان إلى HTTPS أو localhost.",
            true
        );
        return;
    }

    const locationMessage = document.getElementById(
        "studentLocationMessage"
    );

    const accuracyMessage = document.getElementById(
        "studentLocationAccuracy"
    );

    try {
        scanButton.disabled = true;
        scanButton.textContent = "جارٍ تحديد موقعك...";

        showScanMessage(
            "اسمح بتحديد موقعك؛ سيتم فتح الكاميرا بعد تحديده..."
        );

        if (locationMessage) {
            locationMessage.textContent =
                "جارٍ تحديد موقعك...";
        }

        if (accuracyMessage) {
            accuracyMessage.textContent = "";
        }

        lastStudentLocation = null;

        // قراءة مبدئية للتأكد من أن الموقع يعمل
        lastStudentLocation = await getStudentLocation();

        if (locationMessage) {
            locationMessage.textContent =
                "تم تحديد موقع مبدئي. سيتم تحديثه بعد قراءة QR.";
        }

        if (accuracyMessage) {
            accuracyMessage.textContent =
                `دقة الموقع المبدئية: حوالي ` +
                `${Math.round(lastStudentLocation.accuracy)} متر. ` +
                "سيتم تحديثها عند مسح الرمز.";
        }

        qrReaderElement.style.display = "block";
        qrPlaceholderElement.style.display = "none";

        scanButton.textContent = "جارٍ تشغيل الكاميرا...";

        showScanMessage(
            "تم تحديد الموقع. جارٍ تشغيل الكاميرا..."
        );

        qrScanner = new Html5Qrcode(
            "qrReader",
            {
                verbose: false,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE
                ]
            }
        );

        const scanConfig = {
            fps: 15,

            qrbox: (
                viewfinderWidth,
                viewfinderHeight
            ) => {
                const size = Math.max(
                    180,
                    Math.min(
                        320,
                        Math.floor(
                            Math.min(
                                viewfinderWidth,
                                viewfinderHeight
                            ) * 0.70
                        )
                    )
                );

                return {
                    width: size,
                    height: size
                };
            },

            aspectRatio: 1.0,
            disableFlip: false
        };

        // محاولة استخدام الكاميرا الخلفية أولًا
        try {
            await qrScanner.start(
                { facingMode: "environment" },
                scanConfig,
                handleScannedQr,
                () => {}
            );

        } catch (firstCameraError) {
            console.warn(
                "Rear-camera start failed; trying another camera:",
                firstCameraError
            );

            const cameras =
                await Html5Qrcode.getCameras();

            if (!cameras || cameras.length === 0) {
                throw firstCameraError;
            }

            const preferredCamera =
                cameras.find(camera =>
                    /back|rear|environment|خلف/i.test(
                        camera.label || ""
                    )
                ) || cameras[0];

            await qrScanner.start(
                preferredCamera.id,
                scanConfig,
                handleScannedQr,
                () => {}
            );
        }

        scanButton.disabled = false;
        scanButton.textContent = "إيقاف الكاميرا";

        showScanMessage(
            "وجّه الكاميرا إلى رمز QR الذي يعرضه الدكتور، " +
            "وقرّب الرمز إذا كان صغيرًا."
        );

    } catch (error) {
        console.error(
            "Location or camera start failed:",
            error
        );

        await stopQrScanner();
        resetScannerUi();

        lastStudentLocation = null;

        if (locationMessage) {
            locationMessage.textContent =
                error?.message ||
                "تعذر تحديد الموقع أو تشغيل الكاميرا.";
        }

        showScanMessage(
            "تعذر تحديد الموقع أو تشغيل الكاميرا: " +
            (error?.message || "خطأ غير معروف") +
            " — تأكد من السماح بالموقع والكاميرا واستخدام HTTPS.",
            true
        );
    }
});

// ==========================================
// سجل حضور الطالب
// ==========================================

async function loadAttendanceHistory() {
    const section = document.getElementById(
        "historySection"
    );

    try {
        const {
            data: authData,
            error: authError
        } = await client.auth.getUser();

        if (authError) throw authError;
        if (!authData.user) return;

        const { data, error } = await client
            .from("attendance_records")
            .select(
                "id, checked_in_at, distance_m, courses(name, code)"
            )
            .eq("student_id", authData.user.id)
            .order(
                "checked_in_at",
                { ascending: false }
            );

        if (error) throw error;

        const card = section.querySelector("article");

        card.innerHTML = "<h2>سجل الحضور</h2>";

        if (!data || data.length === 0) {
            card.innerHTML +=
                '<div class="ua-notice">' +
                "لا توجد سجلات حضور حتى الآن." +
                "</div>";

            return;
        }

        const table = document.createElement("div");
        table.style.overflowX = "auto";

        table.innerHTML =
            '<table style="width:100%;border-collapse:collapse;text-align:right">' +
                "<thead><tr>" +
                    '<th style="padding:10px;border-bottom:1px solid #e4eaf3">' +
                    "المحاضرة</th>" +
                    '<th style="padding:10px;border-bottom:1px solid #e4eaf3">' +
                    "وقت الحضور</th>" +
                    '<th style="padding:10px;border-bottom:1px solid #e4eaf3">' +
                    "المسافة (م)</th>" +
                "</tr></thead>" +
                "<tbody></tbody>" +
            "</table>";

        const tbody = table.querySelector("tbody");

        data.forEach(row => {
            const tr = document.createElement("tr");

            const course = Array.isArray(row.courses)
                ? row.courses[0]
                : row.courses;

            const values = [
                course?.name ||
                course?.code ||
                "محاضرة",

                row.checked_in_at
                    ? new Date(
                          row.checked_in_at
                      ).toLocaleString("ar-EG")
                    : "—",

                row.distance_m == null
                    ? "—"
                    : Math.round(
                          Number(row.distance_m)
                      )
            ];

            values.forEach(value => {
                const td = document.createElement("td");

                td.style.padding = "10px";
                td.style.borderBottom =
                    "1px solid #e4eaf3";

                td.textContent = String(value);
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

        card.appendChild(table);

    } catch (error) {
        console.error(
            "Attendance history load failed:",
            error
        );

        const card = section.querySelector("article");

        card.innerHTML =
            '<h2>سجل الحضور</h2>' +
            '<p class="ua-error">تعذر تحميل سجل الحضور: ' +
            String(
                error?.message || "خطأ غير معروف"
            ).replace(/[<>&"]/g, "") +
            "</p>";
    }
}

document.querySelectorAll(
    '[data-section="history"]'
).forEach(button => {
    button.addEventListener(
        "click",
        loadAttendanceHistory
    );
});

// ==========================================
// تسجيل الخروج
// ==========================================

document.getElementById("logoutButton").addEventListener(
    "click",
    async function () {
        const button = this;
        button.disabled = true;

        try {
            const { error } = await client.auth.signOut();

            if (error) throw error;

            window.location.replace("index.html");

        } catch (error) {
            console.error("Logout error:", error);

            showDashboardMessage(
                "تعذر تسجيل الخروج. حاول مرة أخرى.",
                true
            );

            button.disabled = false;
        }
    }
);

// ==========================================
// تشغيل الصفحة
// ==========================================

openSection("overview");
loadStudent();
