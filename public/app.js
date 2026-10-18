let state;
const $=s=>document.querySelector(s);
const money=v=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(v/100);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const r=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function notice(message){$('#notice').textContent=message;}
function enrollmentBody(){const b=Object.fromEntries(new FormData($('#enroll')));return {...b,group_id:Number(b.group_id),trial_id:b.trial_id?Number(b.trial_id):null};}
async function refresh(){state=await api('state');const selected=$('#location').value;$('#location').innerHTML='<option value="">Wybierz lokalizację</option>'+[...new Set(state.groups.map(g=>g.location))].map(l=>`<option>${escape(l)}</option>`).join('');$('#location').value=selected;updateGroups();renderAdmin();renderCalendar();updateExclusionTargets();renderExclusions();}
function updateGroups(){const previous=$('#group').value;$('#group').innerHTML='<option value="">Wybierz grupę</option>'+state.groups.filter(g=>g.location===$('#location').value).map(g=>`<option value="${g.id}">${escape(g.name)}</option>`).join('');$('#group').value=previous;updateTrials();}
function updateTrials(){const g=state.groups.find(g=>g.id===Number($('#group').value));const previous=$('#trial').value;const month=$('[name="month"]').value;$('#trial').innerHTML='<option value="">Zapis stały</option>'+(g?.trials?state.sessions.filter(s=>s.group_id===g.id&&s.starts_at.slice(0,7)===month&&s.starts_at>=state.now&&!s.excluded).map(s=>`<option value="${s.id}">Próba ${escape(s.starts_at.slice(0,16).replace('T',' '))} · ${money(g.trial_price)}</option>`).join(''):'');$('#trial').value=previous;if(!$('#trial').value)$('#trial').value='';$('#group-info').textContent=g?`${money(g.price)} / zajęcia · limit ${g.capacity} miejsc · czas: Europe/Warsaw`:'';renderMonthlySessions();updateQuote();}
let quoteVersion=0;
async function updateQuote(){const version=++quoteVersion;if(!$('#group').value){$('#quote').textContent='Wybierz grupę i miesiąc';return;}try{const q=await api('quote',enrollmentBody());if(version===quoteVersion)$('#quote').textContent=`${q.count} ${$('#trial').value?'zajęcia próbne':'zajęcia'} · ${money(q.amount)}`;}catch(e){if(version===quoteVersion)$('#quote').textContent=e.message;}}
function renderAdmin(){ $('#enrollments').innerHTML=state.enrollments.length?state.enrollments.map(e=>`<div class="entry"><strong>${escape(e.child)}</strong> · ${money(e.balance)}<small>${escape(e.parent)} · ${escape(e.email)}<br>${escape(e.location)} / ${escape(e.group_name)} · ${escape(e.month)}${e.trial_id?' · próba':''}</small><button data-adjust="${e.id}">Korekta należności</button></div>`).join(''):'<p>Nie ma jeszcze zapisów. Utwórz grupę i sprawdź formularz rodzica.</p>';$('#history').innerHTML=state.adjustments.map(a=>`<div class="entry">Zapis #${a.enrollment_id} · ${money(a.amount)}<br>${escape(a.reason)}<small>${escape(a.created_at.replace('T',' '))} · administrator testowy</small></div>`).join('')||'<p>Brak korekt.</p>';}
for(const button of document.querySelectorAll('nav button'))button.onclick=()=>{const admin=button.dataset.view==='admin';$('#parent').hidden=admin;$('#admin').hidden=!admin;$('#breadcrumb').textContent=admin?'Administracja':'Zapisy';document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b===button));};
$('#location').onchange=updateGroups;$('#group').onchange=updateTrials;$('[name="month"]').onchange=updateTrials;$('#trial').onchange=updateQuote;
$('#create-group').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{const result=await api('groups',{...b,price:Math.round(Number(b.price)*100),trial_price:Math.round(Number(b.trial_price)*100),capacity:Number(b.capacity),trials:b.trials==='on',weekday:Number(b.weekday)});e.target.reset();await refresh();notice(`Grupa zapisana. Automatycznie utworzono ${result.count} terminów. Wykluczenia są uwzględnione w grafiku i opłatach.`);}catch(e){notice(e.message);}};
$('#enroll').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('enrollments',enrollmentBody());await refresh();notice(`Zapis potwierdzony. Należność: ${money(result.amount)}. Płatności online nie są jeszcze podłączone.`);}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('#enrollments').onclick=async e=>{const id=e.target.dataset.adjust;if(!id)return;const value=prompt('Kwota korekty w zł. Obniżka: kwota ujemna, np. -50.');if(value===null||!value.trim())return;const amount=Number(value.replace(',','.'));if(!Number.isFinite(amount)){notice('Podaj poprawną kwotę.');return;}const reason=prompt('Powód korekty:');if(!reason)return;try{await api('adjustments',{enrollment_id:Number(id),amount:Math.round(amount*100),reason});await refresh();notice('Korekta została zapisana w historii.');}catch(e){notice(e.message);}};
$('#calendar-month').value=$('[name="month"]').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit'}).format(new Date());
refresh().catch(e=>notice(e.message));

const dayNames=['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
function termLabel(s){return s.starts_at.slice(0,10).split('-').reverse().join('.')+' · '+s.starts_at.slice(11,16)+(s.ends_at?'–'+s.ends_at.slice(11,16):'');}
function renderMonthlySessions(){
 const groupId=Number($('#group').value),month=$('[name="month"]').value;
 const sessions=state.sessions.filter(s=>s.group_id===groupId&&s.starts_at.startsWith(month));
 $('#monthly-sessions').innerHTML=groupId?sessions.map(s=>`<div class="term ${s.excluded?'excluded':''}">${escape(termLabel(s))}${s.excluded?' · dzień wykluczony':s.starts_at<state.now?' · odbyte':''}</div>`).join('')||'Brak zajęć w wybranym miesiącu.':'';
}
function renderCalendar(){
 const month=$('#calendar-month').value;
 $('#calendar').innerHTML=state.groups.map(g=>{
  const sessions=state.sessions.filter(s=>s.group_id===g.id&&s.starts_at.startsWith(month));
  const active=sessions.filter(s=>!s.excluded);
  return `<div class="entry"><strong>${escape(g.location)} / ${escape(g.name)}</strong><small>${g.weekday!==null?escape(dayNames[g.weekday])+' · '+escape(g.start_time)+'–'+escape(g.end_time):'Grafik z poprzedniej wersji'}</small><p>${active.length} zajęć · ${money(active.reduce((sum,s)=>sum+s.price,0))} za pełny miesiąc</p>${sessions.map(s=>`<div class="term ${s.excluded?'excluded':''}">${escape(termLabel(s))}${s.excluded?' · wykluczone':''}</div>`).join('')||'<p class="hint">Brak terminów w tym miesiącu.</p>'}</div>`;
 }).join('')||'<p class="hint">Utwórz pierwszą grupę.</p>';
}
function updateExclusionTargets(){
 const scope=$('#exclude-scope').value,select=$('#exclude-target');
 const previous=[...select.selectedOptions].map(o=>o.value);
 $('#exclude-target-label').hidden=scope==='all';
 select.innerHTML=scope==='location'?[...new Set(state.groups.map(g=>g.location))].map(l=>`<option value="${escape(l)}">${escape(l)}</option>`).join(''):scope==='group'?state.groups.map(g=>`<option value="${g.id}">${escape(g.location)} / ${escape(g.name)}</option>`).join(''):'';
 for(const option of select.options)option.selected=previous.includes(option.value);
}
function renderExclusions(){
 $('#exclusions').innerHTML=state.exclusions.map(e=>{
  const group=state.groups.find(g=>g.id===e.group_id);
  const scope=e.scope==='all'?'Wszystkie lokalizacje':e.scope==='location'?e.location:group?.location+' / '+group?.name;
  return `<div class="entry"><strong>${escape(e.reason)}</strong><small>${escape(e.start_date)} — ${escape(e.end_date)}<br>${escape(scope)}</small><button type="button" data-remove-exclusion="${e.id}">Usuń wykluczenie</button></div>`;
 }).join('')||'<p class="hint">Brak wykluczeń. Święta dodajesz samodzielnie.</p>';
}
$('#calendar-month').onchange=renderCalendar;
$('#exclude-scope').onchange=updateExclusionTargets;
$('#exclude-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target,b=Object.fromEntries(new FormData(form));
 const targets=[...$('#exclude-target').selectedOptions].map(o=>o.value);
 if(b.scope!=='all'&&!targets.length){notice('Wybierz co najmniej jedną lokalizację lub grupę.');return;}
 const button=form.querySelector('button');button.disabled=true;
 try{
  await api('exclusions',{...b,targets:b.scope==='all'?[]:targets});
  await refresh();notice('Wykluczenia zapisane. Grafik i należności zostały przeliczone.');
 }catch(e){notice(e.message);}finally{button.disabled=false;}
};
$('#exclusions').onclick=async event=>{
 const id=event.target.dataset.removeExclusion;if(!id)return;
 if(!confirm('Usunąć wykluczenie? Terminy i związane z nimi należności zostaną przywrócone, o ile nie obejmuje ich inne wykluczenie.'))return;
 try{await api('exclusions/remove',{id:Number(id)});await refresh();notice('Wykluczenie usunięte. Grafik i należności zostały przeliczone.');}catch(e){notice(e.message);}
};
