'use strict';
const $=id=>document.getElementById(id);const LOGIN_PAGE='index.html';const MAX_GPS_ACCURACY_METERS=250;let sb=null,user=null,profile=null,courses=[],sessions=[],locationFix=null,qrSessionId=null,qrSessionEnd=null,qrRotation=15,qrExpiry=null,refreshTimer=null,countdownTimer=null,issuing=false,generation=0,lastIssuedAt=0,qrVisible=false;
function message(id,text,type='info'){const e=$(id);e.textContent=text;e.className='msg show '+type}function clearMessage(id){$(id).textContent='';$(id).className='msg'}function connection(text,ok){$('connectionStatus').textContent=text;$('connectionStatus').className='pill '+(ok?'good':'bad')}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function dateText(v){const d=new Date(v);return v&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(d):'غير محدد'}function errText(e){const m=String(e?.message||e||'حدث خطأ غير معروف.');const code=e?.code?` (code: ${e.code})`:'';const details=e?.details?` — ${e.details}`:'';const hint=e?.hint?` — ${e.hint}`:'';if(/row-level security|permission denied|not allowed|42501/i.test(m+' '+String(e?.code||'')))return `Supabase رفض العملية بسبب صلاحيات الجدول أو RLS: ${m}${code}${details}${hint}. راجع سياسات الجدول في SQL Editor.`;if(/duplicate key|unique constraint/i.test(m))return 'كود الكورس مستخدم بالفعل.';if(/Failed to fetch|NetworkError/i.test(m))return 'تعذر الاتصال. تحقق من الإنترنت وإعدادات Supabase.';if(/PGRST202|function .* not found|Could not find the function/i.test(m+' '+String(e?.code||'')))return `دالة قاعدة البيانات المطلوبة غير موجودة أو توقيعها مختلف: ${m}${code}${details}${hint}`;return `${m}${code}${details}${hint}`}
function stopQrTimers(){if(refreshTimer)clearTimeout(refreshTimer);if(countdownTimer)clearInterval(countdownTimer);refreshTimer=null;countdownTimer=null;generation++;issuing=false}
function browserLocation(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(Error('المتصفح لا يدعم تحديد الموقع.'));if(!window.isSecureContext)return reject(Error('تحديد الموقع يحتاج HTTPS أو localhost؛ لا تفتح الصفحة مباشرة من ملف الجهاز.'));navigator.geolocation.getCurrentPosition(p=>{const c=p.coords;if(![c.latitude,c.longitude,c.accuracy].every(Number.isFinite))return reject(Error('بيانات الموقع غير صالحة.'));resolve({latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy})},e=>{if(e.code===1)return reject(Error('تم رفض إذن الموقع. اسمح للمتصفح باستخدام الموقع.'));if(e.code===2)return reject(Error('تعذر تحديد الموقع. تحقق من إعدادات GPS وحاول في مكان مفتوح.'));if(e.code===3)return reject(Error('انتهت مهلة تحديد الموقع. حاول مرة أخرى.'));reject(Error('حدث خطأ أثناء تحديد الموقع.'))},{enableHighAccuracy:true,timeout:25000,maximumAge:0})})}
function showLocation(v){locationFix=v;$('latitudeValue').textContent=v.latitude.toFixed(6);$('longitudeValue').textContent=v.longitude.toFixed(6);$('accuracyValue').textContent='± '+Math.round(v.accuracy)+' متر';$('gpsStatus').textContent=v.accuracy<=50?'دقة GPS جيدة':v.accuracy<=100?'الدقة مقبولة':'الدقة منخفضة';$('gpsStatus').className='pill '+(v.accuracy<=100?'good':'warn')}
async function detectLocation(){const b=$('getLocationButton');b.disabled=true;b.textContent='جارٍ تحديد الموقع…';try{const v=await browserLocation();showLocation(v);message('pageMessage',`تم تحديد الموقع. الدقة المقدرة ±${Math.round(v.accuracy)} متر.` ,v.accuracy<=100?'success':'warning')}catch(e){message('pageMessage',errText(e),'error')}finally{b.disabled=false;b.textContent='⌖ تحديد الموقع الحالي'}}
async function authDoctor(){if(!window.supabase?.createClient)throw Error('تعذر تحميل مكتبة Supabase.');if(typeof SUPABASE_URL==='undefined'||typeof SUPABASE_PUBLISHABLE_KEY==='undefined')throw Error('تأكد من أن supabase-config.js يعرّف SUPABASE_URL وSUPABASE_PUBLISHABLE_KEY.');sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);const {data:{session},error:se}=await sb.auth.getSession();if(se)throw se;if(!session?.user){location.replace(LOGIN_PAGE);return false}user=session.user;const {data:p,error}=await sb.from('profiles').select('id,full_name,role').eq('id',user.id).maybeSingle();if(error)throw error;if(!p||p.role!=='DOCTOR'){await sb.auth.signOut();location.replace(LOGIN_PAGE);return false}profile=p;const n=p.full_name||user.email||'Doctor';$('doctorChip').textContent=n;$('welcomeTitle').textContent=`أهلًا يا دكتور ${n} 👋`;connection('متصل بقاعدة البيانات',true);return true}
async function loadCourses(){ $('coursesList').innerHTML='<div class="empty">جارٍ تحميل الكورسات…</div>';const {data,error}=await sb.from('courses').select('id,name,code,created_at,doctor_id').eq('doctor_id',user.id).order('created_at',{ascending:false});if(error){courses=[];renderCourseOptions();$('coursesList').innerHTML=`<div class="empty">تعذر تحميل الكورسات: ${esc(errText(error))}<br>تأكد من وجود جدول courses وصلاحيات SELECT في Supabase.</div>`;throw error}courses=data||[];renderCourses();renderCourseOptions()}
function renderCourses(){if(!courses.length){$('coursesList').innerHTML='<div class="empty">لا توجد كورسات مرتبطة بحسابك. أضف كورسًا من النموذج.</div>';return}$('coursesList').innerHTML=courses.map(c=>`<div class="item"><div class="itemmain"><strong>${esc(c.name)}</strong><small>الكود: ${esc(c.code)} · أُضيف: ${esc(dateText(c.created_at))}</small></div><div class="itemactions"><span class="pill neutral">كورس</span><button class="btn light" data-course-action="edit" data-id="${esc(c.id)}" type="button">تعديل</button></div></div>`).join('')}
function renderCourseOptions(){const s=$('sessionCourse'),old=s.value;s.innerHTML='<option value="">اختر الكورس…</option>'+courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.code)})</option>`).join('');if(courses.some(c=>c.id===old))s.value=old;$('createSessionButton').disabled=!courses.length}
async function addCourse(e){e.preventDefault();const name=$('courseName').value.trim(),code=$('courseCode').value.trim();if(!name||!code)return;const b=$('addCourseButton');b.disabled=true;try{const {data,error}=await sb.from('courses').insert({name,code,doctor_id:user.id}).select('id,name,code,created_at,doctor_id').single();if(error)throw error;courses.unshift(data);renderCourses();renderCourseOptions();$('courseForm').reset();message('pageMessage','تمت إضافة الكورس بنجاح.','success')}catch(e){message('pageMessage',errText(e),'error')}finally{b.disabled=false}}
async function createSession(e){e.preventDefault();clearMessage('pageMessage');const courseId=$('sessionCourse').value;if(!courseId){message('pageMessage','اختر كورسًا أولًا.','warning');return}const duration=+$('sessionDuration').value,radius=+$('sessionRadius').value,rotation=+$('qrRotation').value,validity=+$('qrValidity').value,b=$('createSessionButton');b.disabled=true;b.textContent='جارٍ إنشاء الجلسة…';try{const {data,error}=await sb.rpc('create_attendance_session',{p_course_id:courseId,p_duration_minutes:duration,p_latitude:locationFix?.latitude??null,p_longitude:locationFix?.longitude??null,p_radius_m:radius,p_qr_rotation_seconds:rotation,p_qr_validity_seconds:validity});if(error)throw error;const r=Array.isArray(data)?data[0]:data;if(!r?.session_id||!r?.qr_token)throw Error('لم تُرجع create_attendance_session معرّف الجلسة ورمز QR المتوقعين.');const c=courses.find(x=>x.id===courseId);const s={id:r.session_id,course_id:courseId,doctor_id:user.id,starts_at:r.starts_at||new Date().toISOString(),ends_at:r.ends_at||new Date(Date.now()+duration*60000).toISOString(),is_active:true,latitude:locationFix?.latitude??null,longitude:locationFix?.longitude??null,radius_m:radius,qr_rotation_seconds:rotation,qr_validity_seconds:validity,courses:c?{name:c.name,code:c.code}:null};await loadSessions();await openQr(s,r.qr_token);message('pageMessage',locationFix?'تم إنشاء الجلسة. GPS متاح كإشارة مساعدة فقط.':'تم إنشاء الجلسة بدون GPS؛ تسجيل الحضور يعتمد على QR والتحقق من الجلسة.','success')}catch(e){message('pageMessage',errText(e),'error')}finally{b.disabled=!courses.length||!$('sessionCourse').value;b.textContent='إنشاء الجلسة وعرض QR'}}
async function loadSessions(){$('sessionsList').innerHTML='<div class="empty">جارٍ تحميل الجلسات…</div>';const {data,error}=await sb.from('attendance_sessions').select('id,course_id,doctor_id,starts_at,ends_at,is_active,is_archived,latitude,longitude,radius_m,qr_rotation_seconds,qr_validity_seconds,created_at,courses(name,code)').eq('doctor_id',user.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;sessions=data||[];renderSessions()}
function active(s){return s.is_active&&s.ends_at&&new Date(s.ends_at).getTime()>Date.now()}
function renderSessions(){const showArchived=$('showArchivedSessions')?.checked;const visible=sessions.filter(s=>showArchived?Boolean(s.is_archived):!s.is_archived);if(!visible.length){$('sessionsList').innerHTML=`<div class="empty">${showArchived?'لا توجد محاضرات مؤرشفة.':'لا توجد جلسات ظاهرة. أنشئ جلسة جديدة أو فعّل عرض المؤرشفة.'}</div>`;return}$('sessionsList').innerHTML=visible.map(s=>{const live=active(s),name=s.courses?.name||'كورس',loc=Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude))?`الموقع ${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)} · النطاق ${s.radius_m||50}م`:'إحداثيات الموقع غير متاحة';return `<div class="item ${s.is_archived?'archived-item':''}"><div class="itemmain"><strong>${esc(name)} <span class="pill ${s.is_archived?'warn':live?'good':'neutral'}">${s.is_archived?'مؤرشفة':live?'نشطة':'منتهية'}</span></strong><small>بداية: ${esc(dateText(s.starts_at))} · نهاية: ${esc(dateText(s.ends_at))}<br>${esc(loc)}</small></div><div class="itemactions"><button class="btn light" data-action="export" data-id="${esc(s.id)}">تصدير الحضور CSV</button>${live?`<button class="btn primary" data-action="qr" data-id="${esc(s.id)}">عرض QR</button><button class="btn danger" data-action="end" data-id="${esc(s.id)}">إنهاء الجلسة</button>`:''}${!live?`<button class="btn light" data-action="edit-session" data-id="${esc(s.id)}">تعديل المحاضرة</button><button class="btn ${s.is_archived?'success':'light'}" data-action="${s.is_archived?'restore':'archive'}" data-id="${esc(s.id)}">${s.is_archived?'استعادة':'أرشفة المحاضرة'}</button>`:''}</div></div>`}).join('')}
async function openQr(s,initialToken=null){if(!active(s)){message('pageMessage','الجلسة منتهية أو غير نشطة.','warning');return}stopQrTimers();qrSessionId=s.id;qrSessionEnd=s.ends_at;qrRotation=Math.max(5,Number(s.qr_rotation_seconds||15));qrExpiry=null;qrVisible=true;$('qrCard').classList.remove('hidden');$('qrCourseTitle').textContent=s.courses?.name||courses.find(c=>c.id===s.course_id)?.name||'Uni Attendance';$('qrSessionInfo').textContent=`نهاية الجلسة: ${dateText(s.ends_at)} · نطاق السماح: ${s.radius_m||50} متر`;$('qrRotationInfo').textContent=qrRotation+' ثانية';$('sessionQrCode').replaceChildren();$('manualCodeResult')?.classList.add('hidden');clearMessage('qrMessage');$('qrActiveStatus').textContent='جلسة نشطة';$('qrActiveStatus').className='pill good';countdownTimer=setInterval(updateCountdown,250);$('qrCard').scrollIntoView({behavior:'smooth',block:'start'});if(initialToken){qrExpiry=new Date(Date.now()+Number(s.qr_validity_seconds||qrRotation)*1000).toISOString();lastIssuedAt=Date.now();drawQr(initialToken);scheduleQr()}else await refreshQr(true)}
function drawQr(token){const target=$('sessionQrCode');target.replaceChildren();if(typeof QRCode==='undefined'){message('qrMessage','تعذر تحميل مكتبة QRCode من CDN. افتح الصفحة مع اتصال إنترنت أو أعد تحميلها، ثم جرّب مرة أخرى.','error');return}try{new QRCode(target,{text:token,width:240,height:240,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M})}catch(e){message('qrMessage','تعذر إنشاء QR: '+errText(e),'error')}}
async function refreshQr(show=false){if(!qrSessionId||issuing||!qrVisible)return;if(qrSessionEnd&&new Date(qrSessionEnd).getTime()<=Date.now()){stopQrTimers();$('qrActiveStatus').textContent='انتهت الجلسة';$('qrActiveStatus').className='pill bad';message('qrMessage','انتهت الجلسة؛ لن يتم إصدار رموز جديدة.','warning');await loadSessions().catch(()=>{});return}const id=qrSessionId,gen=generation;issuing=true;try{const {data,error}=await sb.rpc('issue_attendance_qr_token',{p_session_id:id});if(error)throw error;if(gen!==generation||id!==qrSessionId)return;const r=Array.isArray(data)?data[0]:data;if(!r?.qr_token||!r?.token_expires_at)throw Error('دالة issue_attendance_qr_token لم تُرجع الرمز ووقت انتهاء الصلاحية.');qrExpiry=r.token_expires_at;lastIssuedAt=Date.now();drawQr(r.qr_token);$('qrExpiryInfo').textContent='صلاحية الرمز الحالي حتى '+dateText(qrExpiry)+'. الخادم يتحقق من الصلاحية عند تسجيل الحضور.';$('qrActiveStatus').textContent='جلسة نشطة';$('qrActiveStatus').className='pill good';if(show)message('qrMessage','تم إصدار رمز QR جديد.','success')}catch(e){if(gen===generation)message('qrMessage',errText(e),'error')}finally{if(gen===generation){issuing=false;scheduleQr()}}}
function scheduleQr(){if(refreshTimer)clearTimeout(refreshTimer);if(!qrSessionId||!qrVisible)return;const wait=Math.max(1000,qrRotation*1000-(Date.now()-lastIssuedAt));refreshTimer=setTimeout(()=>refreshQr(false),wait)}function updateCountdown(){if(!qrSessionId)return;const now=Date.now(),end=new Date(qrSessionEnd).getTime(),exp=qrExpiry?new Date(qrExpiry).getTime():0;if(end<=now){$('qrCountdown').textContent='00:00';$('qrActiveStatus').textContent='انتهت الجلسة';$('qrActiveStatus').className='pill bad';stopQrTimers();message('qrMessage','انتهت الجلسة. لن يتم إصدار رموز جديدة.','warning');return}const sec=Math.max(0,Math.ceil((exp-now)/1000));$('qrCountdown').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
async function endSession(s){if(!confirm(`هل تريد إنهاء جلسة "${s.courses?.name||'الكورس'}" الآن؟`))return;try{const now=new Date().toISOString();const {data,error}=await sb.from('attendance_sessions').update({is_active:false,ends_at:now}).eq('id',s.id).eq('doctor_id',user.id).select('id,is_active,ends_at').single();if(error)throw error;if(data?.is_active!==false)throw Error('لم يؤكد الخادم إنهاء الجلسة.');if(qrSessionId===s.id){stopQrTimers();qrSessionId=null;qrSessionEnd=null;qrVisible=false;$('qrCard').classList.add('hidden')}await loadSessions();message('pageMessage','تم إنهاء الجلسة في قاعدة البيانات. دالة check_in_with_qr تتحقق من نشاط الجلسة، ويجب اختبار رفض الرمز بعد الإنهاء.','success')}catch(e){message('pageMessage','تعذر إنهاء الجلسة: '+errText(e),'error')}}
async function createManualCode(){if(!qrSessionId)return message('qrMessage','افتح جلسة نشطة أولًا.','warning');const button=$('createManualCodeButton');button.disabled=true;button.textContent='جارٍ إصدار الكود…';try{const {data,error}=await sb.rpc('create_manual_attendance_code',{p_session_id:qrSessionId});if(error)throw error;const result=Array.isArray(data)?data[0]:data;if(!result?.manual_code||!result?.code_expires_at)throw Error('لم تُرجع الدالة الكود ووقت انتهاء الصلاحية المتوقعين.');$('manualCodeValue').textContent=result.manual_code;$('manualCodeExpiry').textContent=dateText(result.code_expires_at);$('manualCodeResult').classList.remove('hidden');message('qrMessage','تم إصدار كود احتياطي. شاركه داخل القاعة فقط؛ تنتهي صلاحيته بعد 60 ثانية.','success')}catch(e){message('qrMessage','تعذر إصدار الكود اليدوي: '+errText(e)+' — تأكد من تطبيق database/manual-attendance-code-migration.sql.','error')}finally{button.disabled=false;button.textContent='إصدار كود يدوي احتياطي'}}
function printQr(){const canvas=$('sessionQrCode').querySelector('canvas'),img=$('sessionQrCode').querySelector('img'),src=canvas?canvas.toDataURL('image/png'):img?.src;if(!src)return message('qrMessage','لا يوجد QR جاهز للطباعة.','warning');const w=window.open('','_blank','width=600,height=750');if(!w)return message('qrMessage','اسمح بالنوافذ المنبثقة حتى تتمكن من الطباعة.','warning');w.document.open();w.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Uni Attendance QR</title><style>body{font-family:Arial;text-align:center;padding:30px}img{width:260px;height:260px;object-fit:contain}</style><h2></h2><p></p><img alt="QR"><script>window.onload=()=>window.print()<\/script></html>');w.document.close();w.document.querySelector('h2').textContent=$('qrCourseTitle').textContent;w.document.querySelector('p').textContent=$('qrSessionInfo').textContent;w.document.querySelector('img').src=src}
async function logout(){stopQrTimers();if(sb)await sb.auth.signOut();location.replace(LOGIN_PAGE)}
async function editCourse(courseId){const course=courses.find(c=>c.id===courseId);if(!course)return;const name=prompt('اسم الكورس:',course.name);if(name===null)return;const code=prompt('كود الكورس:',course.code);if(code===null)return;if(!name.trim()||!code.trim())return message('pageMessage','اسم الكورس والكود مطلوبان.','warning');try{const {data,error}=await sb.from('courses').update({name:name.trim(),code:code.trim()}).eq('id',courseId).eq('doctor_id',user.id).select('id,name,code,created_at,doctor_id').single();if(error)throw error;courses=courses.map(c=>c.id===courseId?data:c);renderCourses();renderCourseOptions();await loadSessions();message('pageMessage','تم تحديث بيانات الكورس.','success')}catch(e){message('pageMessage',errText(e),'error')}}
function toLocalDateTime(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return '';const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
function openSessionEditor(sessionId){const s=sessions.find(x=>x.id===sessionId);if(!s)return;if(active(s))return message('pageMessage','لا يمكن تعديل بيانات جلسة نشطة. أنهِ الجلسة أولًا.','warning');$('editSessionId').value=s.id;$('editSessionStart').value=toLocalDateTime(s.starts_at);$('editSessionEnd').value=toLocalDateTime(s.ends_at);$('editSessionRadius').value=String(s.radius_m||50);$('sessionEditDialog').showModal()}
async function saveSessionEdit(e){e.preventDefault();const id=$('editSessionId').value,s=sessions.find(x=>x.id===id);if(!s)return;const start=new Date($('editSessionStart').value),end=new Date($('editSessionEnd').value),radius=Number($('editSessionRadius').value);if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return message('pageMessage','تأكد أن وقت النهاية بعد وقت البداية.','warning');if(!confirm('حفظ التعديلات؟ ستتغير بيانات الوقت ونطاق السماح الظاهرة في تقارير هذه المحاضرة.'))return;const button=$('saveSessionEditButton');button.disabled=true;try{const {error}=await sb.from('attendance_sessions').update({starts_at:start.toISOString(),ends_at:end.toISOString(),radius_m:radius}).eq('id',id).eq('doctor_id',user.id);if(error)throw error;sessions=sessions.map(x=>x.id===id?{...x,starts_at:start.toISOString(),ends_at:end.toISOString(),radius_m:radius}:x);$('sessionEditDialog').close();renderSessions();message('pageMessage','تم تحديث بيانات المحاضرة.','success')}catch(e){message('pageMessage',errText(e),'error')}finally{button.disabled=false}}
async function archiveSession(sessionId,archive){const s=sessions.find(x=>x.id===sessionId);if(!s)return;if(active(s))return message('pageMessage','أنهِ الجلسة أولًا قبل أرشفتها.','warning');const verb=archive?'أرشفة':'استعادة';if(!confirm(`${verb} المحاضرة؟ لن تُحذف سجلات الحضور.`))return;try{const {error}=await sb.from('attendance_sessions').update({is_archived:archive}).eq('id',sessionId).eq('doctor_id',user.id);if(error)throw error;sessions=sessions.map(x=>x.id===sessionId?{...x,is_archived:archive}:x);renderSessions();message('pageMessage',archive?'تمت أرشفة المحاضرة مع الحفاظ على سجل الحضور.':'تمت استعادة المحاضرة.','success')}catch(e){message('pageMessage',errText(e),'error')}}
$('coursesList').addEventListener('click',e=>{const b=e.target.closest('[data-course-action="edit"]');if(b)editCourse(b.dataset.id)});
$('sessionsList').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const id=b.dataset.id,action=b.dataset.action;if(action==='archive')archiveSession(id,true);else if(action==='restore')archiveSession(id,false);else if(action==='edit-session')openSessionEditor(id);else if(action==='export'){const s=sessions.find(x=>x.id===id);if(s)exportSessionAttendance(s)}else if(action==='qr'){const s=sessions.find(x=>x.id===id);if(s)openQr(s)}else if(action==='end'){const s=sessions.find(x=>x.id===id);if(s)endSession(s)}});
$('showArchivedSessions')?.addEventListener('change',renderSessions);$('sessionEditForm')?.addEventListener('submit',saveSessionEdit);$('closeSessionEditButton')?.addEventListener('click',()=>$('sessionEditDialog').close());
$('useManualLocationButton')?.addEventListener('click',()=>{const lat=Number($('manualLatitude').value),lon=Number($('manualLongitude').value);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180){message('pageMessage','أدخل خط عرض بين -90 و90 وخط طول بين -180 و180.','warning');return}showLocation({latitude:lat,longitude:lon,accuracy:0,manual:true});$('gpsStatus').textContent='موقع القاعة أُدخل يدويًا';$('gpsStatus').className='pill good';message('pageMessage','تم اعتماد إحداثيات القاعة يدويًا.','success')});
$('courseForm').addEventListener('submit',addCourse);$('sessionForm').addEventListener('submit',createSession);$('sessionCourse').addEventListener('change',()=>{$('createSessionButton').disabled=!courses.length||!$('sessionCourse').value});$('getLocationButton').addEventListener('click',detectLocation);$('refreshCoursesButton').addEventListener('click',async()=>{try{await loadCourses();message('pageMessage','تم تحديث الكورسات.','success')}catch(e){message('pageMessage',errText(e),'error')}});$('refreshSessionsButton').addEventListener('click',async()=>{try{await loadSessions();message('pageMessage','تم تحديث الجلسات.','success')}catch(e){message('pageMessage',errText(e),'error')}});$('refreshQrButton').addEventListener('click',()=>refreshQr(true));$('hideQrButton').addEventListener('click',()=>{stopQrTimers();qrSessionId=null;qrSessionEnd=null;qrVisible=false;$('qrCard').classList.add('hidden')});$('printQrButton').addEventListener('click',printQr);$('createManualCodeButton')?.addEventListener('click',createManualCode);$('logoutButton').addEventListener('click',logout);
(async()=>{try{if(!await authDoctor())return;await Promise.all([loadCourses(),loadSessions()])}catch(e){connection('مشكلة في الاتصال',false);message('pageMessage',errText(e),'error');$('coursesList').innerHTML='<div class="empty">تعذر تحميل الكورسات.</div>';$('sessionsList').innerHTML='<div class="empty">تعذر تحميل الجلسات.</div>'}})();


/* ---------- Attendance CSV export ---------- */
function csvCell(value) {
    const text = String(value ?? "");
    return '"' + text.replace(/"/g, '""') + '"';
}
function downloadCsv(filename, rows) {
    const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
async function exportSessionAttendance(session) {
    try {
        message("pageMessage", "جارٍ تجهيز ملف الحضور...", "info");
        const { data: records, error } = await sb
            .from("attendance_records")
            .select("id,student_id,checked_in_at,distance_m,session_id")
            .eq("session_id", session.id)
            .order("checked_in_at", { ascending: true });
        if (error) throw error;

        const studentIds = [...new Set((records || []).map(r => r.student_id).filter(Boolean))];
        let profileMap = new Map();
        if (studentIds.length) {
            const { data: people, error: peopleError } = await sb
                .from("profiles")
                .select("id,full_name,university_id")
                .in("id", studentIds);
            if (!peopleError) profileMap = new Map((people || []).map(p => [p.id, p]));
        }

        // Device audit is informational only; IP addresses are intentionally not collected.
        const deviceMap = new Map();
        try {
            const { data: deviceEvents, error: deviceError } = await sb.from("attendance_device_events")
                .select("student_id,device_id").eq("session_id", session.id);
            if (!deviceError && deviceEvents?.length) {
                const deviceIds = [...new Set(deviceEvents.map(e => e.device_id).filter(Boolean))];
                let keyById = new Map();
                if (deviceIds.length) {
                    const { data: devices } = await sb.from("student_devices").select("id,device_key").in("id", deviceIds);
                    keyById = new Map((devices || []).map(d => [d.id, d.device_key]));
                }
                deviceEvents.forEach(e => deviceMap.set(e.student_id, keyById.get(e.device_id) || ""));
            }
        } catch (deviceReadError) { console.warn("Device audit data unavailable for export.", deviceReadError); }
        const course = session.courses || courses.find(c => c.id === session.course_id) || {};
        const headers = [
            "full_name", "university_id", "course_name", "course_code", "session_id",
            "checked_in_at", "distance_m", "radius_m", "session_latitude", "session_longitude", "device_id"
        ];
        const rows = [headers];
        (records || []).forEach(record => {
            const person = profileMap.get(record.student_id) || {};
            rows.push([
                person.full_name || "", person.university_id || "", course.name || "",
                course.code || "", record.session_id || session.id, record.checked_in_at || "",
                record.distance_m ?? "", session.radius_m ?? "", session.latitude ?? "",
                session.longitude ?? "", deviceMap.get(record.student_id) || ""
            ]);
        });
        downloadCsv("UniAttend-attendance-" + String(session.id).slice(0, 8) + ".csv", rows);
        message("pageMessage", `تم تصدير ${records?.length || 0} سجل حضور. معرّف المتصفح يظهر كمعلومة تدقيقية اختيارية إذا كان له سجل متاح؛ لا يتم جمع IP.`, "success");
    } catch (error) {
        console.error("Attendance CSV export failed:", error);
        message("pageMessage", "تعذر تصدير الحضور: " + errText(error), "error");
    }
}

/* ---------- Explainable attendance anomaly review ---------- */
let analyzedRows = [];
let flaggedRows = [];

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
    analyzed.forEach(row => {
        const device = firstValue(row, ["device_id", "device_key", "device"]);
        const student = row._universityId !== "—" ? row._universityId : row._name;
        if (device) {
            if (!deviceStudents.has(device)) deviceStudents.set(device, new Set());
            deviceStudents.get(device).add(student);
        }
    });
    analyzed.forEach(row => {
        const device = firstValue(row, ["device_id", "device_key", "device"]);
        if (device && (deviceStudents.get(device)?.size || 0) > 1) {
            row._flags.push("معرّف المتصفح ظهر مع أكثر من حساب؛ مؤشر للمراجعة فقط وليس إثباتًا على المخالفة");
        }
        row._needsReview = row._flags.length > 0;
    });
    return analyzed;
}
function setAnalysisMessage(text, type = "info") {
    const el = $("analysisMessage");
    el.textContent = text;
    el.className = "msg show " + type;
}
function renderAnalysis(rows) {
    analyzedRows = rows;
    flaggedRows = rows.filter(r => r._needsReview);
    const goodCount = rows.length - flaggedRows.length;
    $("analysisSummary").classList.remove("hidden");
    $("analysisSummary").innerHTML = [
        ["إجمالي السجلات", rows.length],
        ["بدون تنبيهات", goodCount],
        ["تحتاج مراجعة", flaggedRows.length],
        ["فحص الموقع", rows.some(r => r._distance !== null) ? "متاح جزئيًا" : "بيانات غير كافية"]
    ].map(([label, value]) => `<div class="analysis-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");

    if (!rows.length) {
        $("analysisResults").innerHTML = '<tr><td colspan="6" class="empty">لا توجد سجلات قابلة للتحليل.</td></tr>';
    } else {
        $("analysisResults").innerHTML = rows.map(row => {
            const flags = row._flags.length ? row._flags.map(esc).join("<br>") : "لم تظهر مؤشرات واضحة";
            const distance = row._distance === null ? "—" : Math.round(row._distance) + " م";
            return `<tr>
                <td>${esc(row._name)}</td><td>${esc(row._universityId)}</td>
                <td>${esc(row._session)}</td><td>${esc(distance)}</td>
                <td class="flag-cell">${flags}</td>
                <td class="status-cell"><span class="pill ${row._needsReview ? "warn" : "good"}">${row._needsReview ? "تحتاج مراجعة" : "لا توجد مؤشرات"}</span></td>
            </tr>`;
        }).join("");
    }
    $("downloadFlaggedButton").disabled = flaggedRows.length === 0;
}
async function analyzeSelectedCsv() {
    const file = $("attendanceCsvFile").files?.[0];
    if (!file) { setAnalysisMessage("اختار ملف CSV الأول.", "warning"); return; }
    if (file.size > 10 * 1024 * 1024) { setAnalysisMessage("حجم الملف أكبر من 10 ميجابايت.", "error"); return; }
    if (!/\.csv$/i.test(file.name)) { setAnalysisMessage("ارفع ملف CSV فقط.", "error"); return; }
    $("analyzeAttendanceButton").disabled = true;
    try {
        const text = await file.text();
        const rows = analyzeAttendanceRows(parseCsv(text));
        renderAnalysis(rows);
        setAnalysisMessage("اكتمل التحليل. التنبيهات مؤشرات للمراجعة وليست دليلًا تلقائيًا على الغش.", "success");
    } catch (error) {
        console.error("Attendance analysis failed:", error);
        setAnalysisMessage(error.message || "تعذر تحليل الملف.", "error");
    } finally {
        $("analyzeAttendanceButton").disabled = false;
    }
}
function exportFlaggedRows() {
    if (!flaggedRows.length) return;
    const headers = ["row_number", "student_name", "university_id", "session", "distance_m", "review_flags", "review_status"];
    const rows = [headers];
    flaggedRows.forEach(row => rows.push([
        row._index, row._name, row._universityId, row._session,
        row._distance ?? "", row._flags.join(" | "), "Needs manual review"
    ]));
    downloadCsv("UniAttend-review-needed.csv", rows);
}
$("analyzeAttendanceButton")?.addEventListener("click", analyzeSelectedCsv);
$("downloadFlaggedButton")?.addEventListener("click", exportFlaggedRows);

