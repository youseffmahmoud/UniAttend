
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

    // توحيد الحروف قبل التحقق من الدور
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
        // أولًا: التحقق من البريد الإلكتروني وكلمة المرور
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

        console.log("AUTH SIGN-IN SUCCESS:", {
            userId: data.user?.id,
            emailConfirmedAt: data.user?.email_confirmed_at
        });

        if (!data.user) {
            throw new Error(
                "تمت الاستجابة من خدمة الدخول دون بيانات المستخدم."
            );
        }

        // ثانيًا: التحقق من الدور مرة واحدة فقط
        const actualRole = await getUserRole(data.user.id);

        console.log("ROLE CHECK SUCCESS:", actualRole);

        // التأكد من أن نوع الحساب المختار صحيح
        if (actualRole !== selectedRole) {
            await supabaseClient.auth.signOut();

            throw new Error(
                selectedRole === "doctor"
                    ? "هذا الحساب ليس حساب دكتور."
                    : "هذا الحساب ليس حساب طالب."
            );
        }

        showMessage("تم تسجيل الدخول بنجاح.");

        // الانتقال إلى لوحة التحكم المناسبة
        if (actualRole === "student") {
            window.location.href = STUDENT_DASHBOARD;
        } else {
            window.location.href = DOCTOR_DASHBOARD;
        }

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        const errorMessage = error?.message || "";

        let errorText = "حدث خطأ غير متوقع أثناء تسجيل الدخول.";

        if (
            errorMessage === "Invalid login credentials"
        ) {
            errorText =
                "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
        } else if (
            errorMessage.toLowerCase().includes("email not confirmed")
        ) {
            errorText =
                "من فضلك أكّد بريدك الإلكتروني أولًا.";
        } else if (
            errorMessage.includes("profiles")
        ) {
            errorText = errorMessage;
        } else if (
            errorMessage.includes("دور الحساب") ||
            errorMessage.includes("حساب طالب") ||
            errorMessage.includes("حساب دكتور")
        ) {
            errorText = errorMessage;
        } else if (
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

    const fullName =
        document.getElementById("fullName")?.value.trim();

    const universityId =
        document.getElementById("universityId")?.value.trim();

    const email =
        document.getElementById("registerEmail")?.value.trim();

    const password =
        document.getElementById("registerPassword")?.value;

    if (!fullName || !universityId || !email || !password) {
        showMessage(
            "من فضلك املأ جميع البيانات المطلوبة.",
            "error",
            registerMessage
        );
        return;
    }

    if (password.length < 6) {
        showMessage(
            "كلمة المرور يجب أن تكون 6 أحرف على الأقل.",
            "error",
            registerMessage
        );
        return;
    }

    registerButton.disabled = true;

    showMessage(
        "جاري إنشاء الحساب...",
        "",
        registerMessage
    );

    try {
        const { data, error } = await supabaseClient.auth.signUp({
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
                "تم إنشاء الحساب. تأكد من وجود سجل مطابق في جدول profiles قبل تسجيل الدخول.",
                "",
                registerMessage
            );
        } else {
            showMessage(
                "تم إرسال طلب إنشاء الحساب. راجع بريدك الإلكتروني لتأكيده إذا كان التأكيد مطلوبًا.",
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

        showMessage(
            "تعذر إنشاء الحساب: " +
                (error?.message || "حدث خطأ غير متوقع."),
            "error",
            registerMessage
        );

    } finally {
        registerButton.disabled = false;
    }
});

// تهيئة الصفحة عند فتحها
showLoginForm();
