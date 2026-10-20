
const message = document.getElementById("message");
const registerMessage = document.getElementById("registerMessage");

const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");

const registerLink = document.getElementById("registerLink");
const registerText = document.getElementById("registerText");
const registerForm = document.getElementById("registerForm");
const registerButton = document.getElementById("registerButton");
const backToLogin = document.getElementById("backToLogin");

const loginRole = document.getElementById("loginRole");
const divider = document.querySelector(".divider");

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

// أسماء صفحات المشروع
const STUDENT_DASHBOARD = "student-dashboard.html";
const DOCTOR_DASHBOARD = "doctor-dashboard.html";

// عرض الرسائل
function showMessage(text, type = "", target = message) {
    if (!target) return;

    target.textContent = text;
    target.className = type ? `message ${type}` : "message";
}

// مسح رسائل الخطأ والنجاح
function clearMessages() {
    showMessage("");
    showMessage("", "", registerMessage);
}

// إظهار نموذج تسجيل الدخول
function showLoginForm() {
    if (registerForm) {
        registerForm.hidden = true;
    }

    if (loginForm) {
        loginForm.style.display = "";
    }

    if (divider) {
        divider.style.display = "";
    }

    if (registerText) {
        registerText.style.display =
            loginRole?.value === "doctor" ? "none" : "";
    }

    clearMessages();
}

// إظهار نموذج إنشاء حساب طالب
function showRegisterForm(event) {
    if (event) {
        event.preventDefault();
    }

    if (!loginRole || loginRole.value !== "student") {
        showMessage(
            "إنشاء الحساب متاح للطلاب فقط. حساب الدكتور ينشئه مسؤول النظام.",
            "error"
        );
        return;
    }

    if (loginForm) {
        loginForm.style.display = "none";
    }

    if (divider) {
        divider.style.display = "none";
    }

    if (registerText) {
        registerText.style.display = "none";
    }

    if (registerForm) {
        registerForm.hidden = false;
    }

    clearMessages();
}

// أحداث التنقل بين النماذج
registerLink?.addEventListener("click", showRegisterForm);
backToLogin?.addEventListener("click", showLoginForm);

// عند تغيير نوع الحساب
loginRole?.addEventListener("change", () => {
    clearMessages();

    const isStudent = loginRole.value === "student";

    if (registerText) {
        registerText.style.display = isStudent ? "" : "none";
    }

    if (!isStudent && registerForm && !registerForm.hidden) {
        showLoginForm();

        if (registerText) {
            registerText.style.display = "none";
        }
    }
});

// جلب دور المستخدم من جدول profiles
async function getUserRole(userId) {
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        console.error("ROLE LOOKUP FAILED:", error);

        throw new Error(
            "تعذر التحقق من دور الحساب في قاعدة البيانات."
        );
    }

    if (!data || !data.role) {
        throw new Error(
            "لم يتم العثور على دور صالح لهذا الحساب."
        );
    }

    const normalizedRole = String(data.role)
        .trim()
        .toLowerCase();

    if (!["student", "doctor"].includes(normalizedRole)) {
        throw new Error(
            "دور الحساب غير صالح: " + data.role
        );
    }

    return normalizedRole;
}

// تسجيل الدخول
loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessages();

    const email = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value;
    const selectedRole = loginRole?.value;

    if (!email || !password) {
        showMessage(
            "من فضلك أدخل البريد الإلكتروني وكلمة المرور.",
            "error"
        );
        return;
    }

    if (!["student", "doctor"].includes(selectedRole)) {
        showMessage("من فضلك اختر نوع الحساب.", "error");
        return;
    }

    loginButton.disabled = true;
    loginButton.setAttribute("aria-busy", "true");

    showMessage("جاري التحقق من بيانات الدخول...");

    try {
        const { data, error } =
            await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

        if (error) {
            console.error("AUTH SIGN-IN FAILED:", {
                message: error.message,
                status: error.status,
                code: error.code
            });

            throw error;
        }

        if (!data.user) {
            throw new Error(
                "تمت الاستجابة من خدمة الدخول دون بيانات المستخدم."
            );
        }

        const actualRole = await getUserRole(data.user.id);

        if (actualRole !== selectedRole) {
            await supabaseClient.auth.signOut();

            throw new Error(
                selectedRole === "doctor"
                    ? "هذا الحساب ليس حساب دكتور."
                    : "هذا الحساب ليس حساب طالب."
            );
        }

        showMessage("تم تسجيل الدخول بنجاح.");

        if (actualRole === "student") {
            window.location.href = STUDENT_DASHBOARD;
        } else {
            window.location.href = DOCTOR_DASHBOARD;
        }

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        const errorMessage = error?.message || "";
        let errorText =
            "حدث خطأ غير متوقع أثناء تسجيل الدخول.";

        if (errorMessage === "Invalid login credentials") {
            errorText =
                "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
        } else if (
            errorMessage.toLowerCase().includes("email not confirmed")
        ) {
            errorText =
                "من فضلك أكّد بريدك الإلكتروني أولًا.";
        } else if (
            errorMessage.includes("profiles") ||
            errorMessage.includes("دور الحساب") ||
            errorMessage.includes("حساب طالب") ||
            errorMessage.includes("حساب دكتور") ||
            errorMessage.includes("تعذر التحقق")
        ) {
            errorText = errorMessage;
        } else if (errorMessage) {
            errorText = errorMessage;
        }

        showMessage(errorText, "error");

    } finally {
        loginButton.disabled = false;
        loginButton.removeAttribute("aria-busy");
    }
});

// أدوات التحقق من بيانات التسجيل
function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function isValidFullName(value) {
    const name = String(value || "").trim();

    return (
        /^(?=.*[\p{L}])[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(name) &&
        name.replace(/[^\p{L}\p{M}]/gu, "").length >= 2
    );
}

function isValidUniversityId(value) {
    // أرقام إنجليزية فقط مع الاحتفاظ بالأصفار في البداية.
    return /^[0-9]{1,20}$/.test(String(value || "").trim());
}

function setFieldError(field, text) {
    if (!field) return;

    field.setCustomValidity(text || "");
    field.setAttribute("aria-invalid", text ? "true" : "false");
}

const fullNameInput = document.getElementById("fullName");
const universityIdInput = document.getElementById("universityId");
const registerEmailInput = document.getElementById("registerEmail");
const registerPasswordInput = document.getElementById("registerPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

// الرقم الجامعي: أرقام إنجليزية فقط
universityIdInput?.addEventListener("input", () => {
    universityIdInput.value =
        universityIdInput.value.replace(/[^0-9]/g, "");

    setFieldError(
        universityIdInput,
        universityIdInput.value &&
        !isValidUniversityId(universityIdInput.value)
            ? "الرقم الجامعي يجب أن يتكون من أرقام إنجليزية فقط."
            : ""
    );
});

// الاسم الكامل
fullNameInput?.addEventListener("input", () => {
    setFieldError(
        fullNameInput,
        fullNameInput.value.trim() &&
        !isValidFullName(fullNameInput.value.trim())
            ? "اكتب اسمك بالحروف، مع إمكانية استخدام المسافات والشرطة."
            : ""
    );
});

// البريد الإلكتروني
registerEmailInput?.addEventListener("input", () => {
    registerEmailInput.value =
        registerEmailInput.value.replace(/\s/g, "");

    setFieldError(
        registerEmailInput,
        registerEmailInput.value &&
        !isValidEmail(normalizeEmail(registerEmailInput.value))
            ? "أدخل بريدًا إلكترونيًا صحيحًا مثل name@example.com."
            : ""
    );
});

// كلمة المرور
registerPasswordInput?.addEventListener("input", () => {
    setFieldError(
        registerPasswordInput,
        registerPasswordInput.value &&
        registerPasswordInput.value.length < 8
            ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل."
            : ""
    );

    if (confirmPasswordInput?.value) {
        setFieldError(
            confirmPasswordInput,
            confirmPasswordInput.value !== registerPasswordInput.value
                ? "تأكيد كلمة المرور غير مطابق."
                : ""
        );
    }
});

// تأكيد كلمة المرور
confirmPasswordInput?.addEventListener("input", () => {
    setFieldError(
        confirmPasswordInput,
        confirmPasswordInput.value !== registerPasswordInput?.value
            ? "تأكيد كلمة المرور غير مطابق."
            : ""
    );
});

// إنشاء حساب طالب جديد
registerButton?.addEventListener("click", async () => {
    clearMessages();

    if (loginRole?.value !== "student") {
        showMessage(
            "إنشاء الحساب متاح للطلاب فقط.",
            "error",
            registerMessage
        );
        return;
    }

    const fullName = fullNameInput?.value.trim() || "";
    const universityId = universityIdInput?.value.trim() || "";
    const email = normalizeEmail(registerEmailInput?.value);
    const password = registerPasswordInput?.value || "";
    const confirmPassword = confirmPasswordInput?.value || "";

    [
        fullNameInput,
        universityIdInput,
        registerEmailInput,
        registerPasswordInput,
        confirmPasswordInput
    ].forEach((field) => {
        if (field) setFieldError(field, "");
    });

    if (
        !fullName ||
        !universityId ||
        !email ||
        !password ||
        !confirmPassword
    ) {
        showMessage(
            "من فضلك املأ جميع البيانات المطلوبة.",
            "error",
            registerMessage
        );
        return;
    }

    if (!isValidFullName(fullName)) {
        setFieldError(
            fullNameInput,
            "اكتب اسمك بالحروف، ولا تترك الاسم فارغًا أو أرقامًا فقط."
        );

        showMessage(
            "يرجى تصحيح الاسم الكامل.",
            "error",
            registerMessage
        );

        fullNameInput?.focus();
        return;
    }

    if (!isValidUniversityId(universityId)) {
        setFieldError(
            universityIdInput,
            "الرقم الجامعي يجب أن يحتوي على أرقام إنجليزية فقط."
        );

        showMessage(
            "الرقم الجامعي غير صحيح.",
            "error",
            registerMessage
        );

        universityIdInput?.focus();
        return;
    }

    if (!isValidEmail(email)) {
        setFieldError(
            registerEmailInput,
            "أدخل بريدًا إلكترونيًا صحيحًا مثل name@example.com."
        );

        showMessage(
            "صيغة البريد الإلكتروني غير صحيحة.",
            "error",
            registerMessage
        );

        registerEmailInput?.focus();
        return;
    }

    if (password.length < 8) {
        setFieldError(
            registerPasswordInput,
            "كلمة المرور يجب أن تكون 8 أحرف على الأقل."
        );

        showMessage(
            "كلمة المرور قصيرة جدًا؛ استخدم 8 أحرف على الأقل.",
            "error",
            registerMessage
        );

        registerPasswordInput?.focus();
        return;
    }

    if (password !== confirmPassword) {
        setFieldError(
            confirmPasswordInput,
            "تأكيد كلمة المرور غير مطابق."
        );

        showMessage(
            "كلمتا المرور غير متطابقتين.",
            "error",
            registerMessage
        );

        confirmPasswordInput?.focus();
        return;
    }

    registerButton.disabled = true;
    registerButton.setAttribute("aria-busy", "true");

    showMessage(
        "جاري إنشاء الحساب...",
        "",
        registerMessage
    );

    try {
        const { data, error } =
            await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo:
                        window.location.origin + "/index.html",

                    data: {
                        full_name: fullName,
                        university_id: universityId
                    }
                }
            });

        if (error) {
            console.error("SIGNUP FAILED:", {
                message: error.message,
                status: error.status,
                code: error.code
            });

            throw error;
        }

        if (data.session) {
            showMessage(
                "تم إنشاء الحساب بنجاح. تحقق من ظهور بيانات الطالب في جدول profiles قبل تسجيل الدخول.",
                "",
                registerMessage
            );
        } else {
            showMessage(
                "تم إرسال طلب إنشاء الحساب. إذا كان تأكيد البريد مطلوبًا، راجع بريدك الإلكتروني.",
                "",
                registerMessage
            );
        }

        console.log("SIGNUP SUCCESS:", {
            userId: data.user?.id,
            email: data.user?.email
        });

    } catch (error) {
        console.error("SIGNUP ERROR:", error);

        const rawMessage = error?.message || "";
        let friendlyMessage =
            rawMessage || "حدث خطأ غير متوقع.";

        if (/rate limit|too many requests/i.test(rawMessage)) {
            friendlyMessage =
                "تم تجاوز حد طلبات التسجيل أو رسائل البريد. انتظر قليلًا ثم حاول مرة واحدة.";
        } else if (
            /already registered|user already exists/i.test(rawMessage)
        ) {
            friendlyMessage =
                "هذا البريد مسجل بالفعل. جرّب تسجيل الدخول بدل إنشاء حساب جديد.";
        } else if (/invalid email/i.test(rawMessage)) {
            friendlyMessage = "صيغة البريد الإلكتروني غير مقبولة.";
        } else if (
            /password/i.test(rawMessage) &&
            /least|short|weak/i.test(rawMessage)
        ) {
            friendlyMessage =
                "كلمة المرور لا تستوفي شروط الأمان المطلوبة.";
        }

        showMessage(
            "تعذر إنشاء الحساب: " + friendlyMessage,
            "error",
            registerMessage
        );

    } finally {
        registerButton.disabled = false;
        registerButton.removeAttribute("aria-busy");
    }
});

// تهيئة الصفحة عند فتحها
showLoginForm();
