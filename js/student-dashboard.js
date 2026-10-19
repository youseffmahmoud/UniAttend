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
            if (!sections[sectionName]) {
                return;
            }

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

        // تحميل بيانات الطالب والتحقق من الصلاحيات
        async function loadStudent() {
            try {
                showDashboardMessage("جاري تحميل بيانات الطالب...");

                // 1. التحقق من جلسة المستخدم
                const {
                    data: authData,
                    error: authError
                } = await client.auth.getUser();

                if (authError) {
                    throw authError;
                }

                if (!authData.user) {
                    window.location.replace("index.html");
                    return;
                }

                const user = authData.user;

                // 2. قراءة بيانات الملف الشخصي
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

                // 3. توحيد الدور قبل التحقق منه
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

                // 4. عرض بيانات الطالب
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

                // 5. نجاح التحميل
                showDashboardMessage("");

                console.log("STUDENT DASHBOARD LOADED:", {
                    userId: user.id,
                    role: role,
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

        // QR scanner + secure attendance check-in
        let qrScanner = null;
        let scanBusy = false;

        const scanButton = document.getElementById("scanQrButton");
        const qrReaderElement = document.getElementById("qrReader");
        const qrPlaceholderElement = document.getElementById("qrPlaceholder");

        function showScanMessage(text, isError = false) {
            const el = document.getElementById("scanMessage");
            el.textContent = text;
            el.className = isError ? "ua-message ua-error" : "ua-message";
        }

        function extractQrToken(decodedText) {
            const raw = String(decodedText || "").trim();
            if (!raw) return "";

            // QR may contain a URL with a token parameter.
            try {
                const url = new URL(raw);
                const token = url.searchParams.get("qr_token")
                    || url.searchParams.get("token")
                    || url.searchParams.get("token_value");
                if (token) return token.trim();
            } catch (_) {
                // The QR may contain a raw token rather than a URL.
            }

            // QR may contain JSON, e.g. { "qr_token": "..." }.
            try {
                const obj = JSON.parse(raw);
                if (obj && typeof obj === "object") {
                    const token = obj.qr_token || obj.token || obj.token_value;
                    if (token) return String(token).trim();
                }
            } catch (_) {
                // Not JSON; use the decoded text below.
            }

            // Support QR payloads that contain only the token.
            return raw;
        }

        async function stopQrScanner() {
            if (!qrScanner) return;
            const scannerToStop = qrScanner;
            qrScanner = null;
            try {
                if (scannerToStop.isScanning) await scannerToStop.stop();
            } catch (error) {
                console.warn("QR scanner stop warning:", error);
            }
            try {
                scannerToStop.clear();
            } catch (error) {
                console.warn("QR scanner clear warning:", error);
            }
        }

        function resetScannerUi() {
            qrReaderElement.style.display = "none";
            qrPlaceholderElement.style.display = "grid";
            scanButton.disabled = false;
            scanButton.textContent = "مسح رمز QR";
        }

        function getStudentLocation() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error("المتصفح لا يدعم تحديد الموقع الجغرافي."));
                    return;
                }

                navigator.geolocation.getCurrentPosition(
                    position => resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    }),
                    error => {
                        const messages = {
                            1: "اسمح للموقع باستخدام موقعك الجغرافي ثم حاول مرة أخرى.",
                            2: "تعذر تحديد موقعك. تأكد من تشغيل خدمة الموقع.",
                            3: "انتهت مهلة تحديد الموقع. حاول مرة أخرى."
                        };
                        reject(new Error(messages[error.code] || "تعذر تحديد موقعك."));
                    },
                    { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
                );
            });
        }

        async function handleScannedQr(decodedText) {
            if (scanBusy) return;
            scanBusy = true;
            scanButton.disabled = true;
            showScanMessage("تمت قراءة رمز QR. جارٍ التحقق من موقعك وتسجيل الحضور...");

            try {
                const token = extractQrToken(decodedText);
                if (!token) throw new Error("رمز QR فارغ أو غير صالح.");

                await stopQrScanner();
                resetScannerUi();
                scanButton.disabled = true;
                scanButton.textContent = "جارٍ تسجيل الحضور...";

                const studentLocation = await getStudentLocation();

                // Location/radius validation must be performed securely by this Supabase RPC.
                const { data, error } = await client.rpc("check_in_with_qr", {
                    p_qr_token: token,
                    p_latitude: studentLocation.latitude,
                    p_longitude: studentLocation.longitude
                });
                if (error) throw error;

                const result = Array.isArray(data) ? data[0] : data;
                if (!result) throw new Error("لم يرجع النظام نتيجة لتسجيل الحضور.");
                if (result.success === false || result.ok === false) {
                    throw new Error(result.message || result.error || "لم يتم قبول تسجيل الحضور.");
                }

                showScanMessage(
                    "تم تسجيل حضورك بنجاح" +
                    (result.course_name ? " في محاضرة: " + result.course_name : "") +
                    (result.checked_in_at
                        ? " — الوقت: " + new Date(result.checked_in_at).toLocaleTimeString("ar-EG")
                        : "")
                );

                await loadAttendanceHistory();
            } catch (error) {
                console.error("QR check-in failed:", error);
                showScanMessage(
                    "لم يتم تسجيل الحضور: " + (error?.message || "خطأ غير معروف"),
                    true
                );
                await stopQrScanner();
                resetScannerUi();
            } finally {
                scanBusy = false;
                scanButton.disabled = false;
                scanButton.textContent = "مسح رمز QR";
            }
        }

        scanButton.addEventListener("click", async () => {
            if (scanBusy) return;

            // If a scanner is active, the same button stops it.
            if (qrScanner) {
                await stopQrScanner();
                resetScannerUi();
                showScanMessage("تم إيقاف الكاميرا.");
                return;
            }

            if (!window.Html5Qrcode) {
                showScanMessage(
                    "تعذر تحميل مكتبة قراءة QR. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.",
                    true
                );
                return;
            }

            if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
                showScanMessage("الكاميرا تحتاج إلى HTTPS أو localhost. افتح الصفحة من رابط آمن.", true);
                return;
            }

            try {
                qrReaderElement.style.display = "block";
                qrPlaceholderElement.style.display = "none";
                scanButton.disabled = true;
                scanButton.textContent = "جارٍ تشغيل الكاميرا...";
                showScanMessage("جارٍ تشغيل الكاميرا...");

                qrScanner = new Html5Qrcode("qrReader", {
                    verbose: false,
                    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
                });

                const scanConfig = {
                    fps: 15,
                    qrbox: (viewfinderWidth, viewfinderHeight) => {
                        const size = Math.max(
                            180,
                            Math.min(320, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.70))
                        );
                        return { width: size, height: size };
                    },
                    aspectRatio: 1.0,
                    disableFlip: false
                };

                // Prefer the rear camera on phones. If the browser does not support
                // facingMode, fall back to the first camera returned by the library.
                try {
                    await qrScanner.start(
                        { facingMode: "environment" },
                        scanConfig,
                        handleScannedQr,
                        () => {}
                    );
                } catch (firstCameraError) {
                    console.warn("Rear-camera start failed; trying an available camera:", firstCameraError);
                    const cameras = await Html5Qrcode.getCameras();
                    if (!cameras || cameras.length === 0) throw firstCameraError;
                    const preferredCamera = cameras.find(camera => /back|rear|environment|خلف/i.test(camera.label || "")) || cameras[0];
                    await qrScanner.start(
                        preferredCamera.id,
                        scanConfig,
                        handleScannedQr,
                        () => {}
                    );
                }

                scanButton.disabled = false;
                scanButton.textContent = "إيقاف الكاميرا";
                showScanMessage("وجّه الكاميرا إلى رمز QR الذي يعرضه الدكتور، وقرّب الرمز إذا كان صغيرًا.");
            } catch (error) {
                console.error("Camera start failed:", error);
                await stopQrScanner();
                resetScannerUi();
                showScanMessage(
                    "تعذر تشغيل الكاميرا: " + (error?.message || error) +
                    " — تأكد من السماح بالكاميرا واستخدام HTTPS أو localhost.",
                    true
                );
            }
        });

        async function loadAttendanceHistory() {
            const section = document.getElementById("historySection");
            try {
                const { data: authData, error: authError } = await client.auth.getUser();
                if (authError) throw authError;
                if (!authData.user) return;
                const { data, error } = await client
                    .from("attendance_records")
                    .select("id, checked_in_at, distance_m, courses(name, code)")
                    .eq("student_id", authData.user.id)
                    .order("checked_in_at", { ascending: false });
                if (error) throw error;

                const card = section.querySelector("article");
                card.innerHTML = '<h2>سجل الحضور</h2>';
                if (!data || data.length === 0) {
                    card.innerHTML += '<div class="ua-notice">لا توجد سجلات حضور حتى الآن.</div>';
                    return;
                }
                const table = document.createElement("div");
                table.style.overflowX = "auto";
                table.innerHTML = '<table style="width:100%;border-collapse:collapse;text-align:right"><thead><tr><th style="padding:10px;border-bottom:1px solid #e4eaf3">المحاضرة</th><th style="padding:10px;border-bottom:1px solid #e4eaf3">وقت الحضور</th><th style="padding:10px;border-bottom:1px solid #e4eaf3">المسافة (م)</th></tr></thead><tbody></tbody></table>';
                const tbody = table.querySelector("tbody");
                data.forEach(row => {
                    const tr = document.createElement("tr");
                    const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
                    [course?.name || course?.code || "محاضرة", row.checked_in_at ? new Date(row.checked_in_at).toLocaleString("ar-EG") : "—",
                     row.distance_m == null ? "—" : Math.round(Number(row.distance_m))].forEach(value => {
                        const td = document.createElement("td");
                        td.style.padding = "10px";
                        td.style.borderBottom = "1px solid #e4eaf3";
                        td.textContent = String(value);
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
                card.appendChild(table);
            } catch (error) {
                console.error("Attendance history load failed:", error);
                const card = section.querySelector("article");
                card.innerHTML = '<h2>سجل الحضور</h2><p class="ua-error">تعذر تحميل سجل الحضور: ' +
                    String(error?.message || "خطأ غير معروف").replace(/[<>&"]/g, "") + '</p>';
            }
        }

        document.querySelectorAll('[data-section="history"]').forEach(button => {
            button.addEventListener("click", loadAttendanceHistory);
        });

        // تسجيل الخروج
        document.getElementById("logoutButton").addEventListener(
            "click",
            async function () {
                const button = this;
                button.disabled = true;

                try {
                    const { error } = await client.auth.signOut();

                    if (error) {
                        throw error;
                    }

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

        // تشغيل الصفحة
        openSection("overview");
        loadStudent();
