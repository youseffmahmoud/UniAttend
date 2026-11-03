
'use strict';

const $ = id => document.getElementById(id);
const LOGIN_PAGE = 'index.html';

let db = null;
let currentUser = null;
let adminProfile = null;

let profiles = [];
let courses = [];
let sessions = [];

// ================================
// Basic Helpers
// ================================

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function showMessage(text, type = 'info') {
  const el = $('adminMessage');
  el.textContent = text;
  el.className = 'message show ' + type;
}

function clearMessage() {
  $('adminMessage').textContent = '';
  $('adminMessage').className = 'message';
}

function formatDate(value) {
  const date = value ? new Date(value) : null;

  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('ar-EG')
    : '—';
}

function normalizeRole(value) {
  return String(value || '').trim().toUpperCase();
}

function isSessionActive(session) {
  return (
    session.is_active === true &&
    session.ends_at &&
    new Date(session.ends_at).getTime() > Date.now()
  );
}

// ================================
// Friendly Error Messages
// ================================

function friendlyError(error) {
  const message = String(
    error?.message ||
    error?.error_description ||
    error ||
    ''
  ).toLowerCase();

  // Authentication
  if (
    message.includes('invalid session') ||
    message.includes('authentication required') ||
    message.includes('jwt expired') ||
    message.includes('invalid jwt')
  ) {
    return 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.';
  }

  // Permissions
  if (
    message.includes('permission') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('row-level security') ||
    message.includes('42501')
  ) {
    return 'ليس لديك صلاحية لتنفيذ هذا الإجراء.';
  }

  // Duplicate email or university ID
  if (
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('user already registered')
  ) {
    return 'هذا البريد الإلكتروني أو الرقم التعريفي مسجل بالفعل.';
  }

  if (message.includes('university id is already registered')) {
    return 'هذا الرقم الجامعي مسجل بالفعل.';
  }

  // Invalid input
  if (
    message.includes('invalid email') ||
    message.includes('valid email')
  ) {
    return 'يرجى إدخال بريد إلكتروني صحيح.';
  }

  // Network
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('fetch failed') ||
    message.includes('network request failed')
  ) {
    return 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.';
  }

  // Function errors
  if (
    message.includes('function not found') ||
    message.includes('pgrst202') ||
    message.includes('non-2xx status code')
  ) {
    return 'تعذر تنفيذ العملية حاليًا. حاول مرة أخرى لاحقًا.';
  }

  // Generic error
  return 'حدث خطأ أثناء تنفيذ العملية. حاول مرة أخرى.';
}

// ================================
// Authentication & Admin Check
// ================================

async function requireAdmin() {

  if (
    !window.supabase?.createClient ||
    typeof SUPABASE_URL === 'undefined' ||
    typeof SUPABASE_PUBLISHABLE_KEY === 'undefined'
  ) {
    throw new Error('CONFIGURATION_ERROR');
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  const { data: authData, error: authError } =
    await db.auth.getUser();

  if (authError) throw authError;

  if (!authData.user) {
    location.replace(LOGIN_PAGE);
    return false;
  }

  currentUser = authData.user;

  const { data, error } = await db
    .from('profiles')
    .select('id,full_name,university_id,role')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data || normalizeRole(data.role) !== 'ADMIN') {

    await db.auth.signOut();

    location.replace(LOGIN_PAGE);

    return false;
  }

  adminProfile = data;

  $('adminName').textContent =
    data.full_name || currentUser.email || 'Admin';

  return true;
}

// ================================
// Load Database Data
// ================================

async function loadProfiles() {

  const { data, error } = await db
    .from('profiles')
    .select('id,full_name,university_id,role')
    .order('full_name', { ascending: true });

  if (error) throw error;

  profiles = data || [];

  renderProfiles();
  fillDoctorOptions();
}

async function loadCourses() {

  const { data, error } = await db
    .from('courses')
    .select('id,name,code,doctor_id,created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  courses = data || [];

  renderCourses();
}

async function loadSessions() {

  const { data, error } = await db
    .from('attendance_sessions')
    .select(
      'id,course_id,doctor_id,starts_at,ends_at,is_active,created_at,courses(name,code)'
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  sessions = data || [];

  renderSessions();
}

// ================================
// Statistics
// ================================

function renderStats() {

  $('statUsers').textContent = profiles.length;

  $('statDoctors').textContent =
    profiles.filter(
      p => normalizeRole(p.role) === 'DOCTOR'
    ).length;

  $('statStudents').textContent =
    profiles.filter(
      p => normalizeRole(p.role) === 'STUDENT'
    ).length;

  $('statCourses').textContent = courses.length;

  $('statSessions').textContent =
    sessions.filter(isSessionActive).length;
}

// ================================
// Render Accounts
// ================================

function renderProfiles() {

  const query = String(
    $('userSearch').value || ''
  ).trim().toLowerCase();

  const rows = profiles.filter(p => {

    return [
      p.full_name,
      p.university_id,
      p.role
    ].some(value =>
      String(value || '').toLowerCase().includes(query)
    );

  });

  $('usersTable').innerHTML = rows.length
    ? rows.map(p => {

        const role = normalizeRole(p.role);

        const roleClass = [
          'ADMIN',
          'DOCTOR',
          'STUDENT'
        ].includes(role)
          ? role.toLowerCase()
          : '';

        return `
          <tr>
            <td>${escapeHtml(p.full_name || '—')}</td>

            <td>${escapeHtml(p.university_id || '—')}</td>

            <td>
              <span class="role ${roleClass}">
                ${escapeHtml(role || 'غير محدد')}
              </span>
            </td>
          </tr>
        `;

      }).join('')

    : '<tr><td colspan="3">لا توجد نتائج مطابقة.</td></tr>';

  renderStats();
}

// ================================
// Doctor Dropdown
// ================================

function fillDoctorOptions() {

  const select = $('courseDoctor');

  const old = select.value;

  const doctors = profiles.filter(
    p => normalizeRole(p.role) === 'DOCTOR'
  );

  select.innerHTML =
    '<option value="">اختر الدكتور...</option>' +

    doctors.map(p => `
      <option value="${escapeHtml(p.id)}">
        ${escapeHtml(p.full_name || p.university_id || 'دكتور')}
      </option>
    `).join('');

  if (doctors.some(p => p.id === old)) {
    select.value = old;
  }
}

// ================================
// Render Courses
// ================================

function renderCourses() {

  $('coursesTable').innerHTML = courses.length

    ? courses.map(c => {

        const doctor = profiles.find(
          p => p.id === c.doctor_id
        );

        return `
          <tr>
            <td>${escapeHtml(c.name)}</td>

            <td>${escapeHtml(c.code)}</td>

            <td>
              ${escapeHtml(doctor?.full_name || 'غير محدد')}
            </td>

            <td>${escapeHtml(formatDate(c.created_at))}</td>
          </tr>
        `;

      }).join('')

    : '<tr><td colspan="4">لا توجد كورسات.</td></tr>';

  renderStats();
}

// ================================
// Render Attendance Sessions
// ================================

function renderSessions() {

  $('sessionsTable').innerHTML = sessions.length

    ? sessions.map(s => {

        const course = Array.isArray(s.courses)
          ? s.courses[0]
          : s.courses;

        const doctor = profiles.find(
          p => p.id === s.doctor_id
        );

        const active = isSessionActive(s);

        return `
          <tr>

            <td>
              ${escapeHtml(course?.name || 'كورس غير معروف')}
            </td>

            <td>
              ${escapeHtml(doctor?.full_name || 'غير محدد')}
            </td>

            <td>
              ${escapeHtml(formatDate(s.starts_at))}
            </td>

            <td>
              ${escapeHtml(formatDate(s.ends_at))}
            </td>

            <td>
              <span class="status ${active ? 'active' : 'ended'}">
                ${active ? 'نشطة' : 'منتهية'}
              </span>
            </td>

            <td>
              ${
                active
                  ? `<button
                       class="btn btn-danger"
                       data-end-session="${escapeHtml(s.id)}"
                       type="button">
                       إنهاء الجلسة
                     </button>`
                  : '—'
              }
            </td>

          </tr>
        `;

      }).join('')

    : '<tr><td colspan="6">لا توجد جلسات.</td></tr>';

  $('sessionsTable')
    .querySelectorAll('[data-end-session]')
    .forEach(button => {

      button.addEventListener('click', () => {
        endSession(button.dataset.endSession);
      });

    });

  renderStats();
}

// ================================
// Refresh Dashboard
// ================================

async function refreshAll() {

  clearMessage();

  const button = $('refreshAllButton');

  button.disabled = true;

  try {

    const results = await Promise.allSettled([
      loadProfiles(),
      loadCourses(),
      loadSessions()
    ]);

    const failed = results.filter(
      r => r.status === 'rejected'
    );

    // Re-render dependent information after all loads finish.
    renderCourses();
    renderSessions();
    renderStats();

    if (failed.length) {

      showMessage(
        'تعذر تحميل بعض البيانات. يرجى المحاولة مرة أخرى.',
        'warning'
      );

    } else {

      showMessage(
        'تم تحديث بيانات لوحة الأدمن بنجاح.',
        'success'
      );

    }

  } catch {

    showMessage(
      'تعذر تحديث البيانات. حاول مرة أخرى.',
      'error'
    );

  } finally {

    button.disabled = false;

  }
}

// ================================
// Add Doctor
// ================================

async function inviteDoctor(event) {
  event.preventDefault();
  clearMessage();

  const full_name = $('doctorFullName').value.trim();
  const email = $('doctorEmail').value.trim().toLowerCase();
  const university_id = $('doctorUniversityId').value.trim();
  const password = $('doctorPassword').value;

  if (!full_name || !email || !university_id || !password) {
    showMessage('يرجى إدخال جميع بيانات الدكتور.', 'warning');
    return;
  }

  if (password.length < 8) {
    showMessage('كلمة المرور يجب ألا تقل عن 8 أحرف.', 'warning');
    return;
  }

  const button = $('createDoctorButton');
  button.disabled = true;
  button.textContent = 'جارٍ إنشاء الحساب...';

  try {
    // The Edge Function verifies the ADMIN role and creates the Auth user
    // with the service-role key kept exclusively on the server.
    const { data, error } = await db.functions.invoke(
      'admin-create-doctor',
      {
        body: { full_name, email, university_id, password }
      }
    );

    if (error) throw error;
    if (!data || data.success !== true) {
      throw new Error(data?.error || 'DOCTOR_CREATION_FAILED');
    }

    $('doctorForm').reset();
    showMessage(
      'تم إنشاء حساب الدكتور بنجاح. يمكنه تسجيل الدخول باستخدام البريد الإلكتروني وكلمة المرور المحددين.',
      'success'
    );
    await loadProfiles();
  } catch (error) {
    const message = String(error?.message || error || '').toLowerCase();

    if (message.includes('university id is already registered')) {
      showMessage('هذا الرقم الجامعي مسجل بالفعل.', 'error');
    } else if (message.includes('already been registered') || message.includes('already exists')) {
      showMessage('هذا البريد الإلكتروني مسجل بالفعل.', 'error');
    } else {
      showMessage(friendlyError(error), 'error');
    }
  } finally {
    button.disabled = false;
    button.textContent = 'إنشاء حساب الدكتور';
  }
}

// ================================
// Add Course
// ================================

async function addCourse(event) {

  event.preventDefault();

  clearMessage();

  const name = $('courseName').value.trim();

  const code = $('courseCode').value.trim();

  const doctor_id = $('courseDoctor').value;

  if (!name || !code || !doctor_id) {

    showMessage(
      'أدخل اسم الكورس والكود واختر الدكتور.',
      'warning'
    );

    return;
  }

  const button = $('createCourseButton');

  button.disabled = true;

  try {

    const { data, error } = await db
      .from('courses')
      .insert({
        name,
        code,
        doctor_id
      })
      .select('id,name,code,doctor_id,created_at')
      .single();

    if (error) throw error;

    courses.unshift(data);

    $('courseForm').reset();

    renderCourses();

    fillDoctorOptions();

    showMessage(
      'تمت إضافة الكورس وربطه بالدكتور بنجاح.',
      'success'
    );

  } catch (error) {

    showMessage(
      friendlyError(error),
      'error'
    );

  } finally {

    button.disabled = false;

  }
}

// ================================
// End Attendance Session
// ================================

async function endSession(sessionId) {

  const session = sessions.find(
    s => s.id === sessionId
  );

  if (!session || !isSessionActive(session)) {
    return;
  }

  if (!confirm('هل تريد إنهاء جلسة الحضور الآن؟')) {
    return;
  }

  try {

    const { data, error } = await db
      .from('attendance_sessions')
      .update({
        is_active: false,
        ends_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('id,is_active,ends_at')
      .single();

    if (error) throw error;

    if (data?.is_active !== false) {
      throw new Error('SESSION_UPDATE_FAILED');
    }

    showMessage(
      'تم إنهاء جلسة الحضور بنجاح.',
      'success'
    );

    await loadSessions();

  } catch (error) {

    showMessage(
      friendlyError(error),
      'error'
    );

  }
}

// ================================
// Event Listeners
// ================================

$('doctorForm').addEventListener(
  'submit',
  inviteDoctor
);

$('courseForm').addEventListener(
  'submit',
  addCourse
);

$('userSearch').addEventListener(
  'input',
  renderProfiles
);

$('refreshAllButton').addEventListener(
  'click',
  refreshAll
);

$('logoutButton').addEventListener(
  'click',
  async () => {

    $('logoutButton').disabled = true;

    try {

      if (db) {
        await db.auth.signOut();
      }

    } finally {

      location.replace(LOGIN_PAGE);

    }

  }
);

// ================================
// Initialize Dashboard
// ================================

(async function initializeAdminDashboard() {

  try {

    const authorized = await requireAdmin();

    if (!authorized) return;

    await refreshAll();

  } catch {

    showMessage(
      'تعذر فتح لوحة الإدارة. يرجى تسجيل الدخول مرة أخرى.',
      'error'
    );

  }

})();
