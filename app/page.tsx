'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';

type Role = 'leader' | 'member';
type Status = 'todo' | 'doing' | 'review' | 'changes' | 'done' | 'blocked';
type Profile = { id: string; display_name: string; role: Role; team_id: string; is_active: boolean; academic_number: string|null; phone: string; avatar_path: string|null; profile_updated_at: string|null };
type Project = { id:string; team_id:string; name:string; summary:string; repository_url:string };
type Phase = { id: string; name: string; position: number };
type TaskEvent = { id: number; event: 'created'|'status_changed'|'reassigned'; from_status: Status|null; to_status: Status|null; actor_name: string; note: string; created_at: string };
type Task = { id: string; title: string; description: string; acceptance_criteria: string; phase_id: string | null; assignee_id: string; due_date: string | null; priority: 'high'|'medium'|'low'; status: Status; learning_url: string; repository_url: string; branch_name: string; pull_request_url: string; review_feedback: string; assigneeName: string };

const statusNames: Record<Status,string> = {todo:'لم تبدأ',doing:'قيد التنفيذ',review:'بانتظار المراجعة',changes:'تحتاج تعديلًا',done:'مكتملة',blocked:'متوقفة'};
const statusTone: Record<Status,string> = {todo:'neutral',doing:'blue',review:'amber',changes:'red',done:'green',blocked:'red'};
const priorities = {high:'عالية',medium:'متوسطة',low:'منخفضة'} as const;
const defaultPhases = ['تأسيس المشروع','تسجيل الدخول والصلاحيات','بيانات السنتر','التشغيل اليومي','المدفوعات والحسابات','التقارير والإطلاق'];
const dateFormatter = new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short'});
const dateText = (v:string|null) => v ? dateFormatter.format(new Date(v+'T12:00:00')) : 'بلا موعد';
const getAppOrigin = () => {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if(!configured && ['localhost','127.0.0.1','::1'].includes(window.location.hostname)) {
    throw new Error('اضبط NEXT_PUBLIC_APP_URL على رابط الموقع المنشور قبل إنشاء دعوة أو حساب من النسخة المحلية.');
  }
  const url = new URL(configured || window.location.origin);
  if(url.protocol!=='https:' && url.protocol!=='http:') throw new Error('رابط التطبيق يجب أن يبدأ بـ https:// أو http://');
  return url.origin;
};
const isGithubPullRequest = (value:string) => { try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='github.com' && /^\/[^/]+\/[^/]+\/pull\/\d+/.test(url.pathname); } catch { return false; } };

const safeUrl = (value?:string|null) => { const v=(value||'').trim(); return /^https?:\/\/\S+$/i.test(v) ? v : undefined; };
const historyDate = new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const eventText = (e:TaskEvent) => e.event==='created' ? 'أُنشئت المهمة' : e.event==='reassigned' ? 'أُعيد إسناد المهمة' : `${statusNames[(e.from_status||'todo') as Status]} ← ${statusNames[(e.to_status||'todo') as Status]}`;

export default function Home() {
  const supabase = getSupabaseClient();
  const [session,setSession] = useState<Session|null>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [profiles,setProfiles] = useState<Profile[]>([]);
  const [projects,setProjects] = useState<Project[]>([]);
  const [currentProject,setCurrentProject] = useState<Project|null>(null);
  const [phases,setPhases] = useState<Phase[]>([]);
  const [tasks,setTasks] = useState<Task[]>([]);
  const [active,setActive] = useState('overview');
  const [mobileMenu,setMobileMenu] = useState(false);
  const [modal,setModal] = useState(false);
  const [taskToEdit,setTaskToEdit] = useState<Task|null>(null);
  const [projectModal,setProjectModal] = useState(false);
  const [projectToEdit,setProjectToEdit] = useState<Project|null>(null);
  const [phaseModal,setPhaseModal] = useState(false);
  const [phaseToEdit,setPhaseToEdit] = useState<Phase|null>(null);
  const [inviteLink,setInviteLink] = useState('');
  const [inviteToken,setInviteToken] = useState('');
  const [inviteComplete,setInviteComplete] = useState('');
  const [telegramConnected,setTelegramConnected] = useState(false);
  const [telegramUsername,setTelegramUsername] = useState('');
  const [telegramLink,setTelegramLink] = useState('');
  const [profilePhotoUrl,setProfilePhotoUrl] = useState('');
  const [plannerReturn,setPlannerReturn] = useState('overview');
  const [detail,setDetail] = useState<Task|null>(null);
  const [events,setEvents] = useState<TaskEvent[]>([]);
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState<Status|'all'>('all');
  const [toast,setToast] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  useEffect(()=>{
    if(!mobileMenu)return;
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileMenu(false);};
    window.addEventListener('keydown',closeOnEscape);
    return ()=>window.removeEventListener('keydown',closeOnEscape);
  },[mobileMenu]);

  useEffect(()=>{
    const id=detail?.id;
    if(!supabase||!id){setEvents([]);return;}
    let cancelled=false;
    void supabase.from('task_events').select('id,event,from_status,to_status,actor_name,note,created_at').eq('task_id',id).order('created_at',{ascending:true}).order('id',{ascending:true}).then(({data})=>{if(!cancelled)setEvents((data||[]) as TaskEvent[]);});
    return ()=>{cancelled=true;};
  },[detail?.id,supabase]);

  const notify = (s:string) => { setToast(s); window.setTimeout(()=>setToast(''),2600); };
  const loadWorkspace = useCallback(async (user:User) => {
    if (!supabase) return;
    setBusy(true); setError('');
    const profileResult = await supabase.from('profiles').select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,profile_updated_at').eq('id',user.id).single();
    if (profileResult.error || !profileResult.data) { setError('لم يتم العثور على ملف حسابك. تأكد من دعوة الحساب إلى الفريق وإعادة تسجيل الدخول.'); setBusy(false); return; }
    const me = profileResult.data as Profile;
    if (!me.is_active) { setProfile(null); setError('تم إيقاف عضويتك في الفريق. تواصل مع قائد الفريق إذا كنت تعتقد أن هذا حدث بالخطأ.'); setBusy(false); return; }
    setProfile(me);
    const [telegramResult,photoResult] = await Promise.all([
      supabase.functions.invoke('telegram-notifications',{body:{action:'status'}}),
      me.avatar_path ? supabase.storage.from('profile-photos').createSignedUrl(me.avatar_path,3600) : Promise.resolve({data:null,error:null}),
    ]);
    setTelegramConnected(Boolean(telegramResult.data?.connected));
    setTelegramUsername(telegramResult.data?.username||'');
    setProfilePhotoUrl(photoResult.data?.signedUrl||'');
    if (!me.academic_number?.trim() || !telegramResult.data?.connected) setActive('profile');
    const [peopleResult,projectsResult] = await Promise.all([
      supabase.from('profiles').select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,profile_updated_at').eq('team_id',me.team_id).order('created_at'),
      supabase.from('projects').select('id,name,team_id,summary,repository_url').eq('team_id',me.team_id).order('created_at'),
    ]);
    if (peopleResult.error) { setError(`تعذر تحميل أعضاء الفريق: ${peopleResult.error.message}`); setBusy(false); return; }
    setProfiles(peopleResult.data as Profile[] || [me]);
    if (projectsResult.error) { setError(projectsResult.error.message); setBusy(false); return; }
    let loadedProjects = (projectsResult.data||[]) as Project[];
    if (!loadedProjects.length && me.role === 'leader') {
      const created = await supabase.from('projects').insert({team_id:me.team_id,name:'نظام ERP للسنتر',summary:'تطبيق JavaFX لإدارة عمليات سنتر الدروس',created_by:user.id}).select('id,name,team_id,summary,repository_url').single();
      if (created.error) { setError(`تعذر تجهيز المشروع: ${created.error.message}`); setBusy(false); return; }
      loadedProjects = [created.data as Project];
      const phaseRows = defaultPhases.map((name,position)=>({project_id:created.data.id,name,position}));
      const phaseInsert = await supabase.from('phases').insert(phaseRows);
      if (phaseInsert.error && !phaseInsert.error.message.includes('duplicate')) { setError(`تعذر تجهيز مراحل المشروع: ${phaseInsert.error.message}`); setBusy(false); return; }
    }
    if (!loadedProjects.length) { setError('لم يجهّز قائد الفريق مشروعه بعد. اطلب منه تسجيل الدخول أولًا.'); setBusy(false); return; }
    setProjects(loadedProjects);
    const rememberedId = localStorage.getItem('team-current-project');
    const selectedProject = loadedProjects.find(p=>p.id===rememberedId)||loadedProjects[0];
    setCurrentProject(selectedProject);
    const projectId = selectedProject.id;
    const [phaseResult,taskResult] = await Promise.all([
      supabase.from('phases').select('id,name,position').eq('project_id',projectId).order('position'),
      supabase.from('tasks').select('*').eq('project_id',projectId).order('created_at',{ascending:false}),
    ]);
    if (phaseResult.error) { setError(phaseResult.error.message); setBusy(false); return; }
    if (taskResult.error) { setError(`تعذر تحميل المهام: ${taskResult.error.message}`); setBusy(false); return; }
    setPhases(phaseResult.data as Phase[]);
    const nameById = new Map((peopleResult.data as Profile[]||[me]).map(p=>[p.id,p.display_name]));
    setTasks((taskResult.data||[]).map(t=>({...t,assigneeName:nameById.get(t.assignee_id)||'عضو الفريق'})) as Task[]);
    setBusy(false);
  },[supabase]);

  useEffect(()=>{
    if (!supabase) return;
    setInviteToken(new URLSearchParams(window.location.search).get('invite')||'');
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next)=>{
      setSession(next);
      if(next) window.setTimeout(()=>void loadWorkspace(next.user),0);
      else {setProfile(null);setProfiles([]);setProjects([]);setCurrentProject(null);setTasks([]);setPhases([]);}
    });
    return ()=>subscription.unsubscribe();
  },[supabase,loadWorkspace]);

  const role = profile?.role;
  const needsProfileSetup = Boolean(profile && (!profile.academic_number?.trim() || !telegramConnected));
  const visibleTasks = useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return tasks.filter(t=>(filter==='all'||t.status===filter)&&`${t.title} ${t.assigneeName}`.toLocaleLowerCase().includes(needle));},[tasks,filter,query]);
  const stats = useMemo(()=>tasks.reduce((counts,task)=>{if(task.status!=='done')counts.open++;if(task.status==='doing')counts.doing++;if(task.status==='review')counts.review++;if(task.status==='done')counts.done++;return counts;},{open:0,doing:0,review:0,done:0}),[tasks]);
  const taskCountsByMember = useMemo(()=>tasks.reduce((counts,task)=>{const count=counts.get(task.assignee_id)||{open:0,total:0};count.total++;if(task.status!=='done')count.open++;counts.set(task.assignee_id,count);return counts;},new Map<string,{open:number;total:number}>()),[tasks]);

  async function signIn(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    const {error}=await supabase.auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});
    if(error)setError(error.message==='Invalid login credentials'?'البريد الإلكتروني أو كلمة المرور غير صحيحة.':error.message);
    setBusy(false);
  }
  async function signOut(){await supabase?.auth.signOut();setProfile(null);setSession(null);setTelegramConnected(false);setTelegramUsername('');setProfilePhotoUrl('');}
  async function loadProjectData(project:Project){
    if(!supabase)return;setBusy(true);setCurrentProject(project);localStorage.setItem('team-current-project',project.id);setError('');
    const [phaseResult,taskResult]=await Promise.all([
      supabase.from('phases').select('id,name,position').eq('project_id',project.id).order('position'),
      supabase.from('tasks').select('*').eq('project_id',project.id).order('created_at',{ascending:false}),
    ]);
    if(phaseResult.error||taskResult.error){setError(phaseResult.error?.message||taskResult.error?.message||'تعذر تحميل المشروع');setBusy(false);return;}
    setPhases(phaseResult.data as Phase[]);const nameById=new Map(profiles.map(p=>[p.id,p.display_name]));
    setTasks((taskResult.data||[]).map(t=>({...t,assigneeName:nameById.get(t.assignee_id)||'عضو الفريق'})) as Task[]);setBusy(false);
  }
  async function createProject(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!profile||!session)return;setBusy(true);setError('');const f=new FormData(e.currentTarget);
    const values={name:String(f.get('name')).trim(),summary:String(f.get('summary')||''),repository_url:String(f.get('repository_url')||'')};
    const result=projectToEdit?await supabase.from('projects').update(values).eq('id',projectToEdit.id).select('id,name,team_id,summary,repository_url').single():await supabase.from('projects').insert({...values,team_id:profile.team_id,created_by:session.user.id}).select('id,name,team_id,summary,repository_url').single();
    if(result.error){setError(result.error.message);setBusy(false);return;}
    const project=result.data as Project;
    if(!projectToEdit){const phaseRows=defaultPhases.map((name,position)=>({project_id:project.id,name,position}));const phaseInsert=await supabase.from('phases').insert(phaseRows);if(phaseInsert.error){setError(phaseInsert.error.message);setBusy(false);return;}}
    setProjects(prev=>projectToEdit?prev.map(p=>p.id===project.id?project:p):[...prev,project]);setProjectModal(false);setProjectToEdit(null);await loadProjectData(project);setActive('overview');notify(projectToEdit?'اتحفظت تعديلات المشروع':'اتضاف المشروع ومراحله الأساسية');
  }
  async function savePhase(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!currentProject)return;const name=String(new FormData(e.currentTarget).get('name')).trim();if(!name)return;
    const result=phaseToEdit?await supabase.from('phases').update({name}).eq('id',phaseToEdit.id):await supabase.from('phases').insert({project_id:currentProject.id,name,position:phases.length?Math.max(...phases.map(p=>p.position))+1:0});
    if(result.error){notify(result.error.message);return;}setPhaseModal(false);setPhaseToEdit(null);await loadProjectData(currentProject);notify(phaseToEdit?'اتعدلت المرحلة':'اتضافت المرحلة');
  }
  async function deletePhase(phase:Phase){if(!supabase||!currentProject||!confirm(`حذف مرحلة «${phase.name}»؟ المهام المرتبطة بها ستبقى بدون مرحلة.`))return;const {error}=await supabase.from('phases').delete().eq('id',phase.id);if(error){notify(error.message);return;}await loadProjectData(currentProject);notify('اتحذفت المرحلة');}
  async function movePhase(phase:Phase,delta:number){if(!supabase||!currentProject)return;const index=phases.findIndex(p=>p.id===phase.id);const other=phases[index+delta];if(!other)return;const first=await supabase.from('phases').update({position:other.position}).eq('id',phase.id);const second=await supabase.from('phases').update({position:phase.position}).eq('id',other.id);if(first.error||second.error){notify(first.error?.message||second.error?.message||'تعذر الترتيب');return;}await loadProjectData(currentProject);}
  async function createInvite(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!supabase)return;setBusy(true);setError('');const email=String(new FormData(e.currentTarget).get('email')).trim();const {data,error}=await supabase.rpc('create_team_invite',{p_email:email});if(error){setError(error.message);setBusy(false);return;}setInviteLink(`${getAppOrigin()}/?invite=${encodeURIComponent(data)}`);setBusy(false);notify('اتعمل رابط الدعوة؛ ابعته للعضو على نفس البريد');}
  async function removeMember(member:Profile){if(!supabase||!confirm(`إزالة ${member.display_name} من الفريق؟ سيتوقف دخوله للتطبيق، وستظل مهامه وسجل عمله محفوظين.`))return;setBusy(true);const {error}=await supabase.rpc('remove_team_member',{p_member_id:member.id});if(error){notify(error.message);setBusy(false);return;}setProfiles(previous=>previous.map(p=>p.id===member.id?{...p,is_active:false}:p));setBusy(false);notify('اتوقفت عضوية العضو، ومهامه القديمة محفوظة');}
  async function deleteInactiveMember(member:Profile){
    if(!supabase||!confirm(`حذف ${member.display_name} نهائيًا؟ يُسمح بهذا فقط إذا لم تكن له مهام أو مشروعات، وستُحذف الدعوات المرتبطة بحسابه. لا يمكن التراجع عن الحذف.`))return;
    setBusy(true);
    const {data,error}=await supabase.functions.invoke('delete-inactive-member',{body:{memberId:member.id}});
    if(error){
      let message=error.message;
      const context=(error as unknown as {context?:Response}).context;
      if(context){try{const body=await context.json();if(typeof body?.error==='string')message=body.error;}catch{}}
      notify(message);setBusy(false);return;
    }
    if(data?.error){notify(data.error);setBusy(false);return;}
    setProfiles(previous=>previous.filter(p=>p.id!==member.id));
    setBusy(false);notify('اتحذف الحساب نهائيًا');
  }
  async function refreshTelegramStatus(){
    if(!supabase)return;
    const {data,error}=await supabase.functions.invoke('telegram-notifications',{body:{action:'status'}});
    if(error){notify('تعذر التحقق من ربط تليجرام. تأكد من نشر وظيفة الإشعارات.');return;}
    setTelegramConnected(Boolean(data?.connected));setTelegramUsername(data?.username||'');
    notify(data?.connected?'حساب تليجرام مربوط':'حساب تليجرام غير مربوط بعد');
  }
  async function saveProfile(e:FormEvent<HTMLFormElement>,photoFile?:File){
    e.preventDefault();if(!supabase||!profile)return;const form=new FormData(e.currentTarget);
    const display_name=String(form.get('display_name')||'').trim();const academic_number=String(form.get('academic_number')||'').trim();const phone=String(form.get('phone')||'').trim();
    if(!display_name||!academic_number){notify('الاسم والرقم الأكاديمي مطلوبان');return;}
    if(photoFile&&(!['image/jpeg','image/png','image/webp'].includes(photoFile.type)||photoFile.size>5*1024*1024)){notify('اختار صورة JPG أو PNG أو WebP وحجمها أقل من 5 ميجابايت');return;}
    const changed=display_name!==profile.display_name||academic_number!==profile.academic_number||phone!==(profile.phone||'')||Boolean(photoFile);if(!changed){notify('بياناتك محفوظة بالفعل');return;}
    const nextDate=profile.profile_updated_at?new Date(new Date(profile.profile_updated_at).getTime()+30*24*60*60*1000):null;
    if(nextDate&&Date.now()<nextDate.getTime()){notify(`تقدر تعدل بياناتك مرة أخرى يوم ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(nextDate)}`);return;}
    const warning=nextDate?`بعد التعديل لن تتمكن من تعديل بياناتك الشخصية مرة أخرى قبل ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(Date.now()+30*24*60*60*1000))}. هل تريد المتابعة؟`:'هذا التعديل سيبدأ فترة انتظار 30 يومًا قبل أن تتمكن من تعديل بياناتك الشخصية مرة أخرى. هل تريد المتابعة؟';
    if(!window.confirm(warning))return;
    if(!window.confirm(warning))return;
    setBusy(true);const oldPath=profile.avatar_path;let avatar_path=oldPath;let uploadedPath='';
    if(photoFile){const extension=photoFile.type==='image/png'?'png':photoFile.type==='image/webp'?'webp':'jpg';uploadedPath=`${profile.id}/avatar-${Date.now()}.${extension}`;const {error:uploadError}=await supabase.storage.from('profile-photos').upload(uploadedPath,photoFile,{upsert:false,contentType:photoFile.type,cacheControl:'3600'});if(uploadError){setBusy(false);notify(`تعذر رفع الصورة: ${uploadError.message}`);return;}avatar_path=uploadedPath;}
    const {data,error}=await supabase.from('profiles').update({display_name,academic_number,phone,avatar_path}).eq('id',profile.id).select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,profile_updated_at').single();
    if(error){if(uploadedPath)await supabase.storage.from('profile-photos').remove([uploadedPath]);setBusy(false);notify(error.code==='23505'?'الرقم الأكاديمي مستخدم لحساب آخر.':error.message);return;}
    if(oldPath&&oldPath!==avatar_path)await supabase.storage.from('profile-photos').remove([oldPath]);const {data:photo}=data.avatar_path?await supabase.storage.from('profile-photos').createSignedUrl(data.avatar_path,3600):{data:null};setProfilePhotoUrl(photo?.signedUrl||'');setProfile(data as Profile);setProfiles(previous=>previous.map(p=>p.id===profile.id?data as Profile:p));setBusy(false);notify('تم حفظ بيانات الملف الشخصي');
  }
  async function createTelegramLink(){
    if(!supabase)return;setBusy(true);
    const {data,error}=await supabase.functions.invoke('telegram-notifications',{body:{action:'create-link'}});
    if(error){let message='تعذر إنشاء رابط تليجرام. تأكد من نشر الوظيفة وإضافة رمز البوت إلى أسرار Supabase.';const context=(error as unknown as {context?:Response}).context;if(context){try{const body=await context.json();if(typeof body?.error==='string')message=body.error;}catch{}}notify(message);setBusy(false);return;}
    setTelegramLink(data?.url||'');setBusy(false);
  }
  async function configureTelegramWebhook(){
    if(!supabase)return;setBusy(true);
    const {error}=await supabase.functions.invoke('telegram-notifications',{body:{action:'configure-webhook'}});
    setBusy(false);
    if(error){notify('تعذر تفعيل البوت. راجع أسرار Supabase ثم أعد المحاولة.');return;}
    notify('اتفعّل استقبال ربط الأعضاء من تليجرام');
  }
  async function signUpFromInvite(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!supabase)return;setBusy(true);setError('');const form=new FormData(e.currentTarget);const email=String(form.get('email')).trim();const password=String(form.get('password'));const displayName=String(form.get('display_name')).trim();const academicNumber=String(form.get('academic_number')).trim();const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:getAppOrigin(),data:{invite_token:inviteToken,display_name:displayName,academic_number:academicNumber}}});if(error){setError(error.message==='Database error saving new user'?'قاعدة البيانات رفضت إنشاء الحساب. تأكد أن البريد مطابق تمامًا للبريد الذي دُعي، وأن الرابط لم يُستخدم أو تنتهِ صلاحيته. لو استمر الخطأ، راجع سجلات Auth في Supabase لمعرفة سبب الرفض.':error.message);setBusy(false);return;}if(data.session){setSession(data.session);void loadWorkspace(data.session.user);}else setInviteComplete('تم إنشاء الحساب. افتح رسالة التأكيد التي وصلت إلى بريدك، ثم سجّل الدخول.');setBusy(false);}
  function openPlanner(){setPlannerReturn(active);setActive('planner');setMobileMenu(false);}
  async function saveTask(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!session||!profile)return;setBusy(true);setError('');
    const f=new FormData(e.currentTarget);
    if(!currentProject){setError('اختر مشروعًا أولًا');setBusy(false);return;}
    const values={phase_id:String(f.get('phase'))||null,title:String(f.get('title')).trim(),description:String(f.get('description')),acceptance_criteria:String(f.get('criteria')),assignee_id:String(f.get('assignee')),due_date:String(f.get('due'))||null,priority:String(f.get('priority')) as Task['priority'],learning_url:String(f.get('video')),repository_url:String(f.get('repo'))};
    const result=taskToEdit
      ?await supabase.from('tasks').update(values).eq('id',taskToEdit.id).select().single()
      :await supabase.from('tasks').insert({...values,team_id:profile.team_id,project_id:currentProject.id,created_by:session.user.id}).select().single();
    if(result.error){setError(result.error.message);setBusy(false);return;}
    const assignee=profiles.find(p=>p.id===result.data.assignee_id);
    const saved={...result.data,assigneeName:assignee?.display_name||taskToEdit?.assigneeName||'عضو الفريق'} as Task;
    const shouldNotifyTelegram=!taskToEdit||taskToEdit.assignee_id!==saved.assignee_id;
    setTasks(prev=>taskToEdit?prev.map(task=>task.id===saved.id?saved:task):[saved,...prev]);setModal(false);setTaskToEdit(null);setBusy(false);notify(taskToEdit?'اتحفظت تعديلات المهمة':'اتضافت المهمة واتحفظت للفريق');
    if(shouldNotifyTelegram){
      const {data,error}=await supabase.functions.invoke('telegram-notifications',{body:{action:'notify-task',taskId:saved.id}});
      if(error)notify('اتحفظت المهمة، لكن تعذر إرسال تنبيه تليجرام.');
      else if(data?.sent)notify('اتحفظت المهمة واترسل تنبيه تليجرام للعضو.');
      else if(data?.reason==='not-connected')notify('اتحفظت المهمة؛ العضو لم يربط تليجرام بعد.');
    }
  }
  async function deleteTask(task:Task){
    if(!supabase||role!=='leader')return;
    if(!window.confirm(`حذف المهمة «${task.title}» نهائيًا؟ لا يمكن التراجع عن الحذف.`))return;
    setBusy(true);
    const {error}=await supabase.from('tasks').delete().eq('id',task.id);
    if(error){notify(`تعذر حذف المهمة: ${error.message}`);setBusy(false);return;}
    setTasks(previous=>previous.filter(item=>item.id!==task.id));
    setDetail(null);setBusy(false);notify('اتحذفت المهمة');
  }
  async function memberSubmit(task:Task){
    if(!supabase||!detail)return;
    const branch=detail.branch_name||'';const pr=detail.pull_request_url||'';
    const next:Status=task.status==='todo'?'doing':'review';
    if(next==='review'&&!branch.trim()){notify('اكتب اسم الفرع اللي اشتغلت عليه الأول');return;}
    if(next==='review'&&!isGithubPullRequest(pr)){notify('أضف رابط Pull Request صحيح من GitHub، مثل github.com/org/repo/pull/12');return;}
    const {error}=await supabase.rpc('submit_task',{p_task_id:task.id,p_status:next,p_branch_name:branch,p_pull_request_url:pr});
    if(error){notify(error.message);return;}
    if(currentProject)await loadProjectData(currentProject);setDetail(null);notify(next==='review'?'اترسل التسليم للمراجعة':'بدأت المهمة');
  }
  async function leaderReview(task:Task,accepted:boolean){
    if(!supabase||!detail)return;
    const {error}=await supabase.rpc('review_task',{p_task_id:task.id,p_accepted:accepted,p_feedback:detail.review_feedback||''});
    if(error){notify(error.message);return;}
    if(currentProject)await loadProjectData(currentProject);setDetail(null);notify(accepted?'تم قبول التسليم':'اتطلب تعديل المهمة');
  }

  if(!supabase) return <AuthScreen error="إعدادات Supabase غير موجودة. أضف رابط المشروع والمفتاح العام إلى ملف الإعداد المحلي." onSubmit={signIn} onSignUp={signUpFromInvite} busy={busy} inviteToken={inviteToken} inviteComplete={inviteComplete}/>;
  if(!session) return <AuthScreen error={error} onSubmit={signIn} onSignUp={signUpFromInvite} busy={busy} inviteToken={inviteToken} inviteComplete={inviteComplete}/>;
  if(!profile||busy) return <div className="auth-wrap"><div className="auth-card"><div className="brand-mark">ف</div><h1>{error?'تعذر فتح مساحة الفريق':'بنجهز مساحة الفريق'}</h1><p>{error||'لحظة واحدة...'}</p>{error&&<button className="secondary" onClick={signOut}>تسجيل الخروج</button>}</div></div>;
  if(needsProfileSetup) return <div className="auth-wrap"><section className="auth-card profile-onboarding"><div className="brand-mark">ف</div><div className="overline">خطوة واحدة قبل مساحة الفريق</div><h1>كمّل ملفك الشخصي</h1><p>الرقم الأكاديمي وربط حساب تليجرام مطلوبان لكل أعضاء الفريق، بما فيهم القائد.</p><ProfileDetailsForm profile={profile} email={session.user.email||''} photoUrl={profilePhotoUrl} busy={busy} onSave={saveProfile}/><section className="account-section"><h2>الحسابات المسجلة</h2><label>البريد الإلكتروني المستخدم<input readOnly value={session.user.email||''}/></label><div className="telegram-account-row"><div><b>حساب تليجرام</b><small>{telegramConnected?`مربوط${telegramUsername?` · @${telegramUsername}`:''}`:'الربط مطلوب لإكمال الملف'}</small></div><span className={`connection-dot ${telegramConnected?'connected':''}`}/></div><div className="modal-actions"><button className="primary" disabled={busy} onClick={()=>void createTelegramLink()}>{telegramConnected?'إعادة ربط حساب تليجرام':'إنشاء رابط ربط تليجرام'}</button><button className="secondary" disabled={busy} onClick={()=>void refreshTelegramStatus()}>تحققت من Start — تحديث الحالة</button></div>{telegramLink&&<a className="telegram-link" href={telegramLink} target="_blank" rel="noreferrer">افتح البوت واضغط Start ←</a>}<p className="helper">بعد الضغط على Start ارجع هنا واضغط تحديث الحالة لإكمال الدخول.</p></section><button className="text-button onboarding-signout" onClick={()=>void signOut()}>تسجيل الخروج</button></section></div>;

  return <div className="shell">
    <aside className={`sidebar ${mobileMenu?'open':''}`}><div className="brand"><span className="brand-mark">ف</span><span>فريق<small>مساحة عمل المشروع</small></span></div><label className="project-switch"><span className="project-symbol">م</span><select aria-label="المشروع الحالي" value={currentProject?.id||''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);if(p)void loadProjectData(p);setMobileMenu(false)}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="nav-caption">مساحة العمل</div><nav className="nav">
      <button className={active==='overview'?'selected':''} onClick={()=>{setActive('overview');setMobileMenu(false)}}><span>▦</span>نظرة عامة</button><button className={active==='tasks'?'selected':''} onClick={()=>{setActive('tasks');setMobileMenu(false)}}><span>☷</span>المهام <i>{stats.open}</i></button>{role==='leader'&&<><button className={active==='team'?'selected':''} onClick={()=>{setActive('team');setMobileMenu(false)}}><span>♧</span>الفريق</button><button className={active==='project'?'selected':''} onClick={()=>{setActive('project');setMobileMenu(false)}}><span>◫</span>مراحل المشروع</button><button className={active==='projects'?'selected':''} onClick={()=>{setActive('projects');setMobileMenu(false)}}><span>▤</span>المشاريع</button></>}<button className={active==='planner'?'selected':''} onClick={openPlanner}><span>☀</span>تنظيم يومي</button><button className={active==='notifications'?'selected':''} onClick={()=>{setActive('notifications');setMobileMenu(false);void refreshTelegramStatus()}}><span>◉</span>إشعارات تليجرام</button><button className={active==='profile'?'selected':''} onClick={()=>{setActive('profile');setMobileMenu(false);void refreshTelegramStatus()}}><span>◉</span>ملفي الشخصي</button>
    </nav><div className="side-spacer"/><div className="sidebar-note"><div className="note-icon">↗</div><b>التسليم عبر GitHub</b><p>اشتغل على فرع مستقل، ثم أضف رابط Pull Request للمراجعة.</p></div><div className="account"><div className="avatar">{profilePhotoUrl?<img src={profilePhotoUrl} alt=""/>:profile.display_name.slice(0,1)}</div><div className="account-meta"><b>{profile.display_name}</b><small>{role==='leader'?'قائد الفريق':'عضو الفريق'}</small></div><button className="dots" onClick={signOut} title="تسجيل الخروج">↪</button></div></aside>
    {mobileMenu&&<button className="mobile-menu-backdrop" onClick={()=>setMobileMenu(false)} aria-label="إغلاق القائمة"/>}
    <main className="main"><header className="topbar"><button className="mobile-toggle" onClick={()=>setMobileMenu(v=>!v)} aria-label="القائمة">☰</button><div className="crumb">{currentProject?.name||'مشروع'} <span>/</span> {active==='tasks'?'المهام':active==='team'?'الفريق':active==='project'?'مراحل المشروع':active==='projects'?'المشاريع':active==='planner'?'يومي':active==='notifications'?'إشعارات تليجرام':active==='profile'?'ملفي الشخصي':'نظرة عامة'}</div><div className="top-actions">{safeUrl(currentProject?.repository_url)&&<a className="repo-shortcut" href={safeUrl(currentProject?.repository_url)} target="_blank" rel="noreferrer">⌘ مستودع المشروع</a>}<span className="demo-pill"><i/> محفوظ على حساب الفريق</span></div></header>
      {active==='planner'&&<section className="planner-view"><div className="planner-toolbar"><button className="secondary" onClick={()=>setActive(plannerReturn)}>← رجوع إلى مساحة المشروع</button><div><b>تخطيط يومي</b><span>خطتك الشخصية</span></div></div><iframe className="planner-frame" src="/yawmi-v4.html" title="مخطط يومي"/></section>}
      {active==='overview'&&<section className="dashboard-hero"><div className="hero-main"><div className="hero-kicker">{role==='leader'?'لوحة قائد الفريق':'مساحة العضو'}</div><h1>أهلًا {profile.display_name}<br/><span>{role==='leader'?'خلّينا نحرّك المشروع':'دي مهامك الحالية'}</span></h1><p>{currentProject?.name} · {role==='leader'?'تابع الفريق والمهام وتسليمات GitHub من مكان واحد.':'راجع المطلوب ومصادر الشرح وسلّم شغلك.'}</p>{role==='leader'&&<button className="hero-action" onClick={()=>setModal(true)}>＋　مهمة جديدة</button>}</div><div className="hero-glance"><div className="glance-heading"><small>لمحة سريعة</small><b>حالة المشروع</b></div><Stat title="المهام المفتوحة" value={stats.open}/><Stat title="قيد التنفيذ" value={stats.doing}/><Stat title="بانتظار المراجعة" value={stats.review}/><Stat title="مكتملة" value={stats.done}/></div><span className="hero-orb hero-orb-one"/><span className="hero-orb hero-orb-two"/></section>}
      {active!=='overview'&&active!=='planner'&&<section className="section-banner"><div><small>مساحة العمل / {currentProject?.name}</small><h1>{active==='tasks'?(role==='leader'?'مهام المشروع':'مهامي'):active==='team'?'إدارة الفريق':active==='project'?'مراحل المشروع':active==='projects'?'مشاريع الفريق':active==='notifications'?'إشعارات تليجرام':'ملفي الشخصي'}</h1><p>{active==='tasks'?'تابع التقدم، راجع متطلبات كل مهمة، وحدّث التسليمات.':active==='team'?'دعوات الأعضاء ومتابعة توزيع العمل.':active==='profile'?'بيانات حسابك ووسائل التواصل المرتبطة به.':'كل ما تحتاجه لإدارة المشروع في مكان واحد.'}</p></div>{active==='tasks'&&role==='leader'&&<button className="primary" onClick={()=>{setTaskToEdit(null);setModal(true)}}>＋ مهمة جديدة</button>}</section>}
      {active==='overview'&&<nav className="quick-links" aria-label="اختصارات مساحة الفريق"><button onClick={()=>setActive('tasks')}><i>☷</i><span>المهام</span><small>عرض المهام</small></button><button onClick={openPlanner}><i>☀</i><span>تنظيم يومي</span><small>خطتك الشخصية</small></button><button onClick={()=>{setActive('notifications');void refreshTelegramStatus()}}><i>◉</i><span>تليجرام</span><small>حالة الربط</small></button><button onClick={()=>setActive('profile')}><i>♙</i><span>ملفي الشخصي</span><small>بيانات الحساب</small></button></nav>}
      {error&&<div className="card" style={{color:'#b74c43',marginBottom:14}}>{error}<button className="text-button" onClick={()=>void loadWorkspace(session.user)}>إعادة المحاولة</button></div>}
      {active==='overview'&&<div className="content-grid"><div className="main-column"><section className="card"><div className="card-heading"><div><h2>{role==='leader'?'مهام المشروع':'مهامي'}</h2><p>{role==='leader'?'المهام المسندة لأعضاء الفريق':'المهام المسندة لحسابك فقط'}</p></div><button className="text-button" onClick={()=>setActive('tasks')}>عرض الكل ←</button></div><TaskList tasks={tasks.slice(0,6)} onOpen={setDetail} isLeader={role==='leader'} onEdit={task=>{setTaskToEdit(task);setModal(true)}} onDelete={task=>void deleteTask(task)}/></section><section className="card"><div className="card-heading"><div><h2>مراحل المشروع</h2><p>تقدم تنفيذ {currentProject?.name}</p></div>{role==='leader'&&<button className="text-button" onClick={()=>setActive('project')}>إدارة المراحل</button>}</div><ProjectPhases phases={phases} tasks={tasks}/></section></div><div className="right-column"><section className="card"><div className="card-heading"><div><h2>{role==='leader'?'توزيع المهام':'خطة يومك'}</h2><p>{role==='leader'?'حمل العمل حسب العضو':'رتّب وقتك بجانب مهام المشروع'}</p></div></div>{role==='leader'?<TeamSummary people={profiles.filter(p=>p.is_active)} tasks={tasks}/>:<div className="daily-card"><span className="daily-icon">☀</span><h3>رتّب يومك في يومي</h3><p>افتح مخططك الشخصي وخطط لوقتك بجانب مهام المشروع.</p><button className="secondary" onClick={openPlanner}>افتح يومي</button></div>}</section></div></div>}
      {active==='tasks'&&<section className="card task-page"><div className="card-heading"><div><h2>{role==='leader'?'كل المهام':'مهامي'}</h2><p>{role==='leader'?'متابعة التنفيذ والتسليمات':'المهام المسندة لحسابك'}</p></div>{role==='leader'&&<button className="primary small" onClick={()=>{setTaskToEdit(null);setModal(true)}}>＋ مهمة</button>}</div><div className="filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في المهام…"/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'all')}><option value="all">كل الحالات</option>{Object.entries(statusNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><TaskList tasks={visibleTasks} onOpen={setDetail} isLeader={role==='leader'} onEdit={task=>{setTaskToEdit(task);setModal(true)}} onDelete={task=>void deleteTask(task)}/></section>}
      {active==='team'&&role==='leader'&&<div className="main-column"><section className="card"><div className="card-heading"><div><h2>إضافة عضو للفريق</h2><p>أنشئ رابط دعوة مرتبطًا ببريد العضو. صلاحية الرابط ١٤ يومًا.</p></div></div><form className="invite-form" onSubmit={createInvite}><label>البريد الإلكتروني للعضو<input type="email" name="email" required placeholder="name@example.com"/></label><button className="primary" disabled={busy}>إصدار رابط الدعوة</button></form>{inviteLink&&<div className="invite-result"><label>رابط دعوة خاص بهذا البريد<input readOnly value={inviteLink}/></label><button className="secondary" onClick={()=>{void navigator.clipboard.writeText(inviteLink);notify('اتنسخ رابط الدعوة')}}>نسخ الرابط</button><small>ابعت الرابط لصاحبه؛ التسجيل به يضيفه كعضو تلقائيًا.</small></div>}{error&&<p className="form-error">{error}</p>}</section><section className="card"><div className="card-heading"><div><h2>أعضاء الفريق</h2><p>الأعضاء النشطون ومهامهم الحالية</p></div></div><div className="team-grid">{profiles.filter(p=>p.is_active).map(p=><div className="team-card" key={p.id}><div className="avatar">{p.display_name.slice(0,1)}</div><div><b>{p.display_name}</b><small>{(taskCountsByMember.get(p.id)?.open||0)} مهام مفتوحة</small></div><span className="role-chip">{p.role==='leader'?'قائد':'عضو'}</span>{p.role==='member'&&<button className="danger-text" disabled={busy} onClick={()=>void removeMember(p)}>إزالة من الفريق</button>}</div>)}</div>{profiles.some(p=>!p.is_active)&&<div className="removed-members"><h3>عضويات متوقفة</h3><p>يمكن حذف الحساب نهائيًا إذا لم تكن له مهام أو مشروعات. ستُحذف الدعوات المرتبطة به أيضًا.</p><div className="team-grid">{profiles.filter(p=>!p.is_active).map(p=><div className="team-card inactive" key={p.id}><div className="avatar">{p.display_name.slice(0,1)}</div><div><b>{p.display_name}</b><small>{(taskCountsByMember.get(p.id)?.total||0)} مهام محفوظة</small></div><span className="role-chip">عضوية متوقفة</span><button className="danger-text" disabled={busy} onClick={()=>void deleteInactiveMember(p)}>حذف نهائي</button></div>)}</div></div>}</section></div>}
      {active==='notifications'&&<div className="main-column"><section className="card"><div className="card-heading"><div><h2>إشعارات المهام عبر تليجرام</h2><p>اربط حسابك لتستقبل رسالة عند إسناد مهمة جديدة إليك.</p></div><span className="role-chip">{telegramConnected?`مربوط${telegramUsername?` · @${telegramUsername}`:''}`:'غير مربوط'}</span></div><p className="helper">لازم تفتح البوت وتضغط Start من رابط الربط. الرابط صالح لعشر دقائق ويخص حسابك فقط.</p><div className="modal-actions"><button className="primary" disabled={busy} onClick={()=>void createTelegramLink()}>{telegramConnected?'إعادة ربط تليجرام':'إنشاء رابط الربط'}</button><button className="secondary" onClick={()=>void refreshTelegramStatus()}>تحديث حالة الربط</button>{role==='leader'&&<button className="secondary" disabled={busy} onClick={()=>void configureTelegramWebhook()}>تفعيل استقبال الربط</button>}</div>{telegramLink&&<div className="invite-result"><a className="telegram-link" href={telegramLink} target="_blank" rel="noreferrer">افتح البوت واربط حسابك ←</a><small>لو الرابط انتهى، أنشئ رابطًا جديدًا. لا تشارك هذا الرابط مع أحد.</small></div>}</section><section className="card"><div className="card-heading"><div><h2>طريقة الاستخدام</h2><p>مرة واحدة لكل عضو</p></div></div><div className="flow-list"><div className="flow-item"><i>١</i>قائد الفريق يفعّل استقبال البوت بعد إعداد الأسرار ونشر الوظيفة.</div><div className="flow-item"><i>٢</i>كل عضو يفتح صفحة إشعارات تليجرام ويضغط إنشاء رابط الربط.</div><div className="flow-item"><i>٣</i>يفتح العضو رابط البوت ويضغط Start؛ بعدها تصله إشعارات المهام الجديدة أو المعاد إسنادها.</div></div></section></div>}
      {active==='profile'&&<div className="main-column profile-page"><section className="card"><div className="card-heading"><div><h2>الملف الشخصي</h2><p>{role==='leader'?'قائد الفريق':'عضو الفريق'} · بياناتك الشخصية في مساحة الفريق</p></div><span className="role-chip">الرقم الأكاديمي مطلوب</span></div><ProfileDetailsForm profile={profile} email={session.user.email||''} photoUrl={profilePhotoUrl} busy={busy} onSave={saveProfile}/></section><section className="card account-section"><div className="card-heading"><div><h2>الحسابات المسجلة</h2><p>حسابات تسجيل الدخول والتواصل المرتبطة بك</p></div></div><label>البريد الإلكتروني المسجل<input readOnly value={session.user.email||''}/></label><div className="telegram-account-row"><div><b>حساب تليجرام</b><small>{telegramConnected?`مربوط${telegramUsername?` · @${telegramUsername}`:''}`:'غير مربوط — الربط مطلوب للفريق'}</small></div><span className={`connection-dot ${telegramConnected?'connected':''}`}/></div><div className="modal-actions"><button className="primary" disabled={busy} onClick={()=>void createTelegramLink()}>{telegramConnected?'إعادة ربط تليجرام':'ربط حساب تليجرام'}</button><button className="secondary" disabled={busy} onClick={()=>void refreshTelegramStatus()}>تحديث حالة الربط</button></div>{telegramLink&&<div className="invite-result"><a className="telegram-link" href={telegramLink} target="_blank" rel="noreferrer">افتح البوت واضغط Start لإتمام الربط ←</a><small>بعد ما تضغط Start ارجع للتطبيق واضغط تحديث حالة الربط.</small></div>}</section></div>}
      {active==='project'&&role==='leader'&&<div className="main-column"><section className="card"><div className="card-heading"><div><h2>مراحل {currentProject?.name}</h2><p>أضف المراحل ورتّبها وعدّل أسماءها حسب خطة التنفيذ.</p></div><button className="primary small" onClick={()=>{setPhaseToEdit(null);setPhaseModal(true)}}>＋ مرحلة جديدة</button></div><PhaseManager phases={phases} onEdit={p=>{setPhaseToEdit(p);setPhaseModal(true)}} onDelete={deletePhase} onMove={movePhase}/></section><section className="card"><div className="card-heading"><div><h2>التقدم حسب المرحلة</h2><p>يُحدّث تلقائيًا مع إنجاز المهام</p></div></div><ProjectPhases phases={phases} tasks={tasks} large/></section></div>}
      {active==='projects'&&role==='leader'&&<section className="card"><div className="card-heading"><div><h2>مشاريع الفريق</h2><p>أضف مشاريع مستقبلية وقت الحاجة، ولكل مشروع مراحله ومهامه.</p></div><button className="primary small" onClick={()=>{setProjectToEdit(null);setProjectModal(true)}}>＋ مشروع جديد</button></div><div className="project-cards">{projects.map(p=><article className={`project-card ${currentProject?.id===p.id?'current':''}`} key={p.id}><div className="project-symbol">{p.name.slice(0,1)}</div><div><b>{p.name}</b><p>{p.summary||'لا يوجد وصف بعد'}</p><small>{currentProject?.id===p.id?'المشروع الحالي':'مشروع الفريق'}</small></div><div className="project-card-actions"><button className="outline-button" onClick={()=>{setProjectToEdit(p);setProjectModal(true)}}>تعديل</button><button className="secondary" disabled={currentProject?.id===p.id} onClick={()=>{void loadProjectData(p);setActive('overview')}}>{currentProject?.id===p.id?'مفتوح':'فتح المشروع'}</button></div></article>)}</div></section>}
      <footer>فريق <span>إدارة مشروعكم بخطوات صغيرة وواضحة</span></footer>
    </main>
    {projectModal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setProjectModal(false);setProjectToEdit(null)}}}><form className="modal" onSubmit={createProject}><div className="modal-title"><div><div className="overline">مساحة جديدة</div><h2>{projectToEdit?'تعديل المشروع':'إضافة مشروع'}</h2></div><button type="button" className="close" onClick={()=>{setProjectModal(false);setProjectToEdit(null)}}>×</button></div>{!projectToEdit&&<p className="detail-desc">سيبدأ المشروع بمراحل افتراضية قابلة للتعديل عند الحاجة.</p>}<label>اسم المشروع<input name="name" required defaultValue={projectToEdit?.name||''} placeholder="مثال: نظام إدارة جديد"/></label><label>وصف مختصر<textarea name="summary" rows={3} defaultValue={projectToEdit?.summary||''}/></label><label>رابط مستودع GitHub<input type="url" name="repository_url" defaultValue={projectToEdit?.repository_url||''} placeholder="https://github.com/..."/></label><div className="modal-actions"><button className="primary" disabled={busy}>{projectToEdit?'حفظ التعديلات':'إنشاء المشروع'}</button><button className="secondary" type="button" onClick={()=>{setProjectModal(false);setProjectToEdit(null)}}>إلغاء</button></div></form></div>}
    {phaseModal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setPhaseModal(false);setPhaseToEdit(null)}}}><form className="modal" onSubmit={savePhase}><div className="modal-title"><div><div className="overline">تحكم بمراحل التنفيذ</div><h2>{phaseToEdit?'تعديل المرحلة':'مرحلة جديدة'}</h2></div><button type="button" className="close" onClick={()=>{setPhaseModal(false);setPhaseToEdit(null)}}>×</button></div><label>اسم المرحلة<input name="name" required defaultValue={phaseToEdit?.name||''} placeholder="مثال: اختبارات النظام" autoFocus/></label><div className="modal-actions"><button className="primary">{phaseToEdit?'حفظ التعديل':'إضافة المرحلة'}</button><button className="secondary" type="button" onClick={()=>{setPhaseModal(false);setPhaseToEdit(null)}}>إلغاء</button></div></form></div>}
    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setModal(false);setTaskToEdit(null)}}}><form className="modal" onSubmit={saveTask}><div className="modal-title"><div><div className="overline">توزيع جزء من المشروع</div><h2>{taskToEdit?'تعديل المهمة':'مهمة جديدة'}</h2></div><button type="button" className="close" onClick={()=>{setModal(false);setTaskToEdit(null)}}>×</button></div><label>عنوان المهمة<input name="title" required defaultValue={taskToEdit?.title||''} placeholder="مثال: إنشاء شاشة قائمة الطلاب"/></label><label>التعليمات<textarea name="description" rows={3} defaultValue={taskToEdit?.description||''}/></label><label>معيار الاكتمال<textarea name="criteria" rows={2} defaultValue={taskToEdit?.acceptance_criteria||''}/></label><div className="form-grid"><label>المرحلة<select name="phase" defaultValue={taskToEdit?.phase_id||''}><option value="">بدون مرحلة</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>المسؤول<select name="assignee" required defaultValue={taskToEdit?.assignee_id||profiles.find(p=>p.role==='member'&&p.is_active)?.id||''}>{profiles.filter(p=>(p.role==='member'&&p.is_active)||p.id===taskToEdit?.assignee_id).map(p=><option key={p.id} value={p.id}>{p.display_name}{!p.is_active?' (عضوية متوقفة)':''}</option>)}</select></label><label>موعد التسليم<input name="due" type="date" defaultValue={taskToEdit?.due_date||''}/></label><label>الأولوية<select name="priority" defaultValue={taskToEdit?.priority||'medium'}><option value="medium">متوسطة</option><option value="high">عالية</option><option value="low">منخفضة</option></select></label></div><div className="form-grid"><label>فيديو أو شرح<input name="video" type="url" defaultValue={taskToEdit?.learning_url||''} placeholder="https://youtube.com/..."/></label><label>رابط GitHub خاص بالمهمة <span className="field-hint">اختياري؛ لو فاضي هيظهر مستودع المشروع</span><input name="repo" type="url" defaultValue={taskToEdit?.repository_url||''} placeholder="رابط ملف أو مجلد محدد في GitHub"/></label></div>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button className="primary" disabled={busy}>{taskToEdit?'حفظ التغييرات':'إنشاء المهمة'}</button><button className="secondary" type="button" onClick={()=>{setModal(false);setTaskToEdit(null)}}>إلغاء</button></div></form></div>}
    {detail&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><div className="modal detail-modal"><div className="modal-title"><div><span className={`badge ${statusTone[detail.status]}`}>{statusNames[detail.status]}</span><h2>{detail.title}</h2></div><button className="close" onClick={()=>setDetail(null)}>×</button></div><p className="detail-desc">{detail.description||'لا توجد تعليمات إضافية.'}</p><div className="detail-meta"><span><small>المسؤول</small><b>{detail.assigneeName}</b></span><span><small>الموعد</small><b>{dateText(detail.due_date)}</b></span><span><small>الأولوية</small><b>{priorities[detail.priority]}</b></span></div><div className="criteria"><b>معيار الاكتمال</b><p>{detail.acceptance_criteria||'يحدده قائد الفريق.'}</p></div><div className="resource-links">{safeUrl(detail.learning_url)&&<a href={safeUrl(detail.learning_url)} target="_blank" rel="noreferrer">▶ افتح الشرح أو الفيديو</a>}{safeUrl(detail.repository_url||currentProject?.repository_url)&&<a href={safeUrl(detail.repository_url||currentProject?.repository_url)} target="_blank" rel="noreferrer">⌘ افتح {detail.repository_url?'ملف المهمة على GitHub':'مستودع المشروع على GitHub'}</a>}</div><div className="github-workflow"><b>الشغل على GitHub</b><p>اشتغل على فرع مستقل للمهمة. لما تخلص، افتح Pull Request والصق رابطه هنا للمراجعة.</p>{role==='member'&&detail.assignee_id===profile.id?<><label>اسم الفرع<input value={detail.branch_name||''} onChange={e=>setDetail({...detail,branch_name:e.target.value})} placeholder="feature/task-name"/></label><label>رابط Pull Request<input type="url" value={detail.pull_request_url||''} onChange={e=>setDetail({...detail,pull_request_url:e.target.value})} placeholder="https://github.com/org/repo/pull/12"/></label></>:detail.branch_name&&<p>الفرع: <code>{detail.branch_name}</code></p>}</div>{isGithubPullRequest(detail.pull_request_url||'')&&<a className="pr-link" href={detail.pull_request_url} target="_blank" rel="noreferrer">↗ فتح Pull Request</a>}{detail.review_feedback&&<div className="feedback"><b>ملاحظات المراجعة</b><p>{detail.review_feedback}</p></div>}{role==='leader'&&detail.status==='review'&&<label>ملاحظات المراجعة<textarea value={detail.review_feedback||''} onChange={e=>setDetail({...detail,review_feedback:e.target.value})}/></label>}{events.length>0&&<div className="task-history"><b>سجل المهمة</b><ul>{events.map(ev=><li key={ev.id}><span>{eventText(ev)}</span>{ev.note&&<p>{ev.note}</p>}<small>{ev.actor_name?`${ev.actor_name} · `:''}{historyDate.format(new Date(ev.created_at))}</small></li>)}</ul></div>}<div className="modal-actions">{role==='member'&&detail.assignee_id===profile.id&&detail.status!=='done'&&detail.status!=='review'&&<button className="primary" onClick={()=>void memberSubmit(detail)}>{detail.status==='todo'?'ابدأ المهمة':'أرسل للمراجعة'}</button>}{role==='leader'&&detail.status==='review'&&<><button className="primary" onClick={()=>void leaderReview(detail,true)}>قبول التسليم ✓</button><button className="secondary" onClick={()=>void leaderReview(detail,false)}>طلب تعديل</button></>}<button className="secondary" onClick={()=>setDetail(null)}>إغلاق</button></div></div></div>}
    {toast&&<div className="toast">✓　{toast}</div>}
  </div>;
}

function AuthScreen({error,onSubmit,onSignUp,busy,inviteToken,inviteComplete}:{error:string;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onSignUp:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean;inviteToken:string;inviteComplete:string}){return <div className="auth-wrap"><form className="auth-card" onSubmit={inviteToken?onSignUp:onSubmit}><div className="brand-mark">ف</div><div className="overline">مساحة فريق نظام ERP</div><h1>{inviteToken?'انضم إلى الفريق':'سجّل دخولك'}</h1><p>{inviteToken?'أكمل إنشاء حسابك باستخدام البريد الذي وصلته الدعوة.':'استخدم الحساب الذي دعاك به قائد الفريق.'}</p>{inviteToken&&<><label>اسمك<input name="display_name" required autoComplete="name"/></label><label>الرقم الأكاديمي<input name="academic_number" required autoComplete="off"/></label></>}<label>البريد الإلكتروني<input type="email" name="email" required autoComplete="email"/></label><label>كلمة المرور<input type="password" name="password" required minLength={8} autoComplete={inviteToken?'new-password':'current-password'}/></label>{inviteComplete&&<p className="success-note">{inviteComplete}</p>}{error&&<p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy?'جارٍ التجهيز…':inviteToken?'إنشاء حساب العضو':'تسجيل الدخول'}</button></form></div>}
function ProfileDetailsForm({profile,email,photoUrl,busy,onSave}:{profile:Profile;email:string;photoUrl:string;busy:boolean;onSave:(e:FormEvent<HTMLFormElement>,photoFile?:File)=>void}){const [photoFile,setPhotoFile]=useState<File|null>(null);const nextEdit=profile.profile_updated_at?new Date(new Date(profile.profile_updated_at).getTime()+30*24*60*60*1000):null;const locked=Boolean(nextEdit&&Date.now()<nextEdit.getTime());const date=nextEdit?new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(nextEdit):'';return <form className="profile-form" key={`${profile.id}:${profile.academic_number||''}:${profile.phone}:${profile.profile_updated_at||''}`} onSubmit={e=>onSave(e,photoFile||undefined)}><div className="profile-photo-row"><div className="profile-photo">{photoUrl?<img src={photoUrl} alt={`صورة ${profile.display_name}`}/>:profile.display_name.slice(0,1)}</div><div><b>{profile.display_name}</b><small>{profile.role==='leader'?'قائد الفريق':'عضو الفريق'}</small><label className={`photo-picker ${locked?'disabled':''}`}>اختيار صورة<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||locked} onChange={e=>setPhotoFile(e.currentTarget.files?.[0]||null)}/></label>{photoFile&&<small className="selected-photo">{photoFile.name} — اضغط حفظ لتطبيق التغيير</small>}</div></div><p className="profile-edit-note">{locked?`تم تعديل بياناتك مؤخرًا. يمكنك التعديل مرة أخرى ابتداءً من ${date}.`:'تعديل الاسم والرقم الأكاديمي والتليفون والصورة متاح مرة كل 30 يومًا. سيظهر لك تنبيه تأكيد قبل الحفظ.'}</p><div className="profile-fields"><label>الاسم<input name="display_name" required defaultValue={profile.display_name} disabled={locked}/></label><label>الرقم الأكاديمي<input name="academic_number" required defaultValue={profile.academic_number||''} autoComplete="off" disabled={locked}/></label><label>البريد الإلكتروني<input readOnly value={email}/></label><label>رقم التليفون<input name="phone" type="tel" defaultValue={profile.phone||''} autoComplete="tel" placeholder="اختياري" disabled={locked}/></label></div><button className="primary" disabled={busy||locked}>{busy?'جارٍ الحفظ…':locked?`التعديل متاح بعد ${date}`:'حفظ البيانات'}</button></form>}
function Stat({title,value}:{title:string;value:number}){const icon=title==='المهام المفتوحة'?'☷':title==='قيد التنفيذ'?'↗':title==='بانتظار المراجعة'?'◷':'✓';return <div className="stat"><div className="stat-label"><span>{title}</span><i>{icon}</i></div><strong>{value}</strong></div>}
function TaskList({tasks,onOpen,isLeader=false,onEdit,onDelete}:{tasks:Task[];onOpen:(t:Task)=>void;isLeader?:boolean;onEdit?:(t:Task)=>void;onDelete?:(t:Task)=>void}){if(!tasks.length)return <div className="empty">مفيش مهام هنا حاليًا. لما تتضاف مهمة هتظهر هنا.</div>;return <div className="task-list">{tasks.map(t=><article className="task-row" key={t.id}><button className="task-main" onClick={()=>onOpen(t)}><span className={`task-check ${t.status==='done'?'checked':''}`}>{t.status==='done'?'✓':''}</span><span className="task-copy"><b>{t.title}</b><small>{t.assigneeName} <i>·</i> {dateText(t.due_date)}</small></span></button><span className={`badge ${statusTone[t.status]}`}>{statusNames[t.status]}</span>{isLeader&&<div className="task-actions"><button className="row-action" aria-label={`تعديل ${t.title}`} onClick={()=>onEdit?.(t)}>تعديل</button><button className="row-action danger-text" aria-label={`حذف ${t.title}`} onClick={()=>onDelete?.(t)}>حذف</button></div>}<button className="row-arrow" aria-label="تفاصيل المهمة" onClick={()=>onOpen(t)}>←</button></article>)}</div>}
function ProjectPhases({phases,tasks,large=false}:{phases:Phase[];tasks:Task[];large?:boolean}){const byPhase=new Map<string,Task[]>();for(const task of tasks){if(!task.phase_id)continue;const group=byPhase.get(task.phase_id)||[];group.push(task);byPhase.set(task.phase_id,group);}return <div className={`phase-list ${large?'large':''}`}>{phases.map((phase,i)=>{const group=byPhase.get(phase.id)||[];const done=group.reduce((count,task)=>count+(task.status==='done'?1:0),0);const pct=group.length?Math.round(done/group.length*100):0;return <div className="phase" key={phase.id}><div className="phase-top"><span className="phase-num">{String(i+1).padStart(2,'0')}</span><div className="phase-name"><b>{phase.name}</b><small>{group.length?`${group.length} مهام`:'جاهزة للتخطيط'}</small></div><strong>{pct}%</strong></div><div className="progress"><i style={{width:`${pct}%`}}/></div>{large&&group.map(t=><div className="phase-tasks" key={t.id}>{t.title}</div>)}</div>})}</div>}
function PhaseManager({phases,onEdit,onDelete,onMove}:{phases:Phase[];onEdit:(p:Phase)=>void;onDelete:(p:Phase)=>void;onMove:(p:Phase,delta:number)=>void}){if(!phases.length)return <div className="empty">لسه مفيش مراحل للمشروع.</div>;return <div className="phase-manager">{phases.map((phase,index)=><div className="phase-manage-row" key={phase.id}><span className="phase-num">{String(index+1).padStart(2,'0')}</span><b>{phase.name}</b><div className="phase-actions"><button aria-label="نقل المرحلة لأعلى" disabled={index===0} onClick={()=>onMove(phase,-1)}>↑</button><button aria-label="نقل المرحلة لأسفل" disabled={index===phases.length-1} onClick={()=>onMove(phase,1)}>↓</button><button onClick={()=>onEdit(phase)}>تعديل</button><button className="danger-text" onClick={()=>onDelete(phase)}>حذف</button></div></div>)}</div>}
function TeamSummary({people,tasks}:{people:Profile[];tasks:Task[]}){const openByMember=new Map<string,number>();for(const task of tasks){if(task.status!=='done')openByMember.set(task.assignee_id,(openByMember.get(task.assignee_id)||0)+1);}return <div className="team-summary">{people.map((p,i)=>{const open=openByMember.get(p.id)||0;return <div className="member-line" key={p.id}><div className={`avatar color-${i%4}`}>{p.display_name.slice(0,1)}</div><div className="member-info"><b>{p.display_name}</b><small>{open} مهام مفتوحة</small></div><div className="mini-progress"><i style={{width:`${Math.max(10,90-open*12)}%`}}/></div></div>})}</div>}
