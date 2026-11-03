'use strict';
const form = document.getElementById('passwordForm');
const message = document.getElementById('passwordMessage');
const button = document.getElementById('savePasswordButton');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
function show(text, type='') { message.textContent = text; message.className = 'message' + (type ? ' ' + type : ''); }
form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (password.length < 8) return show('كلمة المرور يجب أن تكون 8 أحرف على الأقل.', 'error');
  if (password !== confirm) return show('كلمتا المرور غير متطابقتين.', 'error');
  button.disabled = true;
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw new Error('رابط الدعوة غير صالح أو انتهت صلاحيته. اطلب من الأدمن إرسال دعوة جديدة.');
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    show('تم تعيين كلمة المرور. سيتم تحويلك إلى صفحة الدخول.', 'success');
    setTimeout(() => location.replace('index.html'), 1200);
  } catch (error) {
    show(error.message || 'تعذر حفظ كلمة المرور.', 'error');
  } finally { button.disabled = false; }
});