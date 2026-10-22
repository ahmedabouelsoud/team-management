'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';

type Role = 'leader' | 'member';
type Status = 'todo' | 'doing' | 'review' | 'changes' | 'done' | 'blocked';
type Profile = { id: string; display_name: string; role: Role; team_id: string; is_active: boolean; academic_number: string|null; phone: string; avatar_path: string|null; github_username?: string|null; profile_updated_at: string|null; display_name_updated_at: string|null; academic_number_updated_at: string|null; phone_updated_at: string|null; avatar_updated_at: string|null; password_changed_at?: string|null };
type ProfileField = 'display_name'|'academic_number'|'phone'|'avatar_path';
type Project = { id:string; team_id:string; name:string; summary:string; repository_url:string };
type Phase = { id: string; name: string; position: number };
type TaskEvent = { id: number; event: 'created'|'status_changed'|'reassigned'; from_status: Status|null; to_status: Status|null; actor_name: string; note: string; created_at: string };
type Task = { id: string; title: string; description: string; acceptance_criteria: string; phase_id: string | null; assignee_id: string; due_date: string | null; priority: 'high'|'medium'|'low'; status: Status; learning_url: string; repository_url: string; requires_submission_link: boolean; branch_name: string; pull_request_url: string; review_feedback: string; assigneeName: string };

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
const requiresSubmissionLink = (task:Task) => task.requires_submission_link === true;
const historyDate = new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const eventText = (e:TaskEvent) => e.event==='created' ? 'أُنشئت المهمة' : e.event==='reassigned' ? 'أُعيد إسناد المهمة' : `${statusNames[(e.from_status||'todo') as Status]} ← ${statusNames[(e.to_status||'todo') as Status]}`;

export default function Home() {
  const supabase = getSupabaseClient();
  const [session,setSession] = useState<Session|null>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [viewedMember,setViewedMember] = useState<Profile|null>(null);
  const [profiles,setProfiles] = useState<Profile[]>([]);
  const [projects,setProjects] = useState<Project[]>([]);
  const [currentProject,setCurrentProject] = useState<Project|null>(null);
  const [phases,setPhases] = useState<Phase[]>([]);
  const [tasks,setTasks] = useState<Task[]>([]);
  const [active,setActiveState] = useState('overview');
  const activeOwnerId = useRef('');
  function setActive(view:string){setActiveState(view);if(activeOwnerId.current)localStorage.setItem(`team-active:${activeOwnerId.current}`,view);}
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
  const [telegramConnected,setTelegramConnected] = useState<boolean|null>(null);
  const [telegramUsername,setTelegramUsername] = useState('');
  const [telegramLink,setTelegramLink] = useState('');
  const [profilePhotoUrl,setProfilePhotoUrl] = useState('');
  const [memberPhotoUrls,setMemberPhotoUrls] = useState<Record<string,string>>({});
  const [plannerReturn,setPlannerReturn] = useState('overview');
  const [detail,setDetail] = useState<Task|null>(null);
  const [events,setEvents] = useState<TaskEvent[]>([]);
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState<Status|'all'>('all');
  const [toast,setToast] = useState('');
  const [notificationsOpen,setNotificationsOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [passwordBusy,setPasswordBusy] = useState(false);
  const [passwordMessage,setPasswordMessage] = useState('');
  const [googleMessage,setGoogleMessage] = useState('');
  const [githubMessage,setGithubMessage] = useState('');
  const [error,setError] = useState('');

  useEffect(()=>{
    if(!mobileMenu)return;
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileMenu(false);};
    window.addEventListener('keydown',closeOnEscape);
    return ()=>window.removeEventListener('keydown',closeOnEscape);
  },[mobileMenu]);

  useEffect(()=>{
    if(!notificationsOpen)return;
    const closeOnOutside=(event:PointerEvent)=>{
      if(event.target instanceof Element&&!event.target.closest('.notification-wrap'))setNotificationsOpen(false);
    };
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setNotificationsOpen(false);};
    document.addEventListener('pointerdown',closeOnOutside);
    window.addEventListener('keydown',closeOnEscape);
    return ()=>{document.removeEventListener('pointerdown',closeOnOutside);window.removeEventListener('keydown',closeOnEscape);};
  },[notificationsOpen]);

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
    const profileResult = await supabase.from('profiles').select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,github_username,profile_updated_at,display_name_updated_at,academic_number_updated_at,phone_updated_at,avatar_updated_at,password_changed_at').eq('id',user.id).single();
    if (profileResult.error || !profileResult.data) { setError('لم يتم العثور على ملف حسابك. تأكد من دعوة الحساب إلى الفريق وإعادة تسجيل الدخول.'); setBusy(false); return; }
    let me = profileResult.data as Profile;
    activeOwnerId.current=user.id;
    const githubIdentity=user.identities?.find(identity=>identity.provider==='github');
    const githubUsername=String(githubIdentity?.identity_data?.user_name||githubIdentity?.identity_data?.preferred_username||'').replace(/^@/,'');
    if(githubUsername&&me.github_username!==githubUsername){const synced=await supabase.from('profiles').update({github_username:githubUsername}).eq('id',user.id).select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,github_username,profile_updated_at,display_name_updated_at,academic_number_updated_at,phone_updated_at,avatar_updated_at,password_changed_at').single();if(!synced.error&&synced.data)me=synced.data as Profile;}
    if (!me.is_active) { setProfile(null); setError('تم إيقاف عضويتك في الفريق. تواصل مع قائد الفريق إذا كنت تعتقد أن هذا حدث بالخطأ.'); setBusy(false); return; }
    setProfile(me);
    const [telegramResult,photoResult] = await Promise.all([
      supabase.functions.invoke('telegram-notifications',{body:{action:'status'}}),
      me.avatar_path ? supabase.storage.from('profile-photos').createSignedUrl(me.avatar_path,3600) : Promise.resolve({data:null,error:null}),
    ]);
    if(!telegramResult.error){setTelegramConnected(Boolean(telegramResult.data?.connected));setTelegramUsername(telegramResult.data?.username||'');}
    setProfilePhotoUrl(photoResult.data?.signedUrl||'');
    if (!me.academic_number?.trim() || !me.avatar_path || (!telegramResult.error&&!telegramResult.data?.connected)) setActive('profile');
    else {
      const savedView=localStorage.getItem(`team-active:${user.id}`)||'overview';
      const restoredView=savedView==='member-profile'?'team':savedView;
      const allowedViews=['overview','tasks','team','project','projects','planner','profile'];
      const roleAllowsView=me.role==='leader'||!['team','project','projects'].includes(restoredView);
      if(allowedViews.includes(restoredView)&&roleAllowsView)setActive(restoredView);
      if(restoredView==='planner')setPlannerReturn(localStorage.getItem(`team-planner-return:${user.id}`)||'overview');
    }
    const [peopleResult,projectsResult] = await Promise.all([
      supabase.from('profiles').select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,github_username,profile_updated_at,display_name_updated_at,academic_number_updated_at,phone_updated_at,avatar_updated_at').eq('team_id',me.team_id).order('created_at'),
      supabase.from('projects').select('id,name,team_id,summary,repository_url').eq('team_id',me.team_id).order('created_at'),
    ]);
    if (peopleResult.error) { setError(`تعذر تحميل أعضاء الفريق: ${peopleResult.error.message}`); setBusy(false); return; }
    const people=(peopleResult.data as Profile[] || [me]);
    setProfiles(people);
    const peopleWithPhotos=people.filter(person=>person.avatar_path);
    if(peopleWithPhotos.length){
      const cacheKey=`team-photo-cache:${user.id}:${me.team_id}`;
      let cache:Record<string,{path:string;url:string;expiresAt:number}>={};
      try{cache=JSON.parse(sessionStorage.getItem(cacheKey)||'{}') as typeof cache;}catch{}
      const now=Date.now();
      const cachedUrls:Record<string,string>={};
      const missingPhotos:Profile[]=[];
      for(const person of peopleWithPhotos){
        const saved=cache[person.id];
        if(saved?.path===person.avatar_path&&saved.expiresAt>now)cachedUrls[person.id]=saved.url;
        else missingPhotos.push(person);
      }
      setMemberPhotoUrls(cachedUrls);
      if(missingPhotos.length){
        void supabase.storage.from('profile-photos').createSignedUrls(missingPhotos.map(person=>person.avatar_path!),3600).then(({data,error})=>{
          if(error||!data)return;
          const freshUrls:Record<string,string>={};
          data.forEach((photo,index)=>{
            const person=missingPhotos[index];
            if(photo.signedUrl){freshUrls[person.id]=photo.signedUrl;cache[person.id]={path:person.avatar_path!,url:photo.signedUrl,expiresAt:Date.now()+55*60*1000};}
          });
          try{sessionStorage.setItem(cacheKey,JSON.stringify(cache));}catch{}
          setMemberPhotoUrls(previous=>({...previous,...freshUrls}));
        });
      }
    }else setMemberPhotoUrls({});
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

  const loadedUserId=useRef<string>('');
  useEffect(()=>{
    if (!supabase) return;
    let alive=true;setInviteToken(new URLSearchParams(window.location.search).get('invite')||'');
    void supabase.auth.getSession().then(({data})=>{if(!alive)return;setSession(data.session);if(data.session){loadedUserId.current=data.session.user.id;void loadWorkspace(data.session.user);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
      setSession(next);
      if(event==='SIGNED_OUT'||!next){loadedUserId.current='';setProfile(null);setProfiles([]);setProjects([]);setCurrentProject(null);setTasks([]);setPhases([]);return;}
      if(event==='SIGNED_IN'&&loadedUserId.current!==next.user.id){loadedUserId.current=next.user.id;void loadWorkspace(next.user);}
    });
    return ()=>{alive=false;subscription.unsubscribe();};
  },[supabase,loadWorkspace]);

  const role = profile?.role;
  const googleConnected = Boolean(session?.user.identities?.some(identity=>identity.provider==='google'));
  const githubIdentity = session?.user.identities?.find(identity=>identity.provider==='github');
  const githubConnected = Boolean(githubIdentity);
  const passwordChangedAt = profile?.password_changed_at||null;
  const passwordAvailableAt = passwordChangedAt ? new Date(new Date(passwordChangedAt).getTime()+60*24*60*60*1000) : null;
  const passwordLocked = Boolean(passwordAvailableAt && Date.now()<passwordAvailableAt.getTime());
  const needsProfileSetup = Boolean(profile && (!profile.academic_number?.trim() || !profile.avatar_path || telegramConnected===false || !githubConnected));
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
  }
  async function saveProfile(e:FormEvent<HTMLFormElement>,field:ProfileField,photoFile?:File){
    e.preventDefault();if(!supabase||!profile)return;const form=new FormData(e.currentTarget);let value:string|File|null=null;
    if(field==='display_name'&&profile.display_name.trim())return;
    if(field==='academic_number'&&profile.academic_number?.trim())return;
    if(field==='display_name')value=String(form.get(field)||'').trim();
    else if(field==='academic_number')value=String(form.get(field)||'').trim();
    else if(field==='phone')value=String(form.get(field)||'').trim();
    else value=photoFile||null;
    if(field==='display_name'&&!value){notify('الاسم مطلوب');return;}
    if(field==='academic_number'&&!value){notify('الرقم الأكاديمي مطلوب');return;}
    if(field==='avatar_path'&&!profile.avatar_path&&!photoFile){notify('الصورة الشخصية مطلوبة');return;}
    if(photoFile&&(!['image/jpeg','image/png','image/webp'].includes(photoFile.type)||photoFile.size>5*1024*1024)){notify('اختار صورة JPG أو PNG أو WebP وحجمها أقل من 5 ميجابايت');return;}
    const currentValue=field==='avatar_path'?profile.avatar_path:profile[field];
    if(field!=='avatar_path'&&value===currentValue){notify('لم يتغير هذا الحقل');return;}
    if(field==='avatar_path'&&!photoFile){notify('اختار صورة أولًا');return;}
    const timestampField=field==='avatar_path'?'avatar_updated_at':`${field}_updated_at` as const;
    const editedAt=profile[timestampField];const nextDate=editedAt?new Date(new Date(editedAt).getTime()+30*24*60*60*1000):null;
    if(nextDate&&Date.now()<nextDate.getTime()){notify(`تقدر تعدل هذا الحقل مرة أخرى يوم ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(nextDate)}`);return;}
    if(field==='avatar_path'&&!window.confirm('بعد حفظ الصورة لن تتمكن من تغييرها لمدة 30 يومًا. هل تريد المتابعة؟'))return;
    setBusy(true);const oldPath=profile.avatar_path;let uploadedPath='';let changes:Record<string,string>={};
    if(field==='avatar_path'&&photoFile){let uploadFile=photoFile;try{const bitmap=await createImageBitmap(photoFile);const scale=Math.min(1,384/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');context?.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const compressed=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',0.78));if(compressed)uploadFile=new File([compressed],`${photoFile.name.replace(/\.[^.]+$/,'')}.webp`,{type:'image/webp'});}catch{}const extension=uploadFile.type==='image/webp'?'webp':uploadFile.type==='image/png'?'png':'jpg';uploadedPath=`${profile.id}/avatar-${Date.now()}.${extension}`;const {error:uploadError}=await supabase.storage.from('profile-photos').upload(uploadedPath,uploadFile,{upsert:false,contentType:uploadFile.type,cacheControl:'3600'});if(uploadError){setBusy(false);notify(`تعذر رفع الصورة: ${uploadError.message}`);return;}changes.avatar_path=uploadedPath;}
    else if(field!=='avatar_path')changes[field]=String(value);
    const {data,error}=await supabase.from('profiles').update(changes).eq('id',profile.id).select('id,display_name,role,team_id,is_active,academic_number,phone,avatar_path,profile_updated_at,display_name_updated_at,academic_number_updated_at,phone_updated_at,avatar_updated_at,password_changed_at').single();
    if(error){if(uploadedPath)await supabase.storage.from('profile-photos').remove([uploadedPath]);setBusy(false);notify(error.code==='23505'?'الرقم الأكاديمي مستخدم لحساب آخر.':error.message);return;}
    if(oldPath&&oldPath!==data.avatar_path)await supabase.storage.from('profile-photos').remove([oldPath]);const {data:photo}=data.avatar_path?await supabase.storage.from('profile-photos').createSignedUrl(data.avatar_path,3600):{data:null};setProfilePhotoUrl(photo?.signedUrl||'');setMemberPhotoUrls(previous=>({...previous,[profile.id]:photo?.signedUrl||''}));setProfile(data as Profile);setProfiles(previous=>previous.map(p=>p.id===profile.id?data as Profile:p));setBusy(false);notify('تم حفظ التعديل');
  }
  async function changePassword(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!session)return;const form=e.currentTarget;const values=new FormData(form);const current=String(values.get('current_password')||'');const next=String(values.get('new_password')||'');const confirm=String(values.get('confirm_password')||'');
    setPasswordMessage('');if(next.length<8){setPasswordMessage('كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل.');return;}if(next!==confirm){setPasswordMessage('تأكيد كلمة المرور غير مطابق.');return;}if(next===current){setPasswordMessage('اختار كلمة مرور مختلفة عن الحالية.');return;}if(passwordLocked){setPasswordMessage(`تقدر تغير كلمة المرور مرة أخرى ابتداءً من ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(passwordAvailableAt!)}.`);return;}if(!window.confirm('تغيير كلمة المرور سيبدأ فترة انتظار 60 يومًا قبل التغيير التالي. هل تريد المتابعة؟'))return;
    setPasswordBusy(true);const {data,error}=await supabase.functions.invoke('change-password',{body:{currentPassword:current,newPassword:next}});setPasswordBusy(false);if(error||data?.error){let message=data?.error||'تعذر تغيير كلمة المرور.';let nextAllowedAt=data?.nextAllowedAt as string|undefined;const context=(error as unknown as {context?:Response|null}|null)?.context;if(context){try{const body=await context.json();if(typeof body?.error==='string')message=body.error;if(typeof body?.nextAllowedAt==='string')nextAllowedAt=body.nextAllowedAt;}catch{}}if(nextAllowedAt)message=`تقدر تغير كلمة المرور مرة أخرى ابتداءً من ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(nextAllowedAt))}.`;setPasswordMessage(message);return;}form.reset();setProfile(previous=>previous?{...previous,password_changed_at:data.passwordChangedAt}:previous);setPasswordMessage('تم تغيير كلمة المرور بنجاح.');
  }
  async function linkGoogleAccount(){
    if(!supabase)return;setGoogleMessage('');const {error}=await supabase.auth.linkIdentity({provider:'google',options:{redirectTo:window.location.href,queryParams:{prompt:'select_account'}}});if(error)setGoogleMessage(error.message.toLowerCase().includes('provider')?'فعّل Google من إعدادات تسجيل الدخول في Supabase ثم أعد المحاولة.':error.message);
  }
  async function linkGithubAccount(){
    if(!supabase)return;setGithubMessage('');if(window.location.origin!=='https://fariqi.pages.dev'){setGithubMessage('افتح فريقي من الرابط المنشور fariqi.pages.dev ثم سجّل الدخول واربط GitHub من هناك.');return;}const {error}=await supabase.auth.linkIdentity({provider:'github',options:{redirectTo:'https://fariqi.pages.dev/',scopes:'read:user'}});if(error){const message=error.message.toLowerCase();setGithubMessage(message.includes('manual linking')?'تعذر ربط الحساب الآن. يحتاج مسؤول التطبيق إلى تفعيل ربط الحسابات من إعدادات تسجيل الدخول.':message.includes('provider')?'خدمة تسجيل الدخول عبر GitHub غير مفعّلة بعد. حاول مرة أخرى لاحقًا.':message.includes('already')?'حساب GitHub هذا مرتبط بحساب آخر. جرّب حسابًا مختلفًا.':message.includes('identity')?'تعذر ربط هذا الحساب. تأكد أنه غير مرتبط بحساب آخر ثم حاول مجددًا.':'لم يكتمل ربط GitHub. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.');}
  }
  async function createTelegramLink(){
    if(!supabase)return;setBusy(true);
    const {data,error}=await supabase.functions.invoke('telegram-notifications',{body:{action:'create-link'}});
    if(error){let message='تعذر إنشاء رابط تليجرام. تأكد من نشر الوظيفة وإضافة رمز البوت إلى أسرار Supabase.';const context=(error as unknown as {context?:Response}).context;if(context){try{const body=await context.json();if(typeof body?.error==='string')message=body.error;}catch{}}notify(message);setBusy(false);return;}
    setTelegramLink(data?.url||'');setBusy(false);
  }
  async function signUpFromInvite(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!supabase)return;setBusy(true);setError('');const form=new FormData(e.currentTarget);const email=String(form.get('email')).trim();const password=String(form.get('password'));const displayName=String(form.get('display_name')).trim();const academicNumber=String(form.get('academic_number')).trim();const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:getAppOrigin(),data:{invite_token:inviteToken,display_name:displayName,academic_number:academicNumber}}});if(error){setError(error.message==='Database error saving new user'?'قاعدة البيانات رفضت إنشاء الحساب. تأكد أن البريد مطابق تمامًا للبريد الذي دُعي، وأن الرابط لم يُستخدم أو تنتهِ صلاحيته. لو استمر الخطأ، راجع سجلات Auth في Supabase لمعرفة سبب الرفض.':error.message);setBusy(false);return;}if(data.session){setSession(data.session);void loadWorkspace(data.session.user);}else setInviteComplete('تم إنشاء الحساب. افتح رسالة التأكيد التي وصلت إلى بريدك، ثم سجّل الدخول.');setBusy(false);}
  function openPlanner(){setPlannerReturn(active);if(activeOwnerId.current)localStorage.setItem(`team-planner-return:${activeOwnerId.current}`,active);setActive('planner');setMobileMenu(false);}
  async function saveTask(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!session||!profile)return;setBusy(true);setError('');
    const f=new FormData(e.currentTarget);
    if(!currentProject){setError('اختر مشروعًا أولًا');setBusy(false);return;}
    const assignees=[...new Set(f.getAll('assignees').map(String).filter(Boolean))];
    if(!assignees.length){setError('اختار عضوًا واحدًا على الأقل');setBusy(false);return;}
    const shared={phase_id:String(f.get('phase'))||null,title:String(f.get('title')).trim(),description:String(f.get('description')),acceptance_criteria:String(f.get('criteria')),due_date:String(f.get('due'))||null,priority:String(f.get('priority')) as Task['priority'],learning_url:String(f.get('video')),repository_url:String(f.get('repo')),requires_submission_link:f.get('requires_submission_link')==='on'};
    let savedRows:any[]=[];
    if(taskToEdit){
      const updated=await supabase.from('tasks').update({...shared,assignee_id:assignees[0]}).eq('id',taskToEdit.id).select().single();
      if(updated.error){setError(updated.error.message);setBusy(false);return;}
      savedRows=[updated.data];
      const extraAssignees=assignees.filter(id=>id!==assignees[0]);
      if(extraAssignees.length){
        const {data,error}=await supabase.from('tasks').insert(extraAssignees.map(assignee_id=>({...shared,assignee_id,team_id:profile.team_id,project_id:currentProject.id,created_by:session.user.id}))).select();
        if(error){setError(`تم حفظ التعديل، لكن تعذرت إضافة المهمة لبقية الأعضاء: ${error.message}`);setBusy(false);return;}
        savedRows=[...savedRows,...(data||[])];
      }
    }else{
      const result=await supabase.from('tasks').insert(assignees.map(assignee_id=>({...shared,assignee_id,team_id:profile.team_id,project_id:currentProject.id,created_by:session.user.id}))).select();
      if(result.error){setError(result.error.message);setBusy(false);return;}
      savedRows=result.data||[];
    }
    const normalized=savedRows.map(row=>({...row,assigneeName:profiles.find(p=>p.id===row.assignee_id)?.display_name||'عضو الفريق'} as Task));
    setTasks(prev=>[...normalized.filter(row=>!prev.some(task=>task.id===row.id)),...prev.map(task=>normalized.find(row=>row.id===task.id)||task)]);setModal(false);setTaskToEdit(null);setBusy(false);notify(taskToEdit?`اتحفظت المهمة لـ ${normalized.length} ${normalized.length===1?'عضو':'أعضاء'}`:`اتضافت المهمة لـ ${normalized.length} ${normalized.length===1?'عضو':'أعضاء'}`);
    void Promise.all(normalized.map(task=>supabase.functions.invoke('telegram-notifications',{body:{action:'notify-task',taskId:task.id}})));
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
    if(next==='review'&&requiresSubmissionLink(task)&&!branch.trim()){notify('اكتب اسم الفرع اللي اشتغلت عليه الأول');return;}
    if(next==='review'&&requiresSubmissionLink(task)&&!isGithubPullRequest(pr)){notify('أضف رابط Pull Request صحيح من GitHub، مثل github.com/org/repo/pull/12');return;}
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
  if(needsProfileSetup) return <div className="auth-wrap"><section className="auth-card profile-onboarding"><div className="brand-mark">ف</div><div className="overline">خطوة واحدة قبل مساحة الفريق</div><h1>كمّل ملفك الشخصي</h1><p>الصورة والرقم الأكاديمي وحسابا تليجرام وGitHub مطلوبة لإكمال الحساب.</p><ProfilePhotoEditor profile={profile} photoUrl={profilePhotoUrl} busy={busy} onSave={saveProfile}/><ProfileDetailsForm profile={profile} email={session.user.email||''} busy={busy} onSave={saveProfile}/><section className="account-section"><h2>الحسابات المسجلة</h2><div className="connected-account-row"><span className="provider-icon github-provider"><AppIcon name="github"/></span><div className="connected-account-copy"><b>GitHub (مطلوب)</b><small>{githubConnected?`@${githubIdentity?.identity_data?.user_name||githubIdentity?.identity_data?.preferred_username||githubIdentity?.identity_data?.name||'تم ربط الحساب'}`:'اربط حسابك لإكمال التسجيل'}</small></div><span className={`connection-state ${githubConnected?'connected':''}`}>{githubConnected?'متصل':'مطلوب'}</span>{!githubConnected&&<button className="primary" onClick={()=>void linkGithubAccount()}>ربط GitHub</button>}</div>{githubMessage&&<p className="form-error">{githubMessage}</p>}<label>البريد الإلكتروني المستخدم<input readOnly value={session.user.email||''}/></label><div className="telegram-account-row"><span className="provider-icon telegram-provider"><AppIcon name="telegram"/></span><div><b>حساب تليجرام</b><small>{telegramConnected===true?`مربوط${telegramUsername?` · @${telegramUsername}`:''}`:telegramConnected===false?'الربط مطلوب لإكمال الملف':'جارٍ التحقق من الربط'}</small></div><span className={`connection-dot ${telegramConnected===true?'connected':''}`}/></div><div className="modal-actions">{telegramConnected!==null&&<button className="primary" disabled={busy} onClick={()=>void createTelegramLink()}>{telegramConnected?'إعادة ربط حساب تليجرام':'إنشاء رابط ربط تليجرام'}</button>}<button className="secondary" disabled={busy} onClick={()=>void refreshTelegramStatus()}>{telegramConnected===null?'إعادة التحقق من الحالة':'تحققت من Start — تحديث الحالة'}</button></div>{telegramLink&&<a className="telegram-link" href={telegramLink} target="_blank" rel="noreferrer">افتح البوت واضغط Start ←</a>}<p className="helper">بعد الضغط على Start ارجع هنا واضغط تحديث الحالة لإكمال الدخول.</p></section><button className="text-button onboarding-signout" onClick={()=>void signOut()}>تسجيل الخروج</button></section></div>;

  return <div className="shell">
    <aside className={`sidebar ${mobileMenu?'open':''}`}><button className="sidebar-profile-card" onClick={()=>{setActive('profile');setMobileMenu(false);void refreshTelegramStatus()}} aria-label="فتح الملف الشخصي"><span className="sidebar-profile-avatar">{profilePhotoUrl?<img src={profilePhotoUrl} alt=""/>:profile.display_name.slice(0,1)}</span><span className="sidebar-profile-copy"><b>{profile.display_name}</b><small>{role==='leader'?'قائد الفريق':'عضو الفريق'}{profile.academic_number?` · ${profile.academic_number}`:''}</small><small className="sidebar-profile-project">{currentProject?.name||'مساحة عمل المشروع'}</small></span></button><label className="project-switch"><span className="project-symbol">م</span><select aria-label="المشروع الحالي" value={currentProject?.id||''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);if(p)void loadProjectData(p);setMobileMenu(false)}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="nav-caption">مساحة العمل</div><nav className="nav">
      <button className={active==='overview'?'selected':''} onClick={()=>{setActive('overview');setMobileMenu(false)}}><AppIcon name="overview"/>نظرة عامة</button><button className={active==='tasks'?'selected':''} onClick={()=>{setActive('tasks');setMobileMenu(false)}}><AppIcon name="tasks"/>المهام <i>{stats.open}</i></button>{role==='leader'&&<><button className={active==='team'?'selected':''} onClick={()=>{setActive('team');setMobileMenu(false)}}><AppIcon name="team"/>الفريق</button><button className={active==='project'?'selected':''} onClick={()=>{setActive('project');setMobileMenu(false)}}><AppIcon name="phases"/>مراحل المشروع</button><button className={active==='projects'?'selected':''} onClick={()=>{setActive('projects');setMobileMenu(false)}}><AppIcon name="projects"/>المشاريع</button></>}<button className={active==='planner'?'selected':''} onClick={openPlanner}><AppIcon name="day"/>تنظيم يومي</button>
    </nav><div className="side-spacer"/><div className="sidebar-note"><div className="note-icon"><AppIcon name="github"/></div><b>التسليم عبر GitHub</b><p>اشتغل على فرع مستقل، ثم أضف رابط Pull Request للمراجعة.</p></div><div className="account account-signout"><button className="dots" onClick={signOut} title="تسجيل الخروج"><AppIcon name="logout"/> تسجيل الخروج</button></div></aside>
    {mobileMenu&&<button className="mobile-menu-backdrop" onClick={()=>setMobileMenu(false)} aria-label="إغلاق القائمة"/>}
    <main className="main"><header className="topbar"><button className="mobile-toggle" onClick={()=>setMobileMenu(v=>!v)} aria-label="القائمة"><AppIcon name="menu"/></button><div className="crumb">{currentProject?.name||'مشروع'} <span>/</span> {active==='tasks'?'المهام':active==='team'?'الفريق':active==='project'?'مراحل المشروع':active==='projects'?'المشاريع':active==='planner'?'يومي':active==='profile'?'ملفي الشخصي':active==='member-profile'?'ملف العضو':'نظرة عامة'}</div><div className="top-actions">{safeUrl(currentProject?.repository_url)&&<a className="repo-shortcut" href={safeUrl(currentProject?.repository_url)} target="_blank" rel="noreferrer"><AppIcon name="github"/> مستودع المشروع</a>}<div className="notification-wrap"><button className="notification-bell" aria-label="الإشعارات" aria-expanded={notificationsOpen} onClick={()=>setNotificationsOpen(value=>!value)}><AppIcon name="clock"/>{tasks.filter(task=>task.assignee_id===profile.id&&task.status==='todo').length>0&&<i>{tasks.filter(task=>task.assignee_id===profile.id&&task.status==='todo').length}</i>}</button>{notificationsOpen&&<div className="notification-popover"><b>مهامك الجديدة</b>{tasks.filter(task=>task.assignee_id===profile.id&&task.status==='todo').length===0?<p>لا توجد مهام جديدة.</p>:tasks.filter(task=>task.assignee_id===profile.id&&task.status==='todo').slice(0,8).map(task=><button key={task.id} onClick={()=>{setDetail(task);setNotificationsOpen(false)}}><span>{task.title}</span><small>{task.due_date?`موعد التسليم: ${dateText(task.due_date)}`:'لا يوجد موعد محدد'}</small></button>)}</div>}</div><span className="demo-pill"><i/> محفوظ على حساب الفريق</span></div></header>
      {active==='planner'&&<section className="planner-view"><div className="planner-toolbar"><button className="secondary" onClick={()=>setActive(plannerReturn)}>← رجوع إلى مساحة المشروع</button><div><b>تخطيط يومي</b><span>خطتك الشخصية</span></div></div><iframe className="planner-frame" src={`/yawmi-v4.html?member=${encodeURIComponent(profile.id)}`} title="مخطط يومي"/></section>}
      {active==='overview'&&<section className="dashboard-hero"><div className="hero-main"><div className="hero-kicker">{role==='leader'?'لوحة قائد الفريق':'مساحة العضو'}</div><h1>أهلًا {profile.display_name}<br/><span>{role==='leader'?'خلّينا نحرّك المشروع':'دي مهامك الحالية'}</span></h1><p>{currentProject?.name} · {role==='leader'?'تابع الفريق والمهام وتسليمات GitHub من مكان واحد.':'راجع المطلوب ومصادر الشرح وسلّم شغلك.'}</p>{role==='leader'&&<button className="hero-action" onClick={()=>setModal(true)}><AppIcon name="add"/> مهمة جديدة</button>}</div><div className="hero-glance"><div className="glance-heading"><small>لمحة سريعة</small><b>حالة المشروع</b></div><Stat title="المهام المفتوحة" value={stats.open}/><Stat title="قيد التنفيذ" value={stats.doing}/><Stat title="بانتظار المراجعة" value={stats.review}/><Stat title="مكتملة" value={stats.done}/></div><span className="hero-orb hero-orb-one"/><span className="hero-orb hero-orb-two"/></section>}
      {active!=='overview'&&active!=='planner'&&<section className="section-banner"><div><small>مساحة العمل / {currentProject?.name}</small><h1>{active==='tasks'?(role==='leader'?'مهام المشروع':'مهامي'):active==='team'?'إدارة الفريق':active==='project'?'مراحل المشروع':active==='projects'?'مشاريع الفريق':active==='member-profile'?'ملف العضو':'ملفي الشخصي'}</h1><p>{active==='tasks'?'تابع التقدم، راجع متطلبات كل مهمة، وحدّث التسليمات.':active==='team'?'دعوات الأعضاء ومتابعة توزيع العمل.':active==='profile'?'بيانات حسابك ووسائل التواصل المرتبطة به.':'كل ما تحتاجه لإدارة المشروع في مكان واحد.'}</p></div><div className="section-actions">{active==='profile'&&<button className="secondary" onClick={()=>setActive('overview')}><AppIcon name="overview"/> رجوع لمساحة العمل</button>}{active==='tasks'&&role==='leader'&&<button className="primary" onClick={()=>{setTaskToEdit(null);setModal(true)}}><AppIcon name="add"/> مهمة جديدة</button>}</div></section>}
      {active==='overview'&&<nav className="quick-links" aria-label="اختصارات مساحة الفريق"><button onClick={()=>setActive('tasks')}><i><AppIcon name="tasks"/></i><span>المهام</span><small>عرض المهام</small></button><button onClick={openPlanner}><i><AppIcon name="day"/></i><span>تنظيم يومي</span><small>خطتك الشخصية</small></button><button onClick={()=>setActive('profile')}><i><AppIcon name="profile"/></i><span>حساباتي</span><small>تليجرام وGoogle</small></button><button onClick={()=>setActive('tasks')}><i><AppIcon name="add"/></i><span>مهامي</span><small>إدارة مهامك</small></button></nav>}
      {error&&<div className="card" style={{color:'#b74c43',marginBottom:14}}>{error}<button className="text-button" onClick={()=>void loadWorkspace(session.user)}>إعادة المحاولة</button></div>}
      {active==='overview'&&<div className="content-grid"><div className="main-column"><section className="card"><div className="card-heading"><div><h2>{role==='leader'?'مهام المشروع':'مهامي'}</h2><p>{role==='leader'?'المهام المسندة لأعضاء الفريق':'المهام المسندة لحسابك فقط'}</p></div><button className="text-button" onClick={()=>setActive('tasks')}>عرض الكل ←</button></div><TaskList tasks={tasks.slice(0,6)} onOpen={setDetail} isLeader={role==='leader'} onEdit={task=>{setTaskToEdit(task);setModal(true)}} onDelete={task=>void deleteTask(task)}/></section><section className="card"><div className="card-heading"><div><h2>مراحل المشروع</h2><p>تقدم تنفيذ {currentProject?.name}</p></div>{role==='leader'&&<button className="text-button" onClick={()=>setActive('project')}>إدارة المراحل</button>}</div><ProjectPhases phases={phases} tasks={tasks}/></section></div><div className="right-column"><section className="card"><div className="card-heading"><div><h2>{role==='leader'?'توزيع المهام':'خطة يومك'}</h2><p>{role==='leader'?'حمل العمل حسب العضو':'رتّب وقتك بجانب مهام المشروع'}</p></div></div>{role==='leader'?<TeamSummary people={profiles.filter(p=>p.is_active)} tasks={tasks} photoUrls={memberPhotoUrls}/>:<div className="daily-card"><span className="daily-icon"><AppIcon name="day"/></span><h3>رتّب يومك في يومي</h3><p>افتح مخططك الشخصي وخطط لوقتك بجانب مهام المشروع.</p><button className="secondary" onClick={openPlanner}>افتح يومي</button></div>}</section></div></div>}
      {active==='tasks'&&<section className="card task-page"><div className="card-heading"><div><h2>{role==='leader'?'كل المهام':'مهامي'}</h2><p>{role==='leader'?'متابعة التنفيذ والتسليمات':'المهام المسندة لحسابك'}</p></div>{role==='leader'&&<button className="primary small" onClick={()=>{setTaskToEdit(null);setModal(true)}}><AppIcon name="add"/> مهمة</button>}</div><div className="filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في المهام…"/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'all')}><option value="all">كل الحالات</option>{Object.entries(statusNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><TaskList tasks={visibleTasks} onOpen={setDetail} isLeader={role==='leader'} onEdit={task=>{setTaskToEdit(task);setModal(true)}} onDelete={task=>void deleteTask(task)}/></section>}
      {active==='team'&&role==='leader'&&<div className="main-column"><section className="card"><div className="card-heading"><div><h2>إضافة عضو للفريق</h2><p>أنشئ رابط دعوة مرتبطًا ببريد العضو. صلاحية الرابط ١٤ يومًا.</p></div></div><form className="invite-form" onSubmit={createInvite}><label>البريد الإلكتروني للعضو<input type="email" name="email" required placeholder="name@example.com"/></label><button className="primary" disabled={busy}>إصدار رابط الدعوة</button></form>{inviteLink&&<div className="invite-result"><label>رابط دعوة خاص بهذا البريد<input readOnly value={inviteLink}/></label><button className="secondary" onClick={()=>{void navigator.clipboard.writeText(inviteLink);notify('اتنسخ رابط الدعوة')}}>نسخ الرابط</button><small>ابعت الرابط لصاحبه؛ التسجيل به يضيفه كعضو تلقائيًا.</small></div>}{error&&<p className="form-error">{error}</p>}</section><section className="card"><div className="card-heading"><div><h2>أعضاء الفريق</h2><p>الأعضاء النشطون ومهامهم الحالية</p></div></div><div className="team-grid">{profiles.filter(p=>p.is_active).map(p=><div className="team-card team-card-clickable" key={p.id} role="button" tabIndex={0} onClick={()=>{setViewedMember(p);setActive('member-profile')}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setViewedMember(p);setActive('member-profile')}}}><div className="avatar">{memberPhotoUrls[p.id]?<img src={memberPhotoUrls[p.id]} alt=""/>:p.display_name.slice(0,1)}</div><div><b>{p.display_name}</b><small>{(taskCountsByMember.get(p.id)?.open||0)} مهام مفتوحة</small></div><span className="role-chip">{p.role==='leader'?'قائد':'عضو'}</span>{p.role==='member'&&<button className="danger-text" disabled={busy} onClick={event=>{event.stopPropagation();void removeMember(p)}}>إزالة من الفريق</button>}</div>)}</div>{profiles.some(p=>!p.is_active)&&<div className="removed-members"><h3>عضويات متوقفة</h3><p>يمكن حذف الحساب نهائيًا إذا لم تكن له مهام أو مشروعات. ستُحذف الدعوات المرتبطة به أيضًا.</p><div className="team-grid">{profiles.filter(p=>!p.is_active).map(p=><div className="team-card inactive" key={p.id}><div className="avatar">{memberPhotoUrls[p.id]?<img src={memberPhotoUrls[p.id]} alt=""/>:p.display_name.slice(0,1)}</div><div><b>{p.display_name}</b><small>{(taskCountsByMember.get(p.id)?.total||0)} مهام محفوظة</small></div><span className="role-chip">عضوية متوقفة</span><button className="danger-text" disabled={busy} onClick={()=>void deleteInactiveMember(p)}>حذف نهائي</button></div>)}</div></div>}</section></div>}

    {active==='member-profile'&&viewedMember&&role==='leader'&&<section className="member-profile-page"><button className="secondary" onClick={()=>setActive('team')}>← الرجوع للفريق</button><article className="card member-profile-card"><div className="member-profile-avatar">{memberPhotoUrls[viewedMember.id]?<img src={memberPhotoUrls[viewedMember.id]} alt=""/>:viewedMember.display_name.slice(0,1)}</div><div className="member-profile-info"><span className="role-chip">{viewedMember.role==='leader'?'قائد الفريق':'عضو الفريق'}</span><h2>{viewedMember.display_name}</h2><p>الرقم الأكاديمي: <b>{viewedMember.academic_number||'غير مسجل'}</b></p><div className="member-github"><AppIcon name="github"/>{viewedMember.github_username?<span>حساب GitHub: <a href={`https://github.com/${encodeURIComponent(viewedMember.github_username)}`} target="_blank" rel="noreferrer">@{viewedMember.github_username}</a></span>:<span>لم يربط حساب GitHub بعد</span>}</div><small>المهام المفتوحة: {taskCountsByMember.get(viewedMember.id)?.open||0}</small></div></article></section>}
    {active==='profile'&&<div className="profile-layout"><aside className="profile-side"><section className="card profile-identity-card"><div className="profile-cover"/><ProfilePhotoEditor profile={profile} photoUrl={profilePhotoUrl} busy={busy} onSave={saveProfile}/><div className="profile-identity-copy"><h2>{profile.display_name}</h2><p>الرقم الأكاديمي <b>{profile.academic_number}</b></p><p>{currentProject?.name||'مساحة الفريق'}</p><small>{role==='leader'?'قائد الفريق':'عضو الفريق'}</small></div></section><section className="card profile-side-info"><span className="profile-side-icon"><AppIcon name="profile"/></span><b>مساحة {role==='leader'?'قائد الفريق':'عضو الفريق'}</b><p>الاسم والرقم الأكاديمي ثابتان. تعديل الصورة والتليفون متاح كل 30 يومًا.</p><span className="role-chip">{currentProject?.name||'مشروع الفريق'}</span></section></aside><div className="profile-main"><section className="card profile-data-card"><div className="card-heading"><div><h2>بيانات الحساب</h2><p>الاسم والرقم الأكاديمي ثابتان. يظهر التأكيد فقط عند تعديل الصورة.</p></div></div><ProfileDetailsForm profile={profile} email={session.user.email||''} busy={busy} onSave={saveProfile}/></section><section className="card account-section profile-connected-card"><div className="card-heading"><div><h2>الحسابات المتصلة</h2><p>حسابات تسجيل الدخول والتواصل المرتبطة بك</p></div></div><label>البريد الإلكتروني المسجل<input readOnly value={session.user.email||''}/></label><div className="connected-account-row"><span className="provider-icon telegram-provider"><AppIcon name="telegram"/></span><div className="connected-account-copy"><b>Telegram</b><small>{telegramConnected===true?`مربوط${telegramUsername?` · @${telegramUsername}`:''}`:telegramConnected===false?'غير مربوط':'جارٍ التحقق'}</small></div><span className={`connection-state ${telegramConnected===true?'connected':''}`}>{telegramConnected===true?'متصل':telegramConnected===false?'غير متصل':'جارٍ التحقق'}</span>{telegramConnected===false&&<button className="secondary" disabled={busy} onClick={()=>void createTelegramLink()}>ربط</button>}{telegramConnected===true&&<button className="secondary" disabled={busy} onClick={()=>void createTelegramLink()}>تغيير الحساب</button>}{telegramConnected===null&&<button className="secondary" disabled={busy} onClick={()=>void refreshTelegramStatus()}>إعادة التحقق</button>}</div>{telegramLink&&<div className="invite-result"><a className="telegram-link" href={telegramLink} target="_blank" rel="noreferrer">افتح البوت واضغط Start لإتمام الربط ←</a><small>بعد Start ارجع واضغط تحديث الحالة.</small><button className="text-button" onClick={()=>void refreshTelegramStatus()}>تحديث الحالة</button></div>}<div className="connected-account-row"><span className="provider-icon google-provider"><AppIcon name="google"/></span><div className="connected-account-copy"><b>Google</b><small>{googleConnected?session.user.identities?.find(identity=>identity.provider==='google')?.identity_data?.email||'حساب Google مرتبط':'اربط حساب Google بحسابك الحالي'}</small></div><span className={`connection-state ${googleConnected?'connected':''}`}>{googleConnected?'متصل':'غير متصل'}</span>{!googleConnected&&<button className="secondary" onClick={()=>void linkGoogleAccount()}>ربط Google</button>}</div><div className="connected-account-row"><span className="provider-icon github-provider"><AppIcon name="github"/></span><div className="connected-account-copy"><b>GitHub</b><small>{githubConnected?`@${githubIdentity?.identity_data?.user_name||githubIdentity?.identity_data?.preferred_username||githubIdentity?.identity_data?.name||'حساب GitHub مرتبط'}`:'اربط حساب GitHub لعرضه في ملفك'}</small></div><span className={`connection-state ${githubConnected?'connected':''}`}>{githubConnected?'متصل':'غير متصل'}</span>{!githubConnected&&<button className="secondary" onClick={()=>void linkGithubAccount()}>ربط GitHub</button>}</div>{githubMessage&&<p className="form-error">{githubMessage}</p>}{googleMessage&&<p className="form-error">{googleMessage}</p>}</section><section className="card password-card"><div className="card-heading"><div><h2>تغيير كلمة المرور</h2><p>ستستخدم كلمة المرور الجديدة في تسجيل الدخول القادم.</p></div></div><form className="password-form" onSubmit={changePassword}><label>كلمة المرور الحالية<input name="current_password" type="password" autoComplete="current-password" required/></label><div className="password-grid"><label>كلمة المرور الجديدة<input name="new_password" type="password" autoComplete="new-password" minLength={8} required/></label><label>تأكيد كلمة المرور الجديدة<input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required/></label></div>{passwordMessage&&<p className={passwordMessage.startsWith('تم')?'success-note':'form-error'}>{passwordMessage}</p>}<button className="primary" disabled={passwordBusy}>{passwordBusy?'جارٍ التحديث…':'تغيير كلمة المرور'}</button></form></section></div></div>}
      {active==='project'&&role==='leader'&&<div className="main-column"><section className="card"><div className="card-heading"><div><h2>مراحل {currentProject?.name}</h2><p>أضف المراحل ورتّبها وعدّل أسماءها حسب خطة التنفيذ.</p></div><button className="primary small" onClick={()=>{setPhaseToEdit(null);setPhaseModal(true)}}><AppIcon name="add"/> مرحلة جديدة</button></div><PhaseManager phases={phases} onEdit={p=>{setPhaseToEdit(p);setPhaseModal(true)}} onDelete={deletePhase} onMove={movePhase}/></section><section className="card"><div className="card-heading"><div><h2>التقدم حسب المرحلة</h2><p>يُحدّث تلقائيًا مع إنجاز المهام</p></div></div><ProjectPhases phases={phases} tasks={tasks} large/></section></div>}
      {active==='projects'&&role==='leader'&&<section className="card"><div className="card-heading"><div><h2>مشاريع الفريق</h2><p>أضف مشاريع مستقبلية وقت الحاجة، ولكل مشروع مراحله ومهامه.</p></div><button className="primary small" onClick={()=>{setProjectToEdit(null);setProjectModal(true)}}><AppIcon name="add"/> مشروع جديد</button></div><div className="project-cards">{projects.map(p=><article className={`project-card ${currentProject?.id===p.id?'current':''}`} key={p.id}><div className="project-symbol">{p.name.slice(0,1)}</div><div><b>{p.name}</b><p>{p.summary||'لا يوجد وصف بعد'}</p><small>{currentProject?.id===p.id?'المشروع الحالي':'مشروع الفريق'}</small></div><div className="project-card-actions"><button className="outline-button" onClick={()=>{setProjectToEdit(p);setProjectModal(true)}}>تعديل</button><button className="secondary" disabled={currentProject?.id===p.id} onClick={()=>{void loadProjectData(p);setActive('overview')}}>{currentProject?.id===p.id?'مفتوح':'فتح المشروع'}</button></div></article>)}</div></section>}
      <footer>فريق <span>إدارة مشروعكم بخطوات صغيرة وواضحة</span></footer>
    </main>
    {projectModal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setProjectModal(false);setProjectToEdit(null)}}}><form className="modal" onSubmit={createProject}><div className="modal-title"><div><div className="overline">مساحة جديدة</div><h2>{projectToEdit?'تعديل المشروع':'إضافة مشروع'}</h2></div><button type="button" className="close" aria-label="إغلاق" onClick={()=>{setProjectModal(false);setProjectToEdit(null)}}><AppIcon name="close"/></button></div>{!projectToEdit&&<p className="detail-desc">سيبدأ المشروع بمراحل افتراضية قابلة للتعديل عند الحاجة.</p>}<label>اسم المشروع<input name="name" required defaultValue={projectToEdit?.name||''} placeholder="مثال: نظام إدارة جديد"/></label><label>وصف مختصر<textarea name="summary" rows={3} defaultValue={projectToEdit?.summary||''}/></label><label>رابط مستودع GitHub<input type="url" name="repository_url" defaultValue={projectToEdit?.repository_url||''} placeholder="https://github.com/..."/></label><div className="modal-actions"><button className="primary" disabled={busy}>{projectToEdit?'حفظ التعديلات':'إنشاء المشروع'}</button><button className="secondary" type="button" onClick={()=>{setProjectModal(false);setProjectToEdit(null)}}>إلغاء</button></div></form></div>}
    {phaseModal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setPhaseModal(false);setPhaseToEdit(null)}}}><form className="modal" onSubmit={savePhase}><div className="modal-title"><div><div className="overline">تحكم بمراحل التنفيذ</div><h2>{phaseToEdit?'تعديل المرحلة':'مرحلة جديدة'}</h2></div><button type="button" className="close" aria-label="إغلاق" onClick={()=>{setPhaseModal(false);setPhaseToEdit(null)}}><AppIcon name="close"/></button></div><label>اسم المرحلة<input name="name" required defaultValue={phaseToEdit?.name||''} placeholder="مثال: اختبارات النظام" autoFocus/></label><div className="modal-actions"><button className="primary">{phaseToEdit?'حفظ التعديل':'إضافة المرحلة'}</button><button className="secondary" type="button" onClick={()=>{setPhaseModal(false);setPhaseToEdit(null)}}>إلغاء</button></div></form></div>}
    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setModal(false);setTaskToEdit(null)}}}><form className="modal" onSubmit={saveTask}><div className="modal-title"><div><div className="overline">توزيع جزء من المشروع</div><h2>{taskToEdit?'تعديل المهمة':'مهمة جديدة'}</h2></div><button type="button" className="close" aria-label="إغلاق" onClick={()=>{setModal(false);setTaskToEdit(null)}}><AppIcon name="close"/></button></div><label>عنوان المهمة<input name="title" required defaultValue={taskToEdit?.title||''} placeholder="مثال: إنشاء شاشة قائمة الطلاب"/></label><label>التعليمات<textarea name="description" rows={3} defaultValue={taskToEdit?.description||''}/></label><label>معيار الاكتمال<textarea name="criteria" rows={2} defaultValue={taskToEdit?.acceptance_criteria||''}/></label><div className="form-grid"><label>المرحلة<select name="phase" defaultValue={taskToEdit?.phase_id||''}><option value="">بدون مرحلة</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><TaskAssigneePicker profiles={profiles} profileId={profile.id} selectedId={taskToEdit?.assignee_id||profile.id}/><label>موعد التسليم<input name="due" type="date" defaultValue={taskToEdit?.due_date||''}/></label><label>الأولوية<select name="priority" defaultValue={taskToEdit?.priority||'medium'}><option value="medium">متوسطة</option><option value="high">عالية</option><option value="low">منخفضة</option></select></label></div><div className="form-grid"><label>فيديو أو شرح<input name="video" type="url" defaultValue={taskToEdit?.learning_url||''} placeholder="https://youtube.com/..."/></label><label>رابط GitHub خاص بالمهمة <span className="field-hint">اختياري؛ لو فاضي هيظهر مستودع المشروع</span><input name="repo" type="url" defaultValue={taskToEdit?.repository_url||''} placeholder="رابط ملف أو مجلد محدد في GitHub"/></label></div><label className="submission-toggle"><input name="requires_submission_link" type="checkbox" defaultChecked={taskToEdit?.requires_submission_link||false}/><span><b>إلزام العضو برابط GitHub عند التسليم</b><small>عند التفعيل، يلزم إدخال اسم الفرع ورابط Pull Request قبل إرسال المهمة للمراجعة.</small></span></label>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button className="primary" disabled={busy}>{taskToEdit?'حفظ التغييرات':'إنشاء المهمة'}</button><button className="secondary" type="button" onClick={()=>{setModal(false);setTaskToEdit(null)}}>إلغاء</button></div></form></div>}
    {detail&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><div className="modal detail-modal"><div className="modal-title"><div><span className={`badge ${statusTone[detail.status]}`}>{statusNames[detail.status]}</span><h2>{detail.title}</h2></div><button className="close" aria-label="إغلاق" onClick={()=>setDetail(null)}><AppIcon name="close"/></button></div><p className="detail-desc">{detail.description||'لا توجد تعليمات إضافية.'}</p><div className="detail-meta"><span><small>المسؤول</small><b>{detail.assigneeName}</b></span><span><small>الموعد</small><b>{dateText(detail.due_date)}</b></span><span><small>الأولوية</small><b>{priorities[detail.priority]}</b></span></div><div className="criteria"><b>معيار الاكتمال</b><p>{detail.acceptance_criteria||'يحدده قائد الفريق.'}</p></div><div className="resource-links">{safeUrl(detail.learning_url)&&<a href={safeUrl(detail.learning_url)} target="_blank" rel="noreferrer"><AppIcon name="video"/> افتح الشرح أو الفيديو</a>}{safeUrl(detail.repository_url||currentProject?.repository_url)&&<a href={safeUrl(detail.repository_url||currentProject?.repository_url)} target="_blank" rel="noreferrer"><AppIcon name="github"/> افتح {detail.repository_url?'ملف المهمة على GitHub':'مستودع المشروع على GitHub'}</a>}</div><div className="github-workflow"><b>الشغل على GitHub</b><p>اشتغل على فرع مستقل للمهمة. لما تخلص، افتح Pull Request والصق رابطه هنا للمراجعة.</p>{detail.assignee_id===profile.id?<><label>اسم الفرع<input value={detail.branch_name||''} onChange={e=>setDetail({...detail,branch_name:e.target.value})} placeholder="feature/task-name"/></label><label>رابط Pull Request<input type="url" value={detail.pull_request_url||''} onChange={e=>setDetail({...detail,pull_request_url:e.target.value})} placeholder="https://github.com/org/repo/pull/12"/></label></>:detail.branch_name&&<p>الفرع: <code>{detail.branch_name}</code></p>}</div>{isGithubPullRequest(detail.pull_request_url||'')&&<a className="pr-link" href={detail.pull_request_url} target="_blank" rel="noreferrer"><AppIcon name="github"/> فتح Pull Request</a>}{detail.review_feedback&&<div className="feedback"><b>ملاحظات المراجعة</b><p>{detail.review_feedback}</p></div>}{role==='leader'&&detail.status==='review'&&<label>ملاحظات المراجعة<textarea value={detail.review_feedback||''} onChange={e=>setDetail({...detail,review_feedback:e.target.value})}/></label>}{events.length>0&&<div className="task-history"><b>سجل المهمة</b><ul>{events.map(ev=><li key={ev.id}><span>{eventText(ev)}</span>{ev.note&&<p>{ev.note}</p>}<small>{ev.actor_name?`${ev.actor_name} · `:''}{historyDate.format(new Date(ev.created_at))}</small></li>)}</ul></div>}<div className="modal-actions">{detail.assignee_id===profile.id&&detail.status!=='done'&&detail.status!=='review'&&<button className="primary" onClick={()=>void memberSubmit(detail)}>{detail.status==='todo'?'ابدأ المهمة':'أرسل للمراجعة'}</button>}{role==='leader'&&detail.status==='review'&&<><button className="primary" onClick={()=>void leaderReview(detail,true)}><AppIcon name="check"/> قبول التسليم</button><button className="secondary" onClick={()=>void leaderReview(detail,false)}>طلب تعديل</button></>}<button className="secondary" onClick={()=>setDetail(null)}>إغلاق</button></div></div></div>}
    {toast&&<div className="toast"><AppIcon name="check"/>　{toast}</div>}
  </div>;
}

function AuthScreen({error,onSubmit,onSignUp,busy,inviteToken,inviteComplete}:{error:string;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onSignUp:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean;inviteToken:string;inviteComplete:string}){return <div className="auth-wrap"><form className="auth-card" onSubmit={inviteToken?onSignUp:onSubmit}><div className="brand-mark">ف</div><div className="overline">مساحة فريق نظام ERP</div><h1>{inviteToken?'انضم إلى الفريق':'سجّل دخولك'}</h1><p>{inviteToken?'أكمل إنشاء حسابك باستخدام البريد الذي وصلته الدعوة.':'استخدم الحساب الذي دعاك به قائد الفريق.'}</p>{inviteToken&&<><label>اسمك<input name="display_name" required autoComplete="name"/></label><label>الرقم الأكاديمي<input name="academic_number" required autoComplete="off"/></label></>}<label>البريد الإلكتروني<input type="email" name="email" required autoComplete="email"/></label><label>كلمة المرور<input type="password" name="password" required minLength={8} autoComplete={inviteToken?'new-password':'current-password'}/></label>{inviteComplete&&<p className="success-note">{inviteComplete}</p>}{error&&<p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy?'جارٍ التجهيز…':inviteToken?'إنشاء حساب العضو':'تسجيل الدخول'}</button></form></div>}
function profileDate(editedAt:string|null){const next=editedAt?new Date(new Date(editedAt).getTime()+30*24*60*60*1000):null;return next?new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(next):'';}
function profileLocked(editedAt:string|null){const next=editedAt?new Date(new Date(editedAt).getTime()+30*24*60*60*1000):null;return Boolean(next&&Date.now()<next.getTime());}
function ProfilePhotoEditor({profile,photoUrl,busy,onSave}:{profile:Profile;photoUrl:string;busy:boolean;onSave:(e:FormEvent<HTMLFormElement>,field:ProfileField,photoFile?:File)=>void}){
  const [photoFile,setPhotoFile]=useState<File|null>(null);const [showCooldown,setShowCooldown]=useState(false);const locked=profileLocked(profile.avatar_updated_at);const submit=(e:FormEvent<HTMLFormElement>)=>onSave(e,'avatar_path',photoFile||undefined);
  return <div className="profile-photo-editor"><div className="profile-photo profile-photo-large">{photoUrl?<img src={photoUrl} alt={`صورة ${profile.display_name}`}/>:profile.display_name.slice(0,1)}</div><div className="profile-photo-controls"><b>الصورة الشخصية <span className="required-mark">مطلوبة</span></b><small>JPG أو PNG أو WebP · حتى 5 ميجابايت</small><form onSubmit={submit}>{locked?<button type="button" className="secondary profile-save" onClick={()=>setShowCooldown(value=>!value)}>تغيير الصورة</button>:<><label className={`photo-picker ${busy?'disabled':''}`}>اختيار صورة<input type="file" accept="image/png,image/jpeg,image/webp" required={!profile.avatar_path} disabled={busy} onChange={e=>setPhotoFile(e.currentTarget.files?.[0]||null)}/></label>{photoFile&&<small className="selected-photo">{photoFile.name}</small>}<button className="secondary profile-save" disabled={busy||!photoFile}>{busy?'جارٍ الحفظ…':profile.avatar_path?'حفظ الصورة':'رفع الصورة'}</button></>}</form>{showCooldown&&<span className="profile-cooldown-tooltip" role="status">يمكن تغيير الصورة مرة واحدة كل 30 يومًا. متاح مجددًا في {profileDate(profile.avatar_updated_at)}.</span>}</div></div>;
}
function ProfileDetailsForm({profile,email,busy,onSave}:{profile:Profile;email:string;busy:boolean;onSave:(e:FormEvent<HTMLFormElement>,field:ProfileField,photoFile?:File)=>void}){
  const submit=(field:ProfileField)=>(e:FormEvent<HTMLFormElement>)=>onSave(e,field);
  const phoneLocked=profileLocked(profile.phone_updated_at);
  return <div className="profile-form profile-data-fields" key={`${profile.id}:${profile.display_name}:${profile.academic_number||''}:${profile.phone}:${profile.display_name_updated_at||''}:${profile.academic_number_updated_at||''}:${profile.phone_updated_at||''}`}>
    {profile.display_name.trim()?<section className="profile-field-card profile-name-field"><label>الاسم<input value={profile.display_name} readOnly/></label></section>:<section className="profile-field-card profile-name-field"><form onSubmit={submit('display_name')}><label>الاسم<input name="display_name" required defaultValue={profile.display_name} disabled={busy}/></label><p className="profile-edit-note">أضف اسمك لإكمال الملف.</p><button className="secondary profile-save" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ الاسم'}</button></form></section>}
    {profile.academic_number?.trim()?<section className="profile-field-card"><label>الرقم الأكاديمي<input value={profile.academic_number} readOnly/></label></section>:<section className="profile-field-card"><form onSubmit={submit('academic_number')}><label>الرقم الأكاديمي<input name="academic_number" required defaultValue="" autoComplete="off" disabled={busy}/></label><p className="profile-edit-note">أضف رقمك الأكاديمي لإكمال الملف.</p><button className="secondary profile-save" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ الرقم الأكاديمي'}</button></form></section>}
    <section className="profile-field-card"><label>البريد الإلكتروني<input readOnly value={email}/></label></section>
    <section className="profile-field-card"><form onSubmit={submit('phone')}><label>رقم التليفون<input name="phone" type="tel" defaultValue={profile.phone||''} autoComplete="tel" placeholder="اختياري" disabled={busy||phoneLocked}/></label><p className="profile-static-note">{phoneLocked?`متاح تعديله مجددًا ابتداءً من ${profileDate(profile.phone_updated_at)}.`:'تعديل التليفون لا يحتاج رسالة تأكيد.'}</p><button className="secondary profile-save" disabled={busy||phoneLocked}>{busy?'جارٍ الحفظ…':phoneLocked?`متاح بعد ${profileDate(profile.phone_updated_at)}`:'حفظ رقم التليفون'}</button></form></section>
  </div>;
}
function TaskAssigneePicker({profiles,profileId,selectedId}:{profiles:Profile[];profileId:string;selectedId:string}){
  const options=profiles.filter(p=>p.is_active||p.id===selectedId);
  const [selected,setSelected]=useState<string[]>([selectedId]);
  return <label className="task-assignee-picker">المسؤولون<select value="" onChange={event=>{const id=event.currentTarget.value;if(id&&!selected.includes(id))setSelected(previous=>[...previous,id]);}}><option value="" disabled>{selected.length?`تم اختيار ${selected.length} أعضاء`:'اختر عضوًا'}</option>{options.map(p=><option key={p.id} value={p.id} disabled={selected.includes(p.id)}>{p.id===profileId?`${p.display_name} (أنا)`:p.display_name}</option>)}</select>{selected.map(id=>{const member=options.find(p=>p.id===id);return member?<span className="assignee-chip" key={id}>{member.id===profileId?`${member.display_name} (أنا)`:member.display_name}<button type="button" aria-label={`إزالة ${member.display_name}`} onClick={()=>setSelected(previous=>previous.filter(value=>value!==id))}>×</button><input type="hidden" name="assignees" value={id}/></span>:null})}<small>اختر عضوًا من القائمة؛ يمكنك إضافة أكثر من مسؤول.</small></label>;
}

type IconName='overview'|'tasks'|'team'|'phases'|'projects'|'day'|'profile'|'add'|'github'|'logout'|'menu'|'google'|'telegram'|'check'|'clock'|'close'|'video';
function AppIcon({name}:{name:IconName}){
  if(name==='google')return <svg className="app-icon brand-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.5-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15.1Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4.1 2-6.8 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.9a12 12 0 0 1 0-7.7V15H5.9a20 20 0 0 0 0 17.9l6.9-5Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.9 15l6.9 5.2C14.4 15.5 18.8 12 24 12Z"/></svg>;
  if(name==='telegram')return <svg className="app-icon brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.8 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.6l-5-1.6C-.1 11.6-.1 10.8 1.5 10.2L20 3c.9-.3 2.2.2 1.8 1.3Z"/></svg>;
  if(name==='github')return <svg className="app-icon brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .8a11.2 11.2 0 0 0-3.5 21.8c.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.6-1.3-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 .1.7 2.1 3.8 1.5.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.6 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.1 1.2a10.8 10.8 0 0 1 5.7 0c2.1-1.5 3.1-1.2 3.1-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3 0 4.3-2.6 5.3-5.3 5.6.4.4.8 1 .8 2.1v3.1c0 .3.2.6.8.5A11.2 11.2 0 0 0 12 .8Z"/></svg>;
  const paths:Record<Exclude<IconName,'google'|'telegram'|'github'>,ReactNode>= {
    overview:<><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></>,
    tasks:<><path d="M9 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1"/><path d="M9 3h6v4H9zM8 12h8M8 16h8"/></>,
    team:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6v1"/></>,
    phases:<><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    projects:<><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 10h18"/></>,
    day:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h7"/></>,
    profile:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    add:<><path d="M12 5v14M5 12h14"/></>,
    logout:<><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    menu:<><path d="M4 6h16M4 12h16M4 18h16"/></>,
    check:<><path d="m5 12 4 4L19 6"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close:<path d="m6 6 12 12M18 6 6 18"/>,
    video:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></>,
  };
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name as Exclude<IconName,'google'|'telegram'|'github'>]}</svg>;
}
function Stat({title,value}:{title:string;value:number}){const icon:IconName=title==='المهام المفتوحة'?'tasks':title==='قيد التنفيذ'?'phases':title==='بانتظار المراجعة'?'clock':'check';return <div className="stat"><div className="stat-label"><span>{title}</span><i><AppIcon name={icon}/></i></div><strong>{value}</strong></div>}
function TaskList({tasks,onOpen,isLeader=false,onEdit,onDelete}:{tasks:Task[];onOpen:(t:Task)=>void;isLeader?:boolean;onEdit?:(t:Task)=>void;onDelete?:(t:Task)=>void}){if(!tasks.length)return <div className="empty">مفيش مهام هنا حاليًا. لما تتضاف مهمة هتظهر هنا.</div>;return <div className="task-list">{tasks.map(t=><article className="task-row" key={t.id}><button className="task-main" onClick={()=>onOpen(t)}><span className={`task-check ${t.status==='done'?'checked':''}`}>{t.status==='done'?<AppIcon name="check"/>:''}</span><span className="task-copy"><b>{t.title}</b><small>{t.assigneeName} <i>·</i> {dateText(t.due_date)}</small>{safeUrl(t.learning_url)&&<a className="task-video-badge" href={safeUrl(t.learning_url)} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}><AppIcon name="video"/> فيديو مرفق</a>}</span></button><span className={`badge ${statusTone[t.status]}`}>{statusNames[t.status]}</span>{isLeader&&<div className="task-actions"><button className="row-action" aria-label={`تعديل ${t.title}`} onClick={()=>onEdit?.(t)}>تعديل</button><button className="row-action danger-text" aria-label={`حذف ${t.title}`} onClick={()=>onDelete?.(t)}>حذف</button></div>}<button className="row-arrow" aria-label="تفاصيل المهمة" onClick={()=>onOpen(t)}>←</button></article>)}</div>}
function ProjectPhases({phases,tasks,large=false}:{phases:Phase[];tasks:Task[];large?:boolean}){const byPhase=new Map<string,Task[]>();for(const task of tasks){if(!task.phase_id)continue;const group=byPhase.get(task.phase_id)||[];group.push(task);byPhase.set(task.phase_id,group);}return <div className={`phase-list ${large?'large':''}`}>{phases.map((phase,i)=>{const group=byPhase.get(phase.id)||[];const done=group.reduce((count,task)=>count+(task.status==='done'?1:0),0);const pct=group.length?Math.round(done/group.length*100):0;return <div className="phase" key={phase.id}><div className="phase-top"><span className="phase-num">{String(i+1).padStart(2,'0')}</span><div className="phase-name"><b>{phase.name}</b><small>{group.length?`${group.length} مهام`:'جاهزة للتخطيط'}</small></div><strong>{pct}%</strong></div><div className="progress"><i style={{width:`${pct}%`}}/></div>{large&&group.map(t=><div className="phase-tasks" key={t.id}>{t.title}</div>)}</div>})}</div>}
function PhaseManager({phases,onEdit,onDelete,onMove}:{phases:Phase[];onEdit:(p:Phase)=>void;onDelete:(p:Phase)=>void;onMove:(p:Phase,delta:number)=>void}){if(!phases.length)return <div className="empty">لسه مفيش مراحل للمشروع.</div>;return <div className="phase-manager">{phases.map((phase,index)=><div className="phase-manage-row" key={phase.id}><span className="phase-num">{String(index+1).padStart(2,'0')}</span><b>{phase.name}</b><div className="phase-actions"><button aria-label="نقل المرحلة لأعلى" disabled={index===0} onClick={()=>onMove(phase,-1)}>↑</button><button aria-label="نقل المرحلة لأسفل" disabled={index===phases.length-1} onClick={()=>onMove(phase,1)}>↓</button><button onClick={()=>onEdit(phase)}>تعديل</button><button className="danger-text" onClick={()=>onDelete(phase)}>حذف</button></div></div>)}</div>}
function TeamSummary({people,tasks,photoUrls}:{people:Profile[];tasks:Task[];photoUrls:Record<string,string>}){const openByMember=new Map<string,number>();for(const task of tasks){if(task.status!=='done')openByMember.set(task.assignee_id,(openByMember.get(task.assignee_id)||0)+1);}return <div className="team-summary">{people.map((p,i)=>{const open=openByMember.get(p.id)||0;return <div className="member-line" key={p.id}><div className={`avatar color-${i%4}`}>{photoUrls[p.id]?<img src={photoUrls[p.id]} alt=""/>:p.display_name.slice(0,1)}</div><div className="member-info"><b>{p.display_name}</b><small>{open} مهام مفتوحة</small></div><div className="mini-progress"><i style={{width:`${Math.max(10,90-open*12)}%`}}/></div></div>})}</div>}
