
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function showToast(message, isError=false){
  let el=document.getElementById('toast');
  if(!el){
    el=document.createElement('div');
    el.id='toast';
    document.body.appendChild(el);
  }
  el.textContent=String(message||'');
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer=setTimeout(()=>el.classList.remove('show'),2600);
}
const todayISO = () => new Date().toISOString().slice(0,10);
const money = n => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(n);
const fmtDate = s => new Date(s+'T12:00:00').toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'});
const fmtTime = s => s.slice(0,5);

const defaultData = {
  staff:[
    {id:1,name:'Carlos Ramírez',short:'Carlos',role:'Barbero senior',present:true,status:'Disponible',services:[1,2,3]},
    {id:2,name:'Alex Ruiz',short:'Alex',role:'Barbero',present:true,status:'En servicio',services:[1,2,4]},
    {id:3,name:'Diego Ramos',short:'Diego',role:'Barbero',present:true,status:'Descanso',services:[1,3]},
    {id:4,name:'Luis Méndez',short:'Luis',role:'Barbero',present:false,status:'Ausente',services:[1,2]}
  ],
  services:[
    {id:1,name:'Corte',price:300,duration:45},
    {id:2,name:'Barba',price:180,duration:30},
    {id:3,name:'Corte + barba',price:450,duration:60},
    {id:4,name:'Diseño',price:120,duration:20}
  ],
  clients:[
    {id:1,name:'Juan Pérez',phone:'33 1111 2233',notes:'Prefiere fade bajo',favoriteStaff:1},
    {id:2,name:'Miguel Torres',phone:'33 4444 5566',notes:'Barba corta',favoriteStaff:2},
    {id:3,name:'Fernando González',phone:'33 7777 8899',notes:'Cliente frecuente',favoriteStaff:1},
    {id:4,name:'Luis Mendoza',phone:'33 2222 8899',notes:'Suele pedir por la tarde',favoriteStaff:1}
  ],
  appointments:[
    {id:1,date:todayISO(),time:'10:30',clientId:1,serviceId:3,staffId:1,status:'Confirmada',origin:'Recepción'},
    {id:2,date:todayISO(),time:'11:00',clientId:2,serviceId:2,staffId:2,status:'Confirmada',origin:'WhatsApp IA'},
    {id:3,date:todayISO(),time:'11:30',clientId:3,serviceId:1,staffId:1,status:'Pendiente',origin:'Llamada IA'},
    {id:4,date:todayISO(),time:'18:30',clientId:4,serviceId:1,staffId:1,status:'Confirmada',origin:'WhatsApp IA'}
  ],
  waits:[
    {id:1,clientId:2,serviceId:3,staffId:1,date:todayISO(),window:'17:00–20:00'}
  ],
  activity:[
    {type:'whatsapp',title:'WhatsApp · Luis Mendoza',text:'Solicitó corte con Carlos hoy por la tarde.',detail:'IA ofreció horarios disponibles',time:'10:21'},
    {type:'ai',title:'Cita creada automáticamente',text:'Corte · Carlos · 6:30 PM',detail:'Cliente confirmado por WhatsApp',time:'10:22'},
    {type:'phone',title:'Llamada · Cliente nuevo',text:'Solicita corte + barba para mañana.',detail:'Esperando preferencia de barbero',time:'10:24'}
  ],
  config:{agentName:'Sofía',greeting:'Gracias por comunicarte con Barbería Central. Soy Sofía, ¿en qué puedo ayudarte?',tone:'Amable y profesional',book:true,reschedule:true,cancel:true,prices:true,discount:false,minAdvance:30,holdMinutes:5,reminderHours:24}
};

const emptyCompanyData = () => ({
  clients: [],
  staff: [],
  services: [],
  appointments: [],
  waitlist: [],
  conversations: [],
  activity: [],
  checkEvents: []
});


let data = structuredClone(defaultData);

const defaultCompanies = [];
let companies = [];
let activeCompanyId = null;
let wizardStep = 1;

const API = localStorage.getItem('nexoApiUrl') || 'http://localhost:8000';
let authToken = localStorage.getItem('nexoToken') || '';
let sessionUser = null;

async function api(path, options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(authToken) headers.Authorization=`Bearer ${authToken}`;
  const res=await fetch(API+path,{...options,headers});
  let payload={};
  try{payload=await res.json()}catch{}
  if(!res.ok){
    let message=`Error ${res.status}`;
    if(typeof payload.detail==='string') message=payload.detail;
    else if(Array.isArray(payload.detail)){
      message=payload.detail.map(x=>{
        const field=Array.isArray(x.loc)?x.loc[x.loc.length-1]:'campo';
        return `${field}: ${x.msg}`;
      }).join(' · ');
    }
    throw new Error(message);
  }
  return payload;
}
function companyStoreKey(){ return `nexoCompanyData:${activeCompanyId||'none'}`; }
function loadCompanyLocalData(){
  const raw=localStorage.getItem(companyStoreKey());
  data=raw?JSON.parse(raw):emptyCompanyData();
  data.staff.forEach(s=>{ if(!s.schedule) s.schedule=defaultWeeklySchedule(); if(!Array.isArray(s.blocks)) s.blocks=[]; });
}
function saveCompanyLocalData(){ if(activeCompanyId) localStorage.setItem(companyStoreKey(),JSON.stringify(data)); }


let agendaDate = todayISO();
let currentClientId = null;
let currentConversation = 0;

const defaultWeeklySchedule = () => ({
  0:{working:true,start:'10:00',end:'20:00'},
  1:{working:true,start:'10:00',end:'20:00'},
  2:{working:true,start:'10:00',end:'20:00'},
  3:{working:true,start:'10:00',end:'20:00'},
  4:{working:true,start:'10:00',end:'20:00'},
  5:{working:true,start:'10:00',end:'18:00'},
  6:{working:false,start:'10:00',end:'18:00'}
});
data.staff.forEach(s=>{ if(!s.schedule) s.schedule=defaultWeeklySchedule(); if(!Array.isArray(s.blocks)) s.blocks=[]; });
const minutesOf = value => { const [h,m]=String(value).slice(0,5).split(':').map(Number); return h*60+m; };
const timeOfMinutes = mins => `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
const weekdayMon0 = dateStr => (new Date(dateStr+'T12:00:00').getDay()+6)%7;
const activeCompany = () => companies.find(c=>c.id===activeCompanyId)||companies[0];
function staffScheduleFor(staff,date){ const day=weekdayMon0(date); return staff.schedule?.[day] || {working:true,start:activeCompany()?.open||'10:00',end:activeCompany()?.close||'20:00'}; }
function staffBlocksFor(staff,date){ return (staff.blocks||[]).filter(b=>b.date===date); }
function appointmentEndMinutes(app){ const service=idBy(data.services,app.serviceId); return minutesOf(app.time)+(service?.duration||30); }
function overlaps(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && aEnd > bStart; }
function checkSlot(staffId,serviceId,date,time,ignoreAppointmentId=null){
  const staff=idBy(data.staff,staffId), service=idBy(data.services,serviceId);
  if(!staff||!service) return {ok:false,reason:'Datos incompletos'};
  const schedule=staffScheduleFor(staff,date);
  if(!schedule.working) return {ok:false,reason:`${staff.short} no trabaja ese día`};
  const start=minutesOf(time), end=start+service.duration;
  if(start < minutesOf(schedule.start) || end > minutesOf(schedule.end)) return {ok:false,reason:`Fuera del horario de ${staff.short} (${schedule.start}–${schedule.end})`};
  const block=staffBlocksFor(staff,date).find(b=>overlaps(start,end,minutesOf(b.start),minutesOf(b.end)));
  if(block) return {ok:false,reason:`Coincide con ${block.type.toLowerCase()} (${block.start}–${block.end})`};
  const clash=data.appointments.find(a=>a.id!==ignoreAppointmentId && a.staffId===staffId && a.date===date && a.status!=='Cancelada' && overlaps(start,end,minutesOf(a.time),appointmentEndMinutes(a)));
  if(clash) return {ok:false,reason:`Se empalma con una cita de ${clash.time}`};
  return {ok:true,end:timeOfMinutes(end)};
}


function save(){ saveCompanyLocalData(); renderAll(); }

function canView(id){
  if(!sessionUser) return false;
  if(sessionUser.is_platform_admin) return true;
  if(id==='empresas' || id==='usuarios') return false;
  const membership=(sessionUser.companies||[]).find(c=>c.id===activeCompanyId);
  return !!membership && (membership.permissions||[]).includes(id);
}

function showView(id){
  if(!canView(id)){
    showToast('No tienes permiso para este módulo');
    return;
  }
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$('#'+id);
  if(!target){
    showToast('Módulo no encontrado');
    return;
  }
  target.classList.add('active');
  $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  if($('#pageTitle')) $('#pageTitle').textContent=names[id]||id;

  const c=activeCompany();
  if($('#pageSubtitle')){
    $('#pageSubtitle').textContent=sessionUser?.is_platform_admin
      ? (c ? `${c.name} · Administrador general` : 'Administrador general')
      : (c ? c.name : 'Mi empresa');
  }

  // Acciones superiores según el módulo.
  const appointmentViews=['dashboard','agenda','disponibilidad','citas'];
  const checkinViews=['dashboard','agenda','personal'];
  $$('.context-appointment').forEach(el=>el.style.display=appointmentViews.includes(id)?'':'none');
  $$('.context-checkin').forEach(el=>el.style.display=checkinViews.includes(id)?'':'none');

  if(id==='usuarios' && sessionUser?.is_platform_admin){
    renderAdminUsers().catch(err=>showToast(err.message,true));
  }
  if(id==='agenda') populateAgendaStaffFilter();
}

$$('.nav-item[data-view]').forEach(n=>n.onclick=()=>showView(n.dataset.view));
$$('[data-view-jump]').forEach(n=>n.onclick=()=>showView(n.dataset.viewJump));
$('#collapseBtn').onclick=()=>$('#sidebar').classList.toggle('collapsed');
$('#themeBtn').onclick=()=>document.body.classList.toggle('dark');

function renderDashboard(){
  const apps=data.appointments.filter(a=>a.date===todayISO() && a.status!=='Cancelada');
  const conf=apps.filter(a=>a.status==='Confirmada').length;
  const pending=apps.filter(a=>a.status==='Pendiente').length;
  const present=data.staff.filter(s=>s.present).length;
  const avail=data.staff.filter(s=>s.present && s.status==='Disponible').length;
  const sales=apps.reduce((sum,a)=>sum+(idBy(data.services,a.serviceId)?.price||0),0);
  $('#statToday').textContent=apps.length; $('#statTodaySub').textContent=`${apps.length} activas hoy`;
  $('#statConfirmed').textContent=conf; $('#statConfirmedPct').textContent=apps.length?Math.round(conf/apps.length*100)+'%':'0%';
  $('#statPending').textContent=`${pending} pendientes`; $('#statStaff').textContent=`${present}/${data.staff.length}`;
  $('#statAvailable').textContent=`${avail} disponibles`; $('#statSales').textContent=money(sales);

  $('#activityList').innerHTML=data.activity.slice(0,5).map(a=>`
    <div class="activity"><div class="channel ${a.type==='whatsapp'?'whatsapp':a.type==='phone'?'phone':'ai'}">${a.type==='whatsapp'?'W':a.type==='phone'?'☎':'✦'}</div>
    <div><strong>${a.title}</strong><p>${a.text}</p><small>${a.detail}</small></div><span>${a.time}</span></div>`).join('');

  $('#staffList').innerHTML=data.staff.map(s=>`
    <div class="staff"><div class="avatar">${s.short.slice(0,2).toUpperCase()}</div><div><strong>${s.short}</strong><small>${s.present?'En sucursal':'Sin checada'}</small></div>
    <b class="status ${s.status==='Disponible'?'green':s.status==='En servicio'?'blue':s.status==='Descanso'?'amber':'red'}">${s.status}</b></div>`).join('');

  const next=[...apps].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,4);
  $('#nextAppointments').innerHTML=next.length?next.map(a=>{
    const c=idBy(data.clients,a.clientId), s=idBy(data.services,a.serviceId), st=idBy(data.staff,a.staffId);
    return `<div><time>${fmtTime(a.time)}</time><span><strong>${c?.name||'Cliente'}</strong><small>${s?.name||''} · ${st?.short||''}</small></span><b class="${a.status==='Pendiente'?'pending':''}">${a.status}</b></div>`
  }).join(''):'<p class="muted">Sin citas próximas.</p>';
}

function renderCalendar(){
  $('#agendaDateLabel').textContent=new Date(agendaDate+'T12:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
  const filterId=Number($('#agendaStaffFilter')?.value||0);
  const staffList=data.staff.filter(s=>!filterId||s.id===filterId);
  let html=`<div class="cal-head"><div>Hora</div>${staffList.map(s=>`<div>${s.short} ${s.present?'🟢':'🔴'}</div>`).join('')}</div>`;
  for(let h=9;h<=20;h++){
    html+=`<div class="cal-row"><time>${String(h).padStart(2,'0')}:00</time>`;
    for(const st of staffList){
      const hourStart=h*60, hourEnd=(h+1)*60, schedule=staffScheduleFor(st,agendaDate);
      const apps=data.appointments.filter(a=>a.date===agendaDate && a.staffId===st.id && Number(a.time.slice(0,2))===h && a.status!=='Cancelada');
      const block=staffBlocksFor(st,agendaDate).find(b=>overlaps(hourStart,hourEnd,minutesOf(b.start),minutesOf(b.end)));
      if(!schedule.working || hourEnd<=minutesOf(schedule.start) || hourStart>=minutesOf(schedule.end)) html+=`<div class="blocked">Fuera de horario</div>`;
      else if(block) html+=`<div class="blocked amberbg">${block.type}<br><small>${block.start}–${block.end}</small></div>`;
      else if(!st.present && agendaDate===todayISO()) html+=`<div class="blocked">No ha checado</div>`;
      else if(apps.length){ const a=apps[0],c=idBy(data.clients,a.clientId),sv=idBy(data.services,a.serviceId); html+=`<div class="appt bluecard">${sv?.name}<br><small>${c?.name} · ${a.time}</small></div>`; }
      else html+=`<button class="calendar-free calendar-slot" onclick="openAgendaSlot(${st.id},'${String(h).padStart(2,'0')}:00')">Disponible</button>`;
    }
    html+='</div>';
  }
  $('#calendar').innerHTML=html;
}

function populateAgendaStaffFilter(){
  const select=$('#agendaStaffFilter');
  if(!select) return;
  const previous=select.value;
  select.innerHTML='<option value="">Todo el personal</option>'+data.staff.map(s=>`<option value="${s.id}">${s.short}</option>`).join('');
  select.value=previous;
}
$('#agendaStaffFilter')?.addEventListener('change',renderCalendar);
window.openAgendaSlot=(staffId,time)=>{
  populateAppointmentModal();
  $('#apptStaff').value=String(staffId);
  $('#apptDate').value=agendaDate;
  $('#apptTime').value=time;
  $('#appointmentModal').classList.add('show');
};

$('#prevDay').onclick=()=>{const d=new Date(agendaDate+'T12:00:00'); d.setDate(d.getDate()-1); agendaDate=d.toISOString().slice(0,10); renderCalendar()};
$('#nextDay').onclick=()=>{const d=new Date(agendaDate+'T12:00:00'); d.setDate(d.getDate()+1); agendaDate=d.toISOString().slice(0,10); renderCalendar()};
$('#todayBtn').onclick=()=>{agendaDate=todayISO();renderCalendar()};

function renderAppointments(){
  const filter=$('#appointmentFilter')?.value||'all';
  const rows=data.appointments.filter(a=>filter==='all'||a.status===filter).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  $('#appointmentsTable').innerHTML=rows.map(a=>{
    const c=idBy(data.clients,a.clientId), sv=idBy(data.services,a.serviceId), st=idBy(data.staff,a.staffId);
    const cl=a.status.toLowerCase().replaceAll(' ','-').replace('confirmada','confirmada').replace('pendiente','pendiente').replace('cancelada','cancelada');
    return `<tr><td>${fmtDate(a.date)}</td><td>${a.time}</td><td>${c?.name}</td><td>${sv?.name}</td><td>${st?.short}</td><td><span class="badge ${cl}">${a.status}</span></td>
    <td><button class="btn secondary" onclick="setStatus(${a.id},'Confirmada')">Confirmar</button><button class="btn secondary" onclick="openReschedule(${a.id})">Mover</button><button class="btn secondary" onclick="setStatus(${a.id},'Cancelada')">Cancelar</button></td></tr>`;
  }).join('');
}
$('#appointmentFilter').onchange=renderAppointments;
window.setStatus=(id,status)=>{const a=idBy(data.appointments,id); if(a){a.status=status; data.activity.unshift({type:'ai',title:`Cita ${status.toLowerCase()}`,text:`Actualización manual de la cita #${id}`,detail:'Agenda sincronizada',time:new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}); save(); showToast('Estado actualizado');}}
window.openReschedule=(id)=>{const a=idBy(data.appointments,id); $('#rescheduleId').value=id; $('#rescheduleDate').value=a.date; $('#rescheduleTime').value=a.time; $('#rescheduleModal').classList.add('show');}
$('#saveReschedule').onclick=()=>{
  const a=idBy(data.appointments,$('#rescheduleId').value), date=$('#rescheduleDate').value, time=$('#rescheduleTime').value;
  const validation=checkSlot(a.staffId,a.serviceId,date,time,a.id);
  if(!validation.ok){showToast(validation.reason);return}
  a.date=date; a.time=time; $('#rescheduleModal').classList.remove('show'); save(); showToast('Cita reprogramada');
}

function renderClients(){
  const q=($('#clientSearch')?.value||'').toLowerCase();
  const list=data.clients.filter(c=>(c.name+c.phone).toLowerCase().includes(q));
  $('#clientList').innerHTML=list.map(c=>`<button class="client-row ${currentClientId===c.id?'active':''}" onclick="selectClient(${c.id})"><div class="avatar">${c.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><strong>${c.name}</strong><small>${c.phone}</small></div><b>${data.appointments.filter(a=>a.clientId===c.id).length} citas</b></button>`).join('');
  if(currentClientId) renderClientDetail(currentClientId);
}
$('#clientSearch').oninput=renderClients;
window.selectClient=id=>{currentClientId=id;renderClients();};
function renderClientDetail(id){
  const c=idBy(data.clients,id), fav=idBy(data.staff,c.favoriteStaff);
  const hist=data.appointments.filter(a=>a.clientId===id).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  $('#clientDetail').innerHTML=`<div class="client-detail-head"><div class="avatar">${c.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><h2 style="margin:0">${c.name}</h2><p class="muted">${c.phone}</p></div></div>
    <div class="detail-grid"><div class="detail-box"><small>Barbero preferido</small><strong>${fav?.short||'Sin definir'}</strong></div><div class="detail-box"><small>Total de citas</small><strong>${hist.length}</strong></div><div class="detail-box"><small>Notas</small><strong>${c.notes||'—'}</strong></div></div>
    <div class="history"><h3>Historial</h3>${hist.length?hist.map(a=>`<div class="history-item"><span>${fmtDate(a.date)}</span><span>${idBy(data.services,a.serviceId)?.name} · ${idBy(data.staff,a.staffId)?.short}</span><b>${a.status}</b></div>`).join(''):'<p class="muted">Sin historial.</p>'}</div>`;
}

function renderStaff(){
  $('#peopleGrid').innerHTML=data.staff.map(s=>{
    const todaySchedule=staffScheduleFor(s,todayISO());
    return `<article class="person-card"><div class="avatar big ${s.present?'':'muted'}">${s.short.slice(0,2).toUpperCase()}</div><h3>${s.name}</h3><p>${s.role}</p><b class="status ${s.status==='Disponible'?'green':s.status==='En servicio'?'blue':s.status==='Descanso'?'amber':'red'}">${s.status}</b><hr><small>Servicios</small><p>${s.services.map(id=>idBy(data.services,id)?.name).filter(Boolean).join(' · ')}</p><div class="staff-work-info"><small>Horario de hoy</small><strong>${todaySchedule.working?`${todaySchedule.start}–${todaySchedule.end}`:'Día libre'}</strong></div><div class="person-actions stacked-actions"><button class="btn secondary" onclick="cycleStaff(${s.id})">Cambiar estado</button><button class="btn secondary" onclick="editStaff(${s.id})">Editar</button><button class="btn secondary" onclick="openSchedule(${s.id})">Horario</button><button class="btn secondary" onclick="openBlocks(${s.id})">Descansos / bloqueos</button></div></article>`
  }).join('');
}
window.cycleStaff=id=>{const s=idBy(data.staff,id); const states=['Disponible','En servicio','Descanso']; if(!s.present){s.present=true;s.status='Disponible'}else{s.status=states[(states.indexOf(s.status)+1)%states.length]} save();};

function renderServices(){
  if(!data.services.length){
    $('#serviceList').innerHTML=`<div class="empty-state service-empty-state">
      <strong>No hay servicios creados todavía.</strong>
      <span>Agrega el primer servicio para comenzar a asignarlo al personal y recibir citas.</span>
    </div>`;
    return;
  }
  $('#serviceGrid').innerHTML=data.services.map(s=>`<div class="service-card"><h3>${s.name}</h3><p>${s.duration} min</p><p>Personal: ${data.staff.filter(st=>st.services.includes(s.id)).map(st=>st.short).join(', ')||'Sin asignar'}</p><div class="price">${money(s.price)}</div></div>`).join('');

}

const conversations=[
  {name:'Luis Mendoza',meta:'WhatsApp · Cliente frecuente',msgs:[['client','Hola, quiero corte con Carlos hoy después de las 5.'],['bot','Claro. Carlos tiene disponibles 5:00, 6:30 y 7:15 PM. ¿Cuál te funciona mejor?'],['client','6:30'],['bot','Perfecto. Te reservo corte con Carlos hoy a las 6:30 PM. ¿Confirmo?'],['client','Sí'],['bot successmsg','✓ Cita creada y confirmada.']],actions:[['Servicio detectado','Corte'],['Empleado solicitado','Carlos'],['Horario elegido','18:30'],['Resultado','✓ Cita confirmada']]},
  {name:'Cliente nuevo',meta:'Llamada · Sin ficha',msgs:[['client','Quiero cita mañana.'],['bot','Con gusto. ¿Qué servicio necesitas?'],['client','Corte y barba.'],['bot','Perfecto. ¿Tienes preferencia de barbero?']],actions:[['Servicio detectado','Corte + barba'],['Fecha','Mañana'],['Falta','Preferencia de barbero']]},
  {name:'Mariana López',meta:'WhatsApp · Cliente',msgs:[['client','Necesito reprogramar mi cita.'],['bot','Claro. Puedo ayudarte. ¿Qué horario te conviene?']],actions:[['Intención','Reprogramar'],['Estado','Esperando horario']]}
];
function renderIA(){
  $('#conversationList').innerHTML=conversations.map((c,i)=>`<button class="conv ${i===currentConversation?'active':''}" onclick="selectConversation(${i})"><span class="channel ${i===1?'phone':'whatsapp'}">${i===1?'☎':'W'}</span><div><strong>${c.name}</strong><small>${c.msgs.at(-1)[1].slice(0,30)}...</small></div><time>${['10:21','10:24','10:31'][i]}</time></button>`).join('');
  const c=conversations[currentConversation]; $('#chatName').textContent=c.name; $('#chatMeta').textContent=c.meta;
  $('#messages').innerHTML=c.msgs.map(m=>`<div class="msg ${m[0]}">${m[1]}</div>`).join('');
  $('#aiActions').innerHTML=c.actions.map((a,i)=>`<div class="action-card ${i===c.actions.length-1?'successbox':''}"><small>${a[0]}</small><strong>${a[1]}</strong></div>`).join('');
}
window.selectConversation=i=>{currentConversation=i;renderIA();}
$('#sendOperator').onclick=()=>{const v=$('#operatorMessage').value.trim(); if(!v)return; conversations[currentConversation].msgs.push(['client',v]); $('#operatorMessage').value=''; renderIA();};
$('#takeConversation').onclick=()=>showToast('Conversación tomada por operador');

function renderWait(){
  $('#waitList').innerHTML=data.waits.length?data.waits.map(w=>{const c=idBy(data.clients,w.clientId),sv=idBy(data.services,w.serviceId),st=idBy(data.staff,w.staffId);return `<div class="wait-item"><div><small>Cliente</small><strong>${c?.name}</strong></div><div><small>Busca</small><strong>${sv?.name} con ${st?.short}</strong></div><div><small>Horario</small><strong>${fmtDate(w.date)} · ${w.window}</strong></div><button class="btn secondary" onclick="removeWait(${w.id})">Quitar</button></div>`}).join(''):'<p class="muted">La lista está vacía.</p>';
}
window.removeWait=id=>{data.waits=data.waits.filter(w=>w.id!==id);save();}

function renderReports(){
  $('#reportIA').textContent=data.appointments.filter(a=>a.origin.includes('IA')).length;
  $('#reportNoShow').textContent=data.appointments.filter(a=>a.status==='No asistió').length;
  $('#reportRevenue').textContent=money(data.appointments.filter(a=>a.status!=='Cancelada').reduce((s,a)=>s+(idBy(data.services,a.serviceId)?.price||0),0));
  const origins=['Recepción','WhatsApp IA','Llamada IA','Web']; const counts=origins.map(o=>[o,data.appointments.filter(a=>a.origin===o).length]); const max=Math.max(1,...counts.map(x=>x[1]));
  $('#originBars').innerHTML=counts.map(([o,n])=>`<div class="bar-row"><span>${o}</span><div class="bar-track"><div class="bar-fill" style="width:${n/max*100}%"></div></div><b>${n}</b></div>`).join('');
}

function renderConfig(){
  const c=data.config; $('#agentName').value=c.agentName; $('#agentGreeting').value=c.greeting; $('#agentTone').value=c.tone; $('#permBook').checked=c.book; $('#permReschedule').checked=c.reschedule; $('#permCancel').checked=c.cancel; $('#permPrices').checked=c.prices; $('#permDiscount').checked=c.discount; $('#minAdvance').value=c.minAdvance; $('#holdMinutes').value=c.holdMinutes; $('#reminderHours').value=c.reminderHours;
}
$('#saveConfig').onclick=()=>{data.config={agentName:$('#agentName').value,greeting:$('#agentGreeting').value,tone:$('#agentTone').value,book:$('#permBook').checked,reschedule:$('#permReschedule').checked,cancel:$('#permCancel').checked,prices:$('#permPrices').checked,discount:$('#permDiscount').checked,minAdvance:+$('#minAdvance').value,holdMinutes:+$('#holdMinutes').value,reminderHours:+$('#reminderHours').value}; save(); showToast('Configuración guardada');}

function populateAppointmentModal(){
  $('#apptClient').innerHTML=data.clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  $('#apptService').innerHTML=data.services.map(s=>`<option value="${s.id}">${s.name} · ${s.duration} min</option>`).join('');
  $('#apptStaff').innerHTML=data.staff.map(s=>`<option value="${s.id}">${s.short}</option>`).join('');
  $('#apptDate').value=todayISO(); $('#apptTime').value='18:30';
}
$('#newAppointmentBtn').onclick=()=>{populateAppointmentModal();$('#appointmentModal').classList.add('show')};
$$('.close-modal').forEach(b=>b.onclick=()=>$('#appointmentModal').classList.remove('show'));
$$('.close-reschedule').forEach(b=>b.onclick=()=>$('#rescheduleModal').classList.remove('show'));
$('#saveAppointment').onclick=()=>{
  const app={id:Date.now(),date:$('#apptDate').value,time:$('#apptTime').value,clientId:+$('#apptClient').value,serviceId:+$('#apptService').value,staffId:+$('#apptStaff').value,status:'Confirmada',origin:$('#apptOrigin').value};
  const validation=checkSlot(app.staffId,app.serviceId,app.date,app.time);
  if(!validation.ok){showToast(validation.reason);return}
  data.appointments.push(app);
  data.activity.unshift({type:'ai',title:'Nueva cita registrada',text:`${idBy(data.services,app.serviceId)?.name} · ${idBy(data.staff,app.staffId)?.short} · ${app.time}`,detail:`Disponible hasta ${validation.end} · Origen: ${app.origin}`,time:new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})});
  $('#appointmentModal').classList.remove('show'); save(); showToast('Cita creada correctamente ✓');
};

$('#checkinBtn').onclick=()=>{$('#checkinModal').classList.add('show');renderChecker()};
$$('.close-checkin').forEach(b=>b.onclick=()=>$('#checkinModal').classList.remove('show'));
function renderChecker(){
  $('#checkerList').innerHTML=data.staff.map(s=>`<button class="check-person ${s.present?'':'absent'}" onclick="toggleCheck(${s.id})"><span>${s.short.slice(0,2).toUpperCase()}</span><div><strong>${s.short}</strong><small>${s.present?'Presente':'No ha checado'}</small></div><b>${s.present?'Registrar salida':'Registrar entrada'}</b></button>`).join('');
}
window.toggleCheck=id=>{const s=idBy(data.staff,id);s.present=!s.present;s.status=s.present?'Disponible':'Ausente';save();renderChecker();showToast(s.present?'Entrada registrada':'Salida registrada');}

$('#newServiceBtn').onclick=()=>$('#serviceModal').classList.add('show');
$$('.close-service').forEach(b=>b.onclick=()=>$('#serviceModal').classList.remove('show'));
$('#saveService').onclick=()=>{const name=$('#serviceName').value.trim();if(!name)return;data.services.push({id:Date.now(),name,price:+$('#servicePrice').value||0,duration:+$('#serviceDuration').value||30});$('#serviceModal').classList.remove('show');save();showToast('Servicio creado');};

$('#newClientBtn').onclick=()=>$('#clientModal').classList.add('show');
$$('.close-client').forEach(b=>b.onclick=()=>$('#clientModal').classList.remove('show'));
$('#saveClient').onclick=()=>{const name=$('#clientName').value.trim();if(!name)return;data.clients.push({id:Date.now(),name,phone:$('#clientPhone').value,notes:$('#clientNotes').value,favoriteStaff:null});$('#clientModal').classList.remove('show');save();showToast('Cliente creado');};

$('#newWaitBtn').onclick=()=>{const c=data.clients[0],sv=data.services[0],st=data.staff[0];data.waits.push({id:Date.now(),clientId:c.id,serviceId:sv.id,staffId:st.id,date:todayISO(),window:'17:00–20:00'});save();showToast('Agregado a lista de espera');};




let editingStaffId=null;

function renderStaffServiceChecks(selected=[]){
  if(!data.services.length){
    $('#staffServiceChecks').innerHTML=`
      <div class="services-empty-note">
        <strong>Aún no hay servicios creados.</strong>
        <span>Primero agrégalos en el módulo Servicios y después podrás asignarlos al personal.</span>
        <button class="btn secondary" type="button" id="goToServicesFromStaff">Ir a Servicios</button>
      </div>`;
    $('#goToServicesFromStaff')?.addEventListener('click',()=>{
      $('#staffModal').classList.remove('show');
      showView('servicios');
    });
    return;
  }
  $('#staffServiceChecks').innerHTML=data.services.map(s=>`
    <label class="perm-check">
      <input type="checkbox" value="${s.id}" ${selected.includes(s.id)?'checked':''}>
      <span>${s.name}</span>
    </label>`).join('');
}

$('#newStaffBtn')?.addEventListener('click',()=>{
  editingStaffId=null;
  $('#staffModalTitle').textContent='Agregar personal';
  $('#staffEditId').value='';
  $('#staffName').value='';
  $('#staffAlias').value='';
  $('#staffRole').value='';
  $('#staffInitialStatus').value='Disponible';
  $('#staffFormError').textContent='';
  renderStaffServiceChecks([]);
  $('#staffModal').classList.add('show');
});

window.editStaff=id=>{
  const s=idBy(data.staff,id);
  if(!s) return;
  editingStaffId=id;
  $('#staffModalTitle').textContent='Editar personal';
  $('#staffEditId').value=id;
  $('#staffName').value=s.name;
  $('#staffAlias').value=s.short;
  $('#staffRole').value=s.role;
  $('#staffInitialStatus').value=s.present?'Disponible':'Ausente';
  $('#staffFormError').textContent='';
  renderStaffServiceChecks(s.services||[]);
  $('#staffModal').classList.add('show');
};

$$('.close-staff').forEach(b=>b.addEventListener('click',()=>$('#staffModal').classList.remove('show')));

$('#staffForm')?.addEventListener('submit',ev=>{
  ev.preventDefault();
  const name=$('#staffName').value.trim();
  const short=$('#staffAlias').value.trim();
  const role=$('#staffRole').value.trim();
  const services=$$('#staffServiceChecks input:checked').map(x=>Number(x.value));
  if(name.length<2 || short.length<2 || role.length<2){
    $('#staffFormError').textContent='Completa nombre, alias y puesto.';
    return;
  }
  const status=$('#staffInitialStatus').value;
  if(editingStaffId){
    const s=idBy(data.staff,editingStaffId);
    Object.assign(s,{name,short,role,services,present:status!=='Ausente',status});
  }else{
    data.staff.push({
      id:Date.now(),name,short,role,services,
      present:status!=='Ausente',status,
      schedule:defaultWeeklySchedule(),blocks:[]
    });
  }
  $('#staffModal').classList.remove('show');
  save();
  populateAgendaStaffFilter();
  showToast(editingStaffId?'Personal actualizado ✓':'Personal agregado ✓');
});

const weekLabels=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
let editingScheduleStaffId=null;
window.openSchedule=id=>{
  editingScheduleStaffId=id; const s=idBy(data.staff,id); $('#scheduleStaffName').textContent=s.name;
  $('#scheduleEditor').innerHTML=weekLabels.map((label,day)=>{const sc=s.schedule?.[day]||defaultWeeklySchedule()[day];return `<div class="schedule-row"><div><strong>${label}</strong><small>${sc.working?'Trabaja':'Descanso'}</small></div><label class="schedule-working"><input type="checkbox" id="workDay${day}" ${sc.working?'checked':''}> Trabaja</label><input type="time" id="scheduleStart${day}" value="${sc.start}"><span>—</span><input type="time" id="scheduleEnd${day}" value="${sc.end}"></div>`}).join('');
  $('#scheduleModal').classList.add('show');
};
$$('.close-schedule').forEach(b=>b.onclick=()=>$('#scheduleModal').classList.remove('show'));
$('#saveSchedule').onclick=()=>{const s=idBy(data.staff,editingScheduleStaffId);for(let day=0;day<7;day++)s.schedule[day]={working:$('#workDay'+day).checked,start:$('#scheduleStart'+day).value,end:$('#scheduleEnd'+day).value};$('#scheduleModal').classList.remove('show');save();showToast('Horario actualizado');};

window.openBlocks=id=>{const s=idBy(data.staff,id);$('#blockStaffId').value=id;$('#blockStaffName').textContent=s.name;$('#blockDate').value=todayISO();$('#blockModal').classList.add('show');renderBlockList();};
$$('.close-block').forEach(b=>b.onclick=()=>$('#blockModal').classList.remove('show'));
function renderBlockList(){const s=idBy(data.staff,$('#blockStaffId').value);const blocks=[...(s?.blocks||[])].sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));$('#blockList').innerHTML=blocks.length?blocks.map(b=>`<div class="block-item"><div><strong>${b.type}</strong><small>${fmtDate(b.date)} · ${b.start}–${b.end}${b.note?` · ${b.note}`:''}</small></div><button class="btn secondary" onclick="removeBlock(${s.id},${b.id})">Quitar</button></div>`).join(''):'<div class="empty-mini">Sin bloqueos registrados.</div>';}
$('#saveBlock').onclick=()=>{const s=idBy(data.staff,$('#blockStaffId').value),date=$('#blockDate').value,start=$('#blockStart').value,end=$('#blockEnd').value;if(!date||!start||!end){showToast('Completa fecha e intervalo');return}if(minutesOf(end)<=minutesOf(start)){showToast('La hora final debe ser posterior');return}s.blocks.push({id:Date.now(),date,start,end,type:$('#blockType').value,note:$('#blockNote').value.trim()});$('#blockNote').value='';save();$('#blockModal').classList.add('show');renderBlockList();showToast('Bloqueo agregado');};
window.removeBlock=(staffId,blockId)=>{const s=idBy(data.staff,staffId);s.blocks=s.blocks.filter(b=>b.id!==blockId);save();$('#blockModal').classList.add('show');$('#blockStaffId').value=staffId;renderBlockList();showToast('Bloqueo eliminado');};

function populateAvailability(){
  if(!$('#availabilityService'))return;
  $('#availabilityService').innerHTML=data.services.map(s=>`<option value="${s.id}">${s.name} · ${s.duration} min</option>`).join('');
  $('#availabilityStaff').innerHTML='<option value="">Cualquiera disponible</option>'+data.staff.map(s=>`<option value="${s.id}">${s.short}</option>`).join('');
  if(!$('#availabilityDate').value)$('#availabilityDate').value=todayISO();
  const c=activeCompany(); if(c){$('#availabilityFrom').value=c.open||'09:00';$('#availabilityTo').value=c.close||'20:00';}
}
$('#searchAvailabilityBtn').onclick=()=>{
  const serviceId=+$('#availabilityService').value,selectedStaff=$('#availabilityStaff').value?+$('#availabilityStaff').value:null,date=$('#availabilityDate').value,from=minutesOf($('#availabilityFrom').value),to=minutesOf($('#availabilityTo').value),service=idBy(data.services,serviceId),candidates=data.staff.filter(s=>!selectedStaff||s.id===selectedStaff),results=[];
  for(const s of candidates){const schedule=staffScheduleFor(s,date);if(!schedule.working){results.push({staff:s,slots:[]});continue}const start=Math.max(from,minutesOf(schedule.start)),finish=Math.min(to,minutesOf(schedule.end)),slots=[];for(let t=start;t+service.duration<=finish;t+=15){const time=timeOfMinutes(t),check=checkSlot(s.id,serviceId,date,time);if(check.ok)slots.push({start:time,end:check.end});}results.push({staff:s,slots});}
  $('#availabilitySummary').textContent=`${service?.name||'Servicio'} · ${fmtDate(date)} · duración ${service?.duration||0} min`;
  $('#availabilityResults').innerHTML=results.map(r=>`<div class="availability-person"><div class="availability-person-head"><div><strong>${r.staff.name}</strong><small>${staffScheduleFor(r.staff,date).working?`${staffScheduleFor(r.staff,date).start}–${staffScheduleFor(r.staff,date).end}`:'Día libre'}</small></div><span class="status ${r.slots.length?'green':'red'}">${r.slots.length?`${r.slots.length} opciones`:'Sin espacio'}</span></div><div class="slot-list">${r.slots.length?r.slots.map(slot=>`<button class="slot-btn" onclick="bookFromAvailability(${r.staff.id},${serviceId},'${date}','${slot.start}')">${slot.start}</button>`).join(''):'<span class="muted">No hay horarios disponibles dentro del rango.</span>'}</div></div>`).join('');
};
window.bookFromAvailability=(staffId,serviceId,date,time)=>{populateAppointmentModal();$('#apptStaff').value=String(staffId);$('#apptService').value=String(serviceId);$('#apptDate').value=date;$('#apptTime').value=time;$('#appointmentModal').classList.add('show');};

const templates = {
  'Barbería': [['Corte',300,45],['Barba',180,30],['Corte + barba',450,60],['Diseño',120,20]],
  'Estética': [['Corte',350,60],['Tinte',900,120],['Peinado',450,60],['Maquillaje',700,90]],
  'Spa': [['Masaje relajante',800,60],['Masaje deportivo',950,60],['Facial',700,60],['Paquete spa',1500,120]],
  'Grooming': [['Baño',350,60],['Baño + corte',550,90],['Corte de uñas',120,20],['Deslanado',400,60]],
  'Veterinaria': [['Consulta',500,40],['Vacunación',350,30],['Desparasitación',300,30],['Seguimiento',350,30]],
  'Consultorio': [['Consulta inicial',700,60],['Seguimiento',500,40],['Valoración',650,45]],
  'Otro': [['Servicio 1',300,60],['Servicio 2',500,60]]
};

function renderCompanies(){
  $('#masterCompanies').textContent=companies.filter(c=>c.status==='Activa').length;
  $('#masterAI').textContent=companies.filter(c=>c.aiEnabled).length;
  $('#masterAppointments').textContent=data.appointments.length * Math.max(1, companies.length);
  $('#masterMRR').textContent=money(companies.reduce((s,c)=>s+(c.planPrice||0),0));
  $('#companyGrid').innerHTML=companies.map(c=>`
    <article class="company-card">
      <div class="company-card-head">
        <div class="company-logo">${c.logo?`<img src="${c.logo}" alt="">`:c.name.slice(0,1)}</div>
        <div><h3>${c.name}</h3><small>${c.type} · ${c.branch||'Sucursal principal'}</small></div>
      </div>
      <div class="company-tags"><span class="tag">${c.plan}</span><span class="tag ${c.aiEnabled?'success':''}">${c.aiEnabled?'IA activa':'IA inactiva'}</span></div>
      <div class="company-meta">
        <div><span>WhatsApp</span><strong>${c.whatsapp||'—'}</strong></div>
        <div><span>Agente</span><strong>${c.agent||'—'}</strong></div>
        <div><span>Horario</span><strong>${c.open||'—'}–${c.close||'—'}</strong></div>
        <div><span>Plan</span><strong>${money(c.planPrice||0)}/mes</strong></div>
      </div>
      <div class="company-actions">
        <button class="btn secondary" onclick="openCompany(${c.id})">Abrir panel</button>
        <button class="btn secondary" onclick="toggleCompanyAI(${c.id})">${c.aiEnabled?'Pausar IA':'Activar IA'}</button>
      </div>
    </article>`).join('');

  const sel=$('#companySwitch');
  if(sel){
    sel.innerHTML=companies.map(c=>`<option value="${c.id}" ${c.id===activeCompanyId?'selected':''}>${c.name}</option>`).join('');
    sel.onchange=()=>{activeCompanyId=+sel.value; localStorage.setItem('nexoActiveCompanyV3',String(activeCompanyId)); loadCompanyLocalData(); renderAll();};
  }
  updateCompanyContext();
}

function updateCompanyContext(){
  const c=companies.find(x=>x.id===activeCompanyId)||companies[0];
  if(!c) return;
  const brandName=document.querySelector('.brand-text strong');
  const brandSub=document.querySelector('.brand-text span');
  if(brandName) brandName.textContent='Nexo IA';
  if(brandSub) brandSub.textContent=c.name;
  $('#pageSubtitle').textContent=`${c.name} · ${c.branch||'Sucursal principal'}`;
}

window.openCompany=id=>{activeCompanyId=id; localStorage.setItem('nexoActiveCompanyV3',String(id)); loadCompanyLocalData(); renderAll(); showView('dashboard'); showToast('Empresa seleccionada');}
window.toggleCompanyAI=id=>{const c=companies.find(x=>x.id===id); c.aiEnabled=!c.aiEnabled; save(); showToast(c.aiEnabled?'Agente IA activado':'Agente IA pausado');}

function showWizardStep(){
  $$('.wizard-step').forEach(s=>s.classList.toggle('active',+s.dataset.step===wizardStep));
  $$('[data-stepdot]').forEach(d=>d.classList.toggle('active',+d.dataset.stepdot<=wizardStep));
  $('#wizardBack').style.visibility=wizardStep===1?'hidden':'visible';
  $('#wizardNext').textContent=wizardStep===4?'Crear empresa':'Siguiente';
  if(wizardStep===4) renderTemplatePreview();
}
function renderTemplatePreview(){
  const t=templates[$('#companyType').value]||templates.Otro;
  $('#templatePreview').innerHTML=t.map(x=>`<div class="template-chip"><strong>${x[0]}</strong><small>${money(x[1])} · ${x[2]} min</small></div>`).join('');
}
$('#newCompanyBtn').onclick=()=>{wizardStep=1; $('#companyModal').classList.add('show'); showWizardStep();};
$$('.close-company').forEach(b=>b.onclick=()=>$('#companyModal').classList.remove('show'));
$('#wizardBack').onclick=()=>{if(wizardStep>1){wizardStep--;showWizardStep();}};
$('#wizardNext').onclick=()=>{
  if(wizardStep<4){wizardStep++;showWizardStep();return;}
  const name=$('#companyName').value.trim();
  if(!name){showToast('Escribe el nombre de la empresa');wizardStep=1;showWizardStep();return;}
  const type=$('#companyType').value, planSel=$('#companyPlan'), planText=planSel.options[planSel.selectedIndex].text.split(' — ')[0], price=+planSel.value;
  const file=$('#companyLogo').files[0];

  const finish=async(logoData)=>{
    try{
      const draft={name,type,plan:planText,planPrice:price,phone:$('#companyPhone').value,whatsapp:$('#companyWhatsapp').value,instagram:$('#companyInstagram').value,facebook:$('#companyFacebook').value,branch:$('#companyBranch').value||'Principal',open:$('#companyOpen').value,close:$('#companyClose').value,agent:$('#companyAgent').value||'Sofía',greeting:$('#companyGreeting').value,aiEnabled:$('#companyAIEnabled').checked,status:'Activa',logo:logoData||null};
      const c=await createServerCompanyFromWizard(draft);
      companies.push(c); activeCompanyId=c.id; localStorage.setItem('nexoActiveCompanyV3',String(c.id)); loadCompanyLocalData();
      $('#companyModal').classList.remove('show');
      $('#companyName').value=''; $('#companyPhone').value=''; $('#companyWhatsapp').value='';
      renderAll(); showView('empresas'); await renderAdminUsers(); showToast('Empresa creada correctamente ✓');
    }catch(err){showToast(err.message);}
  };
  if(file){const r=new FileReader();r.onload=()=>finish(r.result);r.readAsDataURL(file);}else finish(null);
};

function renderAll(){renderCompanies();renderDashboard();renderCalendar();renderAppointments();renderClients();renderStaff();renderServices();renderIA();renderWait();renderReports();renderConfig();populateAvailability();updateCompanyContext();}

const permissionCatalog=[
  ['dashboard','Dashboard'],['agenda','Agenda'],['disponibilidad','Disponibilidad'],['citas','Citas'],
  ['clientes','Clientes'],['personal','Personal'],['servicios','Servicios'],['ia','Recepción IA'],
  ['espera','Lista de espera'],['reportes','Reportes'],['config','Configuración']
];

function applyMenuPermissions(){
  $$('.admin-only').forEach(el=>el.style.display=sessionUser?.is_platform_admin?'':'none');
  $$('.nav-item[data-view]').forEach(el=>{
    const id=el.dataset.view;
    if(sessionUser?.is_platform_admin){
      el.style.display='';
      return;
    }
    if(id==='empresas'||id==='usuarios'){
      el.style.display='none';
    }else{
      el.style.display=canView(id)?'':'none';
    }
  });
}
async function hydrateSession(){
  sessionUser=await api('/me');
  companies=sessionUser.is_platform_admin ? await api('/companies') : sessionUser.companies.map(c=>({
    id:c.id,name:c.name,plan:c.plan,type:c.business_type||'Empresa',business_type:c.business_type||'Empresa',
    phone:'',whatsapp:'',instagram:'',facebook:'',branch:'Principal',open:'09:00',close:'20:00',agent:'Sofía',aiEnabled:true,status:'Activa'
  }));
  if(!companies.length && !sessionUser.is_platform_admin) throw new Error('Tu usuario no tiene una empresa asignada');
  const saved=Number(localStorage.getItem('nexoActiveCompanyV3')||0);
  activeCompanyId=companies.some(c=>c.id===saved)?saved:(companies[0]?.id||null);
  if(activeCompanyId) loadCompanyLocalData();
  else data=emptyCompanyData();
  $('#sessionName').textContent=sessionUser.name;
  $('#sessionRole').textContent=sessionUser.is_platform_admin?'Administrador general':companies[0]?.name||'Empresa';
  if(sessionUser.is_platform_admin){
    if($('#profileName')) $('#profileName').value=sessionUser.name||'';
    if($('#profileUsername')) $('#profileUsername').value=sessionUser.username||'';
    if($('#profileEmail')) $('#profileEmail').value=sessionUser.email||'';
    if($('#profilePassword')) $('#profilePassword').value='';
  }
  applyMenuPermissions();
  renderAll();
  if(sessionUser.is_platform_admin){ showView('empresas'); await renderAdminUsers(); }
  else{
    const first=permissionCatalog.find(([id])=>canView(id))?.[0]||'dashboard';
    showView(first);
  }
}
async function loginSubmit(ev){
  ev.preventDefault();
  $('#loginError').textContent='';
  try{
    const out=await api('/auth/login',{method:'POST',body:JSON.stringify({login:$('#loginUser').value.trim(),password:$('#loginPassword').value})});
    authToken=out.access_token; localStorage.setItem('nexoToken',authToken);
    $('#loginScreen').classList.add('hidden-app'); $('#secureApp').classList.remove('hidden-app');
    await hydrateSession();
  }catch(err){ $('#loginError').textContent=err.message; }
}
$('#loginForm').addEventListener('submit',loginSubmit);
$('#logoutBtn').onclick=()=>{
  authToken='';sessionUser=null;localStorage.removeItem('nexoToken');
  $('#secureApp').classList.add('hidden-app');$('#loginScreen').classList.remove('hidden-app');
  $('#loginPassword').value='';
};

let editingCompanyUserId=null;
function renderPermissionChecks(selected=permissionCatalog.map(x=>x[0])){
  $('#permissionChecks').innerHTML=permissionCatalog.map(([id,label])=>`<label class="perm-check"><input type="checkbox" value="${id}" ${selected.includes(id)?'checked':''}><span>${label}</span></label>`).join('');
}
async function renderAdminUsers(){
  if(!sessionUser?.is_platform_admin) return;
  const users=await api('/admin/users');
  $('#adminUsersTable').innerHTML=users.length?users.map(u=>`<tr>
    <td><strong>${u.name}</strong><small>${u.username}<br>${u.email}</small></td>
    <td>${u.company_name}</td><td>${u.role}</td>
    <td><span class="permission-count">${u.permissions.length} módulos</span></td>
    <td><span class="status ${u.is_active?'green':'red'}">${u.is_active?'Activo':'Bloqueado'}</span></td>
    <td><div class="table-actions"><button class="btn secondary" onclick='editCompanyUser(${JSON.stringify(u)})'>Editar</button><button class="btn secondary" onclick="toggleUser(${u.id},${u.is_active?'false':'true'})">${u.is_active?'Bloquear':'Activar'}</button></div></td>
  </tr>`).join(''):'<tr><td colspan="6" class="muted">Aún no hay usuarios de empresas.</td></tr>';
}
$('#newCompanyUserBtn')?.addEventListener('click',()=>{
  editingCompanyUserId=null;
  $('#userModalTitle').textContent='Crear usuario de empresa';
  $('#saveCompanyUser').textContent='Crear usuario';
  $('#adminPasswordHelp').textContent='Debe tener por lo menos 8 caracteres.';
  const companySelect=$('#adminUserCompany');
  companySelect.innerHTML=companies.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  $('#adminUserName').value='';$('#adminUsername').value='';$('#adminUserEmail').value='';$('#adminUserPassword').value='';
  renderPermissionChecks();
  $('#adminUserError').textContent='';
  $('#userAdminModal').classList.add('show');
});

window.editCompanyUser=u=>{
  editingCompanyUserId=u.id;
  $('#userModalTitle').textContent='Modificar usuario';
  $('#saveCompanyUser').textContent='Guardar cambios';
  $('#adminPasswordHelp').textContent='Déjala vacía si no deseas cambiar la contraseña.';
  $('#adminUserCompany').innerHTML=companies.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  $('#adminUserCompany').value=String(u.company_id);
  $('#adminUserName').value=u.name||'';
  $('#adminUsername').value=u.username||'';
  $('#adminUserEmail').value=u.email||'';
  $('#adminUserPassword').value='';
  $('#adminUserRole').value=u.role||'encargado';
  renderPermissionChecks(u.permissions||[]);
  $('#adminUserError').textContent='';
  $('#userAdminModal').classList.add('show');
};
$$('.close-user-admin').forEach(b=>b.addEventListener('click',()=>{
  $('#userAdminModal').classList.remove('show');
  $('#adminUserError').textContent='';
}));
async function submitCompanyUser(){
  const errorBox=$('#adminUserError');
  const btn=$('#saveCompanyUser');
  if(!errorBox || !btn) return;

  const name=$('#adminUserName')?.value.trim()||'';
  const username=$('#adminUsername')?.value.trim().toLowerCase()||'';
  const email=$('#adminUserEmail')?.value.trim().toLowerCase()||'';
  const password=$('#adminUserPassword')?.value||'';
  const companyId=Number($('#adminUserCompany')?.value||0);
  const permissions=$$('#permissionChecks input:checked').map(x=>x.value);

  if(name.length<2){errorBox.textContent='Escribe el nombre del usuario.';return;}
  if(username.length<3){errorBox.textContent='El usuario debe tener al menos 3 caracteres.';return;}
  if(!email || !email.includes('@')){errorBox.textContent='Escribe un correo válido.';return;}
  if(!editingCompanyUserId && password.length<8){errorBox.textContent='La contraseña debe tener mínimo 8 caracteres.';return;}
  if(editingCompanyUserId && password && password.length<8){errorBox.textContent='La nueva contraseña debe tener mínimo 8 caracteres.';return;}
  if(!companyId){errorBox.textContent='Selecciona una empresa.';return;}

  btn.disabled=true;
  const editing=!!editingCompanyUserId;
  btn.textContent=editing?'Guardando...':'Creando...';
  errorBox.textContent=editing?'Guardando cambios...':'Enviando usuario al servidor...';

  try{
    const payload={name,username,email,company_id:companyId,role:$('#adminUserRole')?.value||'encargado',permissions};
    if(password) payload.password=password;

    if(editing){
      await api(`/admin/users/${editingCompanyUserId}`,{method:'PUT',body:JSON.stringify(payload)});
    }else{
      await api('/admin/users',{method:'POST',body:JSON.stringify({...payload,password})});
    }

    await renderAdminUsers();
    errorBox.textContent=editing?'Usuario actualizado correctamente ✓':'Usuario creado correctamente ✓';
    showToast(editing?'Usuario actualizado ✓':'Usuario creado correctamente ✓');
    editingCompanyUserId=null;

    setTimeout(()=>{
      $('#userAdminModal')?.classList.remove('show');
      errorBox.textContent='';
    },350);
  }catch(err){
    errorBox.textContent='Error: '+(err?.message||String(err));
  }finally{
    btn.disabled=false;
    btn.textContent=editing?'Guardar cambios':'Crear usuario';
  }
}

// Primary path: native form submit.
const companyUserForm=$('#companyUserForm');
if(companyUserForm){
  companyUserForm.addEventListener('submit',async ev=>{
    ev.preventDefault();
    ev.stopPropagation();
    await submitCompanyUser();
  });
}

// Fallback path: delegated click. This keeps the button functional even if
// another render replaces a node later.
document.addEventListener('click',async ev=>{
  const button=ev.target.closest?.('#saveCompanyUser');
  if(!button) return;
  const form=button.closest('form');
  if(form?.id==='companyUserForm') return; // native submit handles it
  ev.preventDefault();
  await submitCompanyUser();
});

window.toggleUser=async(id,isActive)=>{
  try{await api(`/admin/users/${id}`,{method:'PUT',body:JSON.stringify({is_active:isActive})});await renderAdminUsers();showToast('Usuario actualizado');}
  catch(err){showToast(err.message);}
};


if($('#saveAdminProfile')){
  $('#saveAdminProfile').onclick=async()=>{
    const errorBox=$('#profileError');
    errorBox.textContent='';
    const name=$('#profileName').value.trim();
    const username=$('#profileUsername').value.trim().toLowerCase();
    const email=$('#profileEmail').value.trim().toLowerCase();
    const newPassword=$('#profilePassword').value;

    if(name.length<2){errorBox.textContent='Escribe un nombre válido.';return;}
    if(username.length<3){errorBox.textContent='El usuario debe tener al menos 3 caracteres.';return;}
    if(!email || !email.includes('@')){errorBox.textContent='Escribe un correo válido.';return;}
    if(newPassword && newPassword.length<8){errorBox.textContent='La nueva contraseña debe tener mínimo 8 caracteres.';return;}

    const btn=$('#saveAdminProfile');
    btn.disabled=true; btn.textContent='Guardando...';
    try{
      await api('/admin/profile',{method:'PUT',body:JSON.stringify({
        name,username,email,new_password:newPassword||null
      })});
      sessionUser=await api('/me');
      $('#sessionName').textContent=sessionUser.name;
      $('#profilePassword').value='';
      showToast('Cuenta de administrador actualizada ✓');
    }catch(err){
      errorBox.textContent=err.message;
    }finally{
      btn.disabled=false; btn.textContent='Guardar cuenta de administrador';
    }
  };
}

async function createServerCompanyFromWizard(company){
  const created=await api('/companies',{method:'POST',body:JSON.stringify({
    name:company.name,business_type:company.type||'Otro',phone:company.phone||null,
    whatsapp:company.whatsapp||null,plan:company.plan||'Pro',agent_name:company.agent||'Sofía'
  })});
  return {...company,id:created.id};
}

(async function startSecureApp(){
  renderPermissionChecks();
  if(!authToken) return;
  try{
    $('#loginScreen').classList.add('hidden-app');$('#secureApp').classList.remove('hidden-app');
    await hydrateSession();
  }catch(err){
    authToken='';localStorage.removeItem('nexoToken');
    $('#secureApp').classList.add('hidden-app');$('#loginScreen').classList.remove('hidden-app');
    $('#loginError').textContent='Tu sesión expiró. Inicia sesión nuevamente.';
  }
})();

// renderAll se ejecuta después de autenticar al usuario.

