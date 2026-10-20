import {layoutLessons} from './timetable.js';
let state;
let authInfo = { user: null, needs_setup: false };
let authMode = 'login';
let selectedGroupLocation = null;
let selectedAdminGroup = null;
let dialogOrder = [];
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayNames = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const viewNames = { dashboard:'Pulpit', business:'Firma i wynagrodzenia', library:'Metodyka i postępy', messages:'Wiadomości',policies:'Dokumenty i zgody',equipment:'Sprzęt', finance:'Wpłaty i cenniki', calendar:'Kalendarz i obecności', waiting:'Lista rezerwowa', users:'Użytkownicy', seasons:'Sezony', coach: 'Mój grafik i grupy', audit: 'Dziennik zmian', auth: 'Logowanie', athletes: 'Zawodnicy', groups: 'Grupy', locations: 'Lokalizacje', 'days-off': 'Dni wolne', trainers: 'Trenerzy', billing: 'Rozliczenia', settings: 'Wygląd', parent: 'Zapisy na zajęcia', children: 'Moje dzieci' };
let toastTimer;
let auditCursor = null;
let auditVersion = 0;

async function api(path, body) {
  const response = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/')) { authInfo.user = null; state = null; window.location.replace('/'); }
    throw Error(data.error);
  }
  return data;
}

function notice(message, error = false) {
  for (const element of [$('#notice'), $('#toast')]) {
    element.textContent = message;
    element.hidden = false;
    element.classList.toggle('error', error);
  }
  const dialog = [...dialogOrder].reverse().map(id=>document.getElementById(id)).find(element=>element.open);
  if (dialog) {
    let feedback = dialog.querySelector('.form-message');
    if (!feedback) {
      feedback = document.createElement('p');
      feedback.className = 'form-message';
      feedback.setAttribute('role', 'alert');
      (dialog.querySelector('form') || dialog).prepend(feedback);
    }
    feedback.textContent = message;
    feedback.classList.toggle('success',!error);
    feedback.setAttribute('role',error?'alert':'status');
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

function switchView(view) {
  if (!authInfo.user) view = 'auth';
  else if (authInfo.user.role === 'trainer'&&!['coach','calendar','messages','equipment','library','business'].includes(view)) view = 'coach';
  else if (authInfo.user.role === 'parent' && !['parent','children','calendar','messages','policies','library'].includes(view)) view = 'parent';
  else if (!viewNames[view] || view === 'auth' || (view === 'coach'&&authInfo.user.role==='admin')) view = 'dashboard';
  $('nav').hidden = !authInfo.user;
  $('#logout').hidden = !authInfo.user;
  $('#public-registration-link').hidden = authInfo.user?.role !== 'admin';
  $('#account-name').textContent = authInfo.user?.name || '';
  for (const button of document.querySelectorAll('nav [data-view]')) button.hidden = authInfo.user?.role === 'trainer' ? !['coach','calendar','messages','equipment','library','business'].includes(button.dataset.view) : button.dataset.view === 'coach' || (authInfo.user?.role === 'parent' && !['parent','children','calendar','messages','policies','library'].includes(button.dataset.view));
  for (const label of document.querySelectorAll('nav .nav-label')) label.hidden = authInfo.user?.role === 'trainer' || (authInfo.user?.role === 'parent' && !label.classList.contains('second'));
  for (const section of document.querySelectorAll('main > .page')) section.hidden = section.id !== (view==='calendar'?'calendar-page':view);
  for (const button of document.querySelectorAll('nav [data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = viewNames[view];
  $('nav [data-view="parent"]').innerHTML = '<svg><use href="#i-arrow"/></svg>' + 'Zapisy na zajęcia';
  $('.workspace-label').innerHTML = '<span class="workspace-dot"></span> ' + (!authInfo.user ? 'Evolution Academy' : authInfo.user.role === 'trainer' ? 'Panel trenera' : authInfo.user.role === 'parent' ? 'Panel rodzica' : 'Panel administratora');
  $('#notice').hidden = true;
  if(view==='dashboard')loadDashboard();
  if(view==='audit') loadAudit();
  if(view==='users') loadUsers();
  if(view==='calendar') loadCalendar();
  if(['messages','policies','equipment'].includes(view))loadWorkspace();
  if(view==='library')loadLibrary();
  if(view==='business')loadBusiness();
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.querySelector('.form-message')?.remove();
  dialog.showModal();
  dialogOrder = dialogOrder.filter(entry=>entry!==id&&document.getElementById(entry).open);
  dialogOrder.push(id);
}

function selectedIds(container) {
  return [...document.querySelectorAll(container + ' input:checked')].map(input => Number(input.value));
}

function trainersFor(groupId) {
  const ids = state.group_trainers.filter(assignment => assignment.group_id === groupId).map(assignment => assignment.trainer_id);
  return state.trainers.filter(trainer => ids.includes(trainer.id));
}

function trainerCheckboxes(ids = []) {
  return state.trainers.map(trainer => `<label class="check"><input type="checkbox" value="${trainer.id}" ${ids.includes(trainer.id) ? 'checked' : ''}>${escape(trainer.name)}${trainer.status&&trainer.status!=='active'?' (nieaktywny)':''}</label>`).join('');
}

function updateLocationSelect() {
  const select = $('#group-location');
  const previous = select.value;
  select.innerHTML = '<option value="">Wybierz lokalizację</option>' + state.locations.map(location => `<option value="${location.id}" ${location.status!=='active'?'disabled':''}>${escape(location.name)}</option>`).join('');
  select.value = previous;
  $('#group-location-help').innerHTML = state.locations.length
    ? 'Wybierz zapisaną lokalizację. Nowe przedszkola dodasz w dziale „Lokalizacje”.'
    : 'Najpierw dodaj przedszkole w dziale „Lokalizacje”. <button type="button" class="tertiary" data-view="locations">Przejdź do lokalizacji →</button>';
}

const locationStatuses = {active:'Aktywna',paused:'Wstrzymana',archived:'Archiwalna'};
function renderLocations() {
  const status = $('#location-status-filter').value;
  $('#location-list').innerHTML = state.locations.filter(location=>!status||location.status===status).map(location => {
    const groups = state.groups.filter(group => group.location_id === location.id);
    const groupIds=new Set(groups.map(group=>group.id));
    const count=new Set(state.memberships.filter(member=>groupIds.has(member.group_id)&&member.status!=='ended').map(member=>member.athlete_id)).size;
    const trainerNames=[...new Set(groups.flatMap(group=>trainersFor(group.id).map(trainer=>trainer.name)))];
    return `<div class="entry exclusion-entry"><div><strong>${escape(location.name)}</strong> <span class="pill">${locationStatuses[location.status]}</span><small>${escape([location.address,location.city].filter(Boolean).join(', '))}<br>Grupy: ${groups.length} · Zawodnicy: ${count}${trainerNames.length?'<br>Trenerzy: '+escape(trainerNames.join(', ')):''}${location.contact_name?'<br>Kontakt: '+escape(location.contact_name):''}${location.phone?' · '+escape(location.phone):''}${location.email?' · '+escape(location.email):''}</small></div><button type="button" class="secondary" data-edit-location="${location.id}">Edytuj placówkę</button></div>`;
  }).join('') || emptyState('location', 'Brak lokalizacji', 'Dodaj placówkę lub zmień filtr statusu.', '<button type="button" class="secondary" data-new-location>Dodaj lokalizację</button>');
}

function openLocation(id = null) {
  const form = $('#save-location'), location=state.locations.find(entry=>entry.id===id);
  form.reset();
  form.elements.id.value = id || '';
  for(const field of ['name','address','city','phone','email','contact_name','notes']) form.elements[field].value=location?.[field]||'';
  form.elements.status.value=location?.status||'active';
  $('#location-dialog-title').textContent = id ? 'Ustawienia placówki' : 'Nowa lokalizacja';
  openDialog('location-dialog');
}

async function loadAudit(append=false) {
  const version=++auditVersion;
  $('#audit-more').disabled=true;
  try {
    const result=await api('audit'+(append&&auditCursor?'?before='+auditCursor:''));
    if(version!==auditVersion||authInfo.user?.role!=='admin')return;
    auditCursor=result.next_cursor;
    const entities={admission_settings:'Ustawienia potwierdzeń',trial_decisions:'Kontynuacja próby',waiting_list:'Lista rezerwowa',seasons:'Sezon',membership_periods:'Okres uczestnictwa',trainer_notes:'Notatka trenera',locations:'Placówka',users:'Konto',athletes:'Zawodnik',groups:'Grupa',sessions:'Termin',memberships:'Uczestnictwo',enrollments:'Należność',enrollment_sessions:'Pozycja należności',adjustments:'Korekta',exclusions:'Dni wolne',trainers:'Trener',group_trainers:'Przypisanie trenera',access:'Dostęp'};
    const actions={insert:'Dodano',update:'Zmieniono',delete:'Usunięto','session.started':'Rozpoczęto sesję','session.ended':'Wylogowano','account.activated':'Aktywowano konto','invitation.created':'Utworzono zaproszenie'};
    const fields={season_id:'Sezon ID',registration_open:'Zapisy otwarte',withdrawal_reason:'Powód rezygnacji',body:'Treść',updated_at:'Data zmiany',user_id:'Konto ID',id:'ID',name:'Nazwa',email:'Email',phone:'Telefon',role:'Rola',access_status:'Dostęp',address:'Adres',city:'Miejscowość',contact_name:'Osoba kontaktowa',notes:'Notatki',status:'Status',parent_id:'Rodzic ID',birth_date:'Data urodzenia',location_id:'Placówka ID',capacity:'Limit miejsc',price:'Cena (gr)',trial_price:'Cena próby (gr)',trials:'Próby',start_date:'Od dnia',end_date:'Do dnia',start_time:'Od godziny',end_time:'Do godziny',weekday:'Dzień tygodnia',group_id:'Grupa ID',starts_at:'Początek',ends_at:'Koniec',cancelled:'Odwołano',athlete_id:'Zawodnik ID',joined_at:'Data zapisu',trial_id:'Próba ID',month:'Miesiąc',amount:'Kwota (gr)',enrollment_id:'Należność ID',session_id:'Termin ID',reason:'Powód',scope:'Zakres',trainer_id:'Trener ID'};
    const markup=result.items.map(entry=>{
      const before=JSON.parse(entry.before_json||'{}'),after=JSON.parse(entry.after_json||'{}');
      const changes=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>before[key]!==after[key]).map(key=>`<div><strong>${fields[key]||escape(key)}</strong><span>${escape(before[key]??'—')} → ${escape(after[key]??'—')}</span></div>`).join('');
      const date=new Intl.DateTimeFormat('pl-PL',{dateStyle:'short',timeStyle:'medium',timeZone:'Europe/Warsaw'}).format(new Date(entry.created_at));
      return `<article class="entry"><strong>${entities[entry.entity_type]||escape(entry.entity_type)} #${escape(entry.entity_id)} · ${actions[entry.action]||escape(entry.action)}</strong><small>${escape(date)} · ${escape(entry.actor_name||'System / rejestracja publiczna')}</small>${changes?`<details><summary>Szczegóły zmiany</summary><div class="audit-changes">${changes}</div></details>`:''}</article>`;
    }).join('');
    if(append)$('#audit-list').insertAdjacentHTML('beforeend',markup);else $('#audit-list').innerHTML=markup||'<p>Brak wpisów w dzienniku.</p>';
    $('#audit-more').hidden=!auditCursor;
  }catch(error){notice(error.message,true);}finally{if(version===auditVersion)$('#audit-more').disabled=false;}
}

function enrollmentBody() {
  const body = Object.fromEntries(new FormData($('#enroll')));
  return { ...body, answers:Object.fromEntries([...document.querySelectorAll('#enrollment-questions input')].map(input=>[input.dataset.question,input.value])), waitlist:queueSelected(), athlete_id: Number(body.athlete_id), group_id: Number(body.group_id), trial_id: body.trial_id ? Number(body.trial_id) : null };
}

async function refresh() {
  state = await api('state');
  authInfo.user = state.user;
  if(state.user.role==='trainer') {
    $('#brand-logo').hidden=!state.logo;$('#brand-fallback').hidden=Boolean(state.logo);
    if(state.logo)$('#brand-logo').src=state.logo;
    renderCoach();return;
  }
  $('[name="month"]').value = state.now.slice(0,7);
  const selectedLocation = $('#location').value;
  $('#location').innerHTML = '<option value="">Wybierz lokalizację</option>' + state.locations.filter(location => location.status==='active' && state.groups.some(group => group.location_id === location.id && group.registration_available)).map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
  $('#location').value = selectedLocation;
  updateGroups();
  renderAdmin();
  renderSeasons();
  renderCalendar();
  updateExclusionTargets();
  renderExclusions();
  renderTrainers();
  renderLocations();
  updateLocationSelect();
  renderAthletes();
  renderMyChildren();
  renderWaiting();
  renderFinance();
  updateAthleteSelects();
  const selected = selectedIds('#new-group-trainers');
  $('#new-group-trainers').innerHTML = trainerCheckboxes(selected) || '<p class="hint">Nie dodano jeszcze trenerów. Grupę możesz na razie utworzyć bez prowadzącego.</p>';
  $('#brand-logo').hidden = !state.logo;
  $('#brand-fallback').hidden = Boolean(state.logo);
  if (state.logo) $('#brand-logo').src = state.logo;
}

function groupAgeLabel(g){return g.min_age==null&&g.max_age==null?'':g.min_age!=null&&g.max_age!=null?`Wiek: ${g.min_age}–${g.max_age} lat`:g.min_age!=null?`Wiek: od ${g.min_age} lat`:`Wiek: do ${g.max_age} lat`;}
function updateGroups() {
  const group = state.groups.find(entry => entry.id === Number($('#group').value));
  if (!group || group.location_id !== Number($('#location').value)) $('#group').value = '';
  renderRegistrationGroups();
  updateTrials();
}

function updateTrials() {
  const group = state.groups.find(g => g.id === Number($('#group').value));
  const previous = $('#trial').value;
  const month = $('[name="month"]').value;
  $('#trial').innerHTML = '<option value="">Zapis stały</option>' + (group?.trials ? state.sessions.filter(s => s.group_id === group.id && s.starts_at.startsWith(month) && s.starts_at >= state.now && !s.excluded).map(s => `<option value="${s.id}">Próba ${escape(termLabel(s))} · ${money(group.trial_price)}</option>`).join('') : '');
  $('#trial').value = previous;
  if (!$('#trial').value) $('#trial').value = '';
  $('#trial-label').hidden = !group?.trials||queueSelected();
  if(queueSelected())$('#trial').value='';
  $('#group-info').innerHTML = group ? `<strong>${escape(group.name)}</strong><span>${escape(group.location)}</span><span>${escape(groupAgeLabel(group))}</span><span>${escape(scheduleLabel(group))}</span><span>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ') || 'Nie przypisano')}</span>` : '';
  $('#enrollment-questions').innerHTML=JSON.parse(group?.questions||'[]').map(q=>`<label>${escape(q.label)} (opcjonalnie)<input data-question="${escape(q.label)}" maxlength="500" ></label>`).join('');
  renderMonthlySessions();
  updateQuote();
}

let quoteVersion = 0;
async function updateQuote() {
  const version = ++quoteVersion;
  const submit=$('#enroll [type="submit"]');
  submit.disabled=true;
  if (!$('#group').value) { $('#quote').textContent = 'Wybierz grupę i miesiąc'; return; }
  try {
    const quote = await api('quote', enrollmentBody());
    if (version === quoteVersion) { submit.disabled=false; submit.textContent=queueSelected()?'Dołącz do listy rezerwowej':'Potwierdź zapis'; $('#quote').textContent = queueSelected()?'Lista rezerwowa — bez naliczania opłaty. Oferta miejsca pojawi się w Moich dzieciach.': `${quote.count} ${$('#trial').value ? 'zajęcia próbne' : 'zajęcia'} · ${money(quote.amount)}`; }
  } catch (error) {
    if (version === quoteVersion) $('#quote').textContent = error.message;
  }
}

function emptyState(icon, heading, description, action = '') {
  return `<div class="empty"><svg aria-hidden="true"><use href="#i-${icon}"/></svg><h3>${heading}</h3><p>${description}</p>${action}</div>`;
}

const directoryPages = { athlete: 1, billing: 1, history: 1 };
const directoryPageSize = 20;

function updateDirectoryFilters(prefix) {
  const seasonSelect=$(`#${prefix}-filter-season`),seasonId=seasonSelect.value;
  seasonSelect.innerHTML='<option value="">Wszystkie sezony</option><option value="unassigned">Bez sezonu</option>'+state.seasons.map(season=>`<option value="${season.id}">${escape(season.name)}</option>`).join('');
  seasonSelect.value=seasonId;
  const locationSelect = $(`#${prefix}-filter-location`);
  const groupSelect = $(`#${prefix}-filter-group`);
  const locationId = locationSelect.value, groupId = groupSelect.value;
  locationSelect.innerHTML = '<option value="">Wszystkie lokalizacje</option>' + state.locations.map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
  locationSelect.value = locationId;
  const groups = state.groups.filter(group => (!locationSelect.value || String(group.location_id) === locationSelect.value)&&matchesSeason(group,seasonSelect.value));
  groupSelect.innerHTML = '<option value="">Wszystkie grupy</option>' + groups.map(group => `<option value="${group.id}">${escape(group.name)} · ${escape(group.location)}</option>`).join('');
  groupSelect.value = groupId;
}
function matchesSeason(group,value) {return !value||(value==='unassigned'?!group?.season_id:String(group?.season_id)===value);}

function directorySlice(prefix, records) {
  const pages = Math.max(1, Math.ceil(records.length / directoryPageSize));
  directoryPages[prefix] = Math.min(directoryPages[prefix], pages);
  const page = directoryPages[prefix];
  $(`#${prefix}-pagination`).innerHTML = pages > 1 ? `<button class="secondary" data-directory-page="${prefix}" data-page="${page-1}" ${page===1?'disabled':''}>Poprzednia</button><span>Strona ${page} z ${pages}</span><button class="secondary" data-directory-page="${prefix}" data-page="${page+1}" ${page===pages?'disabled':''}>Następna</button>` : '';
  return records.slice((page - 1) * directoryPageSize, page * directoryPageSize);
}

function renderAdmin() {
  updateDirectoryFilters('billing');
  const search = $('#billing-search').value.trim().toLocaleLowerCase('pl');
  const location = $('#billing-filter-location').value, group = $('#billing-filter-group').value;
  const month = $('#billing-filter-month').value, status = $('#billing-filter-status').value;
  const season=$('#billing-filter-season').value;
  const minimumDays=$('#billing-filter-days').value,minimumAmount=$('#billing-filter-amount').value;
  const matches = state.enrollments.filter(entry => {
    const assignedGroup = state.groups.find(item => item.id === entry.group_id);
    return [entry.child,entry.parent,entry.email].join(' ').toLocaleLowerCase('pl').includes(search)
      && (!location || String(entry.location_id ?? assignedGroup?.location_id) === location)
      && (!group || String(entry.group_id) === group)
      && (!month || entry.month === month)
      && matchesSeason(assignedGroup,season)
      && (minimumDays===''||(entry.payment_status==='overdue'&&entry.overdue_days>=Number(minimumDays)))
      && (minimumAmount===''||entry.balance>=Math.round(Number(minimumAmount)*100))
      && (!status || (status === 'due' ? entry.balance > 0 : status === 'credit' ? entry.balance < 0 : status === 'zero'?entry.balance===0:entry.payment_status===status));
  });
  const visible = directorySlice('billing', matches);
  const total = matches.reduce((sum,entry)=>sum+entry.balance,0);
  $('#billing-count').textContent = `Należności: ${matches.length} z ${state.enrollments.length} · Łączne saldo wyników: ${money(total)} · Po terminie: ${money(matches.reduce((sum,e)=>sum+e.overdue_amount,0))}`;
  $('#enrollments').innerHTML = visible.length ? visible.map(e => `<div class="entry"><strong>${escape(e.child)}</strong> · ${money(e.balance)}<small>${escape(e.parent)} · ${escape(e.email)}<br>${escape(e.location)} / ${escape(e.group_name)} · ${escape(e.month)}${e.trial_id ? ' · próba' : ''}</small><small>${escape(paymentDeadlineLabel(e))}</small><button class="secondary" data-deadline="${e.id}">Termin płatności</button><button class="secondary" data-adjust="${e.id}">Korekta należności</button></div>`).join('') : emptyState('wallet', 'Brak należności', 'Brak należności pasujących do wybranych filtrów.');
  const matchingIds = new Set(matches.map(entry=>entry.id));
  const adjustments = state.adjustments.filter(entry=>matchingIds.has(entry.enrollment_id));
  $('#history').innerHTML = directorySlice('history',adjustments).map(a => `<div class="entry"><strong>${money(a.amount)}</strong> · zapis #${a.enrollment_id}<br>${escape(a.reason)}<small>${escape(a.created_at.replace('T', ' '))} · administrator testowy</small></div>`).join('') || '<p class="hint">Brak korekt dla wybranych należności.</p>';
}

function termLabel(session) {
  return session.starts_at.slice(0, 10).split('-').reverse().join('.') + ' · ' + session.starts_at.slice(11, 16) + (session.ends_at ? '–' + session.ends_at.slice(11, 16) : '');
}

function termMarkup(session, parent = false) {
  return `<div class="term ${session.excluded ? 'excluded' : ''}">${escape(termLabel(session))}${session.cancelled ? ' · odwołane' : session.excluded ? ' · dzień wolny' : parent && session.starts_at < state.now ? ' · odbyte' : ''}</div>`;
}

function renderMonthlySessions() {
  const groupId = Number($('#group').value), month = $('[name="month"]').value;
  const sessions = state.sessions.filter(s => s.group_id === groupId && s.starts_at.startsWith(month) && !s.cancelled);
  $('#monthly-sessions').innerHTML = groupId ? sessions.map(s => termMarkup(s, true)).join('') || 'Brak zajęć w wybranym miesiącu.' : '';
}

function scheduleLabel(group) {
  if(group.weekday!==null) return `${dayNames[group.weekday]} · ${group.start_time}–${group.end_time}`;
  const next=state.sessions.find(session=>session.group_id===group.id&&!session.cancelled&&session.starts_at>=state.now);
  return next ? termLabel(next) : 'Brak przyszłych terminów';
}

function renderCalendar() {
  const month=$('#calendar-month').value;
  const seasonFilter=$('#group-filter-season').value,statusFilter=$('#group-filter-status').value;
  const filteredGroups=state.groups.filter(group=>(!seasonFilter||(seasonFilter==='none'?!group.season_id:String(group.season_id)===seasonFilter))&&(!statusFilter||group.status===statusFilter));
  const stats=[['Grupy',state.groups.length,'groups'],['Lokalizacje',state.locations.length,'location'],['Zawodnicy',state.athletes.length,'users']];
  $('#group-stats').innerHTML=stats.map(([label,count,icon])=>`<div class="stat"><span class="stat-label">${label}</span><strong>${count}</strong><span class="stat-icon"><svg><use href="#i-${icon}"/></svg></span></div>`).join('');
  const location=state.locations.find(entry=>entry.id===selectedGroupLocation);
  const group=state.groups.find(entry=>entry.id===selectedAdminGroup&&entry.location_id===location?.id);
  $('#group-stats').hidden=Boolean(location);
  $('#groups .section-toolbar h2').textContent=group?'Szczegóły grupy':location?'Grupy':'Lokalizacje';
  $('#groups .section-toolbar .hint').hidden=!group;
  $('#calendar-month').closest('label').hidden=!group;
  $('#group-location-path').innerHTML=location?`<div class="location-path"><button class="tertiary" data-back-locations>← Lokalizacje</button><span>/</span>${group?`<button class="tertiary" data-back-groups>${escape(location.name)}</button><span>/ ${escape(group.name)}</span>`:`<span>${escape(location.name)}</span>`}</div>`:'';
  $('#calendar').className=location?'admin-group-list':'location-list';
  if(!location) {
    $('#calendar').innerHTML=state.locations.map(entry=>{
      const groups=filteredGroups.filter(candidate=>candidate.location_id===entry.id);
      return `<button class="admin-list-row" data-location-groups="${entry.id}"><span class="list-row-title">${escape(entry.name)}<small>${groups.length} grup</small></span><span class="list-enter">Zobacz grupy →</span></button>`;
    }).join('')||emptyState('location','Brak lokalizacji','','<button class="secondary" data-view="locations">Dodaj lokalizację</button>');
    return;
  }
  if(!group) {
    $('#calendar').innerHTML=filteredGroups.filter(entry=>entry.location_id===location.id).map(entry=>{
      const trainer=trainersFor(entry.id).map(person=>person.name).join(', ')||'Nie przypisano trenera';
      return `<button class="admin-list-row" data-enter-group="${entry.id}"><span class="list-row-title">${escape(entry.name)}<small>${escape(scheduleLabel(entry))}</small><small>Trener: ${escape(trainer)}</small><small>${escape(groupStatusLabel(entry))} · ${escape(seasonName(entry.season_id))}</small></span><span class="list-occupancy"><strong>${entry.member_count} / ${entry.capacity}</strong><small>zapisanych zawodników</small></span><span class="list-enter">Wejdź →</span></button>`;
    }).join('')||emptyState('groups','Brak grup','','<button class="secondary" data-open="group-dialog">Dodaj grupę</button>');
    return;
  }
  const sessions=state.sessions.filter(session=>session.group_id===group.id&&session.starts_at.startsWith(month)&&!session.cancelled);
  const active=sessions.filter(session=>!session.excluded);
  const members=state.memberships.filter(member=>member.group_id===group.id);
  $('#calendar').innerHTML=`<div class="admin-group-detail"><div class="group-detail-heading"><div><h2>${escape(group.name)}</h2><p>${escape(groupStatusLabel(group))} · ${escape(seasonName(group.season_id))}</p><p>${escape(scheduleLabel(group))}</p>${group.parent_description?`<p>${escape(group.parent_description)}</p>`:''}${group.activity_type?`<p>${escape(group.activity_type)}</p>`:''}<p>Trener: ${escape(trainersFor(group.id).map(person=>person.name).join(', ')||'Nie przypisano')}</p></div><div class="trainer-actions"><button class="secondary" data-edit-group="${group.id}">Edytuj ustawienia</button><button class="secondary" data-lifecycle="${group.id}">Status i zapisy</button><button class="secondary" data-copy-group="${group.id}">Skopiuj grupę</button></div></div><div class="detail-facts"><span><strong>${group.member_count} / ${group.capacity}</strong> zapisanych</span><span><strong>${group.reserved_count||0}</strong> ofert z rezerwacją miejsca</span><span><strong>${money(group.price)}</strong> / zajęcia</span><span><strong>${active.length}</strong> zajęć w miesiącu</span><span><strong>${money(active.reduce((sum,session)=>sum+session.price,0))}</strong> za pełny miesiąc</span></div><h3>Zawodnicy</h3><div class="detail-roster">${members.map(member=>rosterRow(state.athletes.find(athlete=>athlete.id===member.athlete_id))+`<p class="hint">${member.status==='suspended'?'Udział zawieszony':member.status==='ended'?'Udział zakończony':member.status==='trial'?'Zapis próbny':member.ends_at?'Rezygnacja: miejsce zwalnia się '+escape(member.ends_at.slice(0,10)):'Aktywny udział'}</p>`).join('')||'<p class="hint">Brak zapisanych zawodników.</p>'}</div><h3>Lista rezerwowa</h3>${waitingMarkup(null,group.id)}<h3>Terminy zajęć</h3><div>${sessions.map(session=>termMarkup(session)).join('')||'<p class="hint">Brak terminów w tym miesiącu.</p>'}</div></div>`;
}

function seasonName(id) {return state.seasons.find(season=>season.id===id)?.name||'Bez sezonu';}
function groupStatusLabel(group) {
  const status={planned:'Planowana',active:'Aktywna',paused:'Wstrzymana',ended:'Zakończona'}[group.status]||group.status;
  return status+' · '+(group.registration_available?'zapisy otwarte':'zapisy zamknięte');
}
function renderSeasons() {
  const options=state.seasons.map(season=>`<option value="${season.id}">${escape(season.name)}${season.status==='archived'?' (archiwalny)':''}</option>`).join('');
  for(const [selector,first] of [['#group-season','<option value="">Bez przypisanego sezonu</option>'],['#group-filter-season','<option value="">Wszystkie sezony</option><option value="none">Bez sezonu</option>']]) {
    const select=$(selector),value=select.value;select.innerHTML=first+options;select.value=value;
  }
  $('#season-list').innerHTML=state.seasons.map(season=>`<div class="entry exclusion-entry"><div><strong>${escape(season.name)}</strong><small>${escape(season.start_date)} — ${escape(season.end_date)} · ${season.status==='archived'?'Archiwalny':'Aktywny'}</small><small>${state.groups.filter(group=>group.season_id===season.id).length} grup</small></div><button class="secondary" data-edit-season="${season.id}">Edytuj</button></div>`).join('')||'<p class="hint">Dodaj sezon, a następnie wybierz go w ustawieniach grupy.</p>';
}
function openSeason(id=null) {
  const form=$('#season-form');form.reset();form.elements.id.value=id||'';
  const season=state.seasons.find(season=>season.id===id);
  if(season)for(const field of ['name','start_date','end_date','status'])form.elements[field].value=season[field];
  $('#season-title').textContent=season?'Ustawienia sezonu':'Nowy sezon';openDialog('season-dialog');
}
function copyGroup(id) {
  openGroup(id);
  const form=$('#create-group');form.elements.id.value='';form.elements.location_id.disabled=false;
  form.elements.season_id.value='';form.elements.start_date.value='';form.elements.end_date.value='';
  form.elements.status.value='planned';form.elements.registration_open.checked=false;
  $('#new-group-title').textContent='Kopia grupy — nowy grafik';
  $('#group-edit-note').hidden=true;
  form.querySelector('[type=submit]').textContent='Utwórz kopię grupy';
}
function openLifecycle(id) {
  const group=state.groups.find(group=>group.id===id),form=$('#lifecycle-form');
  form.elements.id.value=id;
  form.elements.season_id.innerHTML=$('#group-season').innerHTML;
  form.elements.season_id.value=group.season_id??'';
  form.elements.status.value=group.status;
  form.elements.registration_open.checked=Boolean(group.registration_open);
  openDialog('lifecycle-dialog');
}
$('#lifecycle-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    await api('groups/lifecycle',{id:Number(form.elements.id.value),season_id:form.elements.season_id.value?Number(form.elements.season_id.value):null,status:form.elements.status.value,registration_open:form.elements.registration_open.checked});
    $('#lifecycle-dialog').close();await refresh();notice('Status i zapisy zapisane.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
};
function participationMarkup(member,history=true) {
  const periods=(state.membership_periods||[]).filter(period=>period.group_id===member.group_id&&period.athlete_id===member.athlete_id);
  const trial=(state.trial_decisions||[]).find(entry=>entry.athlete_id===member.athlete_id&&entry.group_id===member.group_id&&entry.trial_id===member.trial_id&&entry.status!=='converted');
  const trialAction=member.trial_id&&trial?`<p class="hint">${trial.status==='expired'?'Rezerwacja wygasła. Kontynuacja wymaga wolnego miejsca.':'Potwierdź kontynuację do '+escape(deadlineLabel(trial.expires_at))+'. Bez potwierdzenia miejsce zostanie zwolnione.'}</p><button class="secondary" data-trial-convert="${trial.enrollment_id}" data-child="${member.athlete_id}" ${state.now<trial.ends_at?'disabled':''}>${state.now<trial.ends_at?'Kontynuacja po zajęciach próbnych':'Przejdź na zapis stały'}</button>`:'';
  return `${trialAction}<p class="hint">Udział od ${escape(member.joined_at.slice(0,10))}${member.ends_at?' · miejsce zwalnia się '+escape(member.ends_at.slice(0,10)):''}</p>
    ${member.status==='active'?`<button class="secondary" ${member.ends_at?`data-cancel-withdrawal="${member.group_id}"`:`data-withdraw-group="${member.group_id}"`} data-child="${member.athlete_id}">${member.ends_at?'Cofnij rezygnację':'Zrezygnuj z końcem miesiąca'}</button>`:''}
    ${history?`<details class="participation-history"><summary>Historia uczestnictwa (${periods.length})</summary>${periods.map(period=>`<div class="entry"><strong>${period.status==='trial'?'Próbny':'Stały'} · od ${escape(period.starts_at.slice(0,10))}</strong><small>${period.ends_at?'Zakończenie: '+escape(period.ends_at.replace('T',' ').slice(0,16)):'Bez wyznaczonego zakończenia'}</small>${period.withdrawal_reason?`<p>${escape(period.withdrawal_reason)}</p>`:''}</div>`).join('')}</details>`:''}`;
}
function openWithdrawal(athleteId,groupId) {
  const form=$('#withdrawal-form');form.reset();
  form.elements.athlete_id.value=athleteId;form.elements.group_id.value=groupId;form.elements.month.value=state.now.slice(0,7);
  const athlete=state.athletes.find(athlete=>athlete.id===athleteId),group=state.groups.find(group=>group.id===groupId);
  $('#withdrawal-summary').textContent=`${athlete.name} · ${group.name}. Miejsce zostanie zwolnione ${state.withdrawal_ends_at.slice(0,10)} o 00:00 (czas polski).`;
  openDialog('withdrawal-dialog');
}
$('#withdrawal-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    const id=Number(form.elements.athlete_id.value);
    const result=await api('memberships/withdraw',{athlete_id:id,group_id:Number(form.elements.group_id.value),month:form.elements.month.value,reason:form.elements.reason.value});
    $('#withdrawal-dialog').close();await refresh();
    if($('#athlete-detail-dialog').open){openAthleteDetail(id);selectAthleteTab('groups');}
    notice('Rezygnacja zapisana. Miejsce zwolni się '+result.ends_at.slice(0,10)+'. Opłata za bieżący miesiąc bez zmian.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
};
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-cancel-withdrawal]');if(!button)return;
  if(!confirm('Cofnąć rezygnację i zachować udział w tej grupie?'))return;
  button.disabled=true;
  try {
    const id=Number(button.dataset.child);
    await api('memberships/cancel-withdrawal',{athlete_id:id,group_id:Number(button.dataset.cancelWithdrawal),month:state.now.slice(0,7)});
    await refresh();if($('#athlete-detail-dialog').open){openAthleteDetail(id);selectAthleteTab('groups');}
    notice('Rezygnacja cofnięta. Udział trwa dalej.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});
$('#season-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    const body=Object.fromEntries(new FormData(form));
    await api(body.id?'seasons/update':'seasons',{...body,id:body.id?Number(body.id):undefined});
    $('#season-dialog').close();await refresh();notice('Sezon zapisany.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
};
for(const selector of ['#group-filter-season','#group-filter-status'])$(selector).onchange=()=>{
  selectedAdminGroup=null;renderCalendar();
};
$('#group-season').onchange=()=>{
  const form=$('#create-group'),season=state.seasons.find(season=>season.id===Number($('#group-season').value));
  if(!form.elements.id.value&&season) {
    if(!form.elements.start_date.value)form.elements.start_date.value=season.start_date;
    if(!form.elements.end_date.value)form.elements.end_date.value=season.end_date;
  }
};

function renderRegistrationGroups() {
  const locationId=Number($('#location').value);
  if(!locationId){$('#available-groups').innerHTML='';return;}
  const groups=state.groups.filter(group=>group.location_id===locationId&&group.registration_available);
  $('#available-groups').innerHTML=groups.map(group=>{
    const free=Math.max(0,group.capacity-group.member_count-(group.reserved_count||0));
    const next=state.sessions.find(session=>session.group_id===group.id&&!session.excluded&&session.starts_at>=state.now&&session.starts_at.startsWith(state.now.slice(0,7)));
    const ownMember=state.memberships.some(member=>member.group_id===group.id&&member.status!=='ended'&&state.athletes.some(athlete=>athlete.id===member.athlete_id));
    const eligible=Boolean(next);
    return `<div class="registration-group"><div class="registration-group-main"><h2>${escape(group.name)}</h2><p>${escape(groupAgeLabel(group))}</p><p>${escape(scheduleLabel(group))}</p>${group.parent_description?`<p>${escape(group.parent_description)}</p>`:''}${group.activity_type?`<p>${escape(group.activity_type)}</p>`:''}<p>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ')||'Nie przypisano')}</p>${next?`<p class="hint">Najbliższe zajęcia: ${escape(termLabel(next))}</p>`:''}<p>${money(group.price)} / zajęcia</p></div><div class="registration-group-action"><span class="availability ${free===0?'full':''}">Wolne miejsca: ${free} / ${group.capacity}</span><button class="primary" data-register-group="${group.id}" ${eligible?'':'disabled'}>${!next?'Brak zajęć w tym miesiącu':free===0&&!ownMember?'Dołącz do listy rezerwowej':'Zapisz dziecko'}</button></div></div>`;
  }).join('')||'<p class="hint">W tej lokalizacji nie ma jeszcze grup.</p>';
}

function openEnrollment(groupId) {
  const group=state.groups.find(entry=>entry.id===groupId);
  $('#group').value=groupId;
  $('[name="month"]').value=state.now.slice(0,7);
  updateTrials();
  openDialog('enrollment-dialog');
}

function renderTrainers() {
  $('#trainer-list').innerHTML = state.trainers.map(trainer => {
    const groups = state.groups.filter(g => state.group_trainers.some(a => a.group_id === g.id && a.trainer_id === trainer.id));
    const initials = trainer.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('');
    return `<article class="trainer-card trainer-record"><div class="trainer-record-heading"><div class="avatar">${escape(initials)}</div><div><h2>${escape(trainer.name)}</h2><span class="pill">${{active:'Aktywny',inactive:'Nieaktywny',archived:'Archiwalny'}[trainer.status]}</span></div><div class="trainer-contact">${escape(trainer.email||'Brak adresu email')}<br>${escape(trainer.phone||'Brak telefonu')}</div><div class="trainer-actions"><button class="primary" data-trainer-profile="${trainer.id}">Otwórz kartę</button><button class="secondary" data-edit-trainer="${trainer.id}">Edytuj</button>${trainer.status==='active'&&!trainer.account_active?`<button class="secondary" data-trainer-account="${trainer.id}">${trainer.user_id?'Nowy link aktywacyjny':'Utwórz konto'}</button>`:''}</div></div><details class="trainer-record-details"><summary>Grupy i dostęp do panelu <span>${groups.length} grup</span></summary><div class="trainer-groups">${groups.map(g=>`<button class="trainer-group" data-assign="${g.id}">${escape(g.location)} / ${escape(g.name)}</button>`).join('')||'<p class="hint">Brak przypisanych grup.</p>'}</div></details><p class="hint account-state">${trainer.user_id?(trainer.account_active?'Konto aktywowane':'Konto czeka na aktywację'):'Brak konta logowania'}</p></article>`;
  }).join('') || emptyState('users', 'Poznajmy Twój zespół', 'Dodaj trenerów, a następnie przypisz ich do odpowiednich grup.', '<button class="secondary" data-open="trainer-dialog">Dodaj trenera</button>');
}

function updateExclusionTargets() {
  const scope = $('#exclude-scope').value;
  const previous = [...$('#exclude-target').querySelectorAll('input:checked')].map(input => input.value);
  $('#exclude-target-label').hidden = scope === 'all';
  const options = scope === 'location' ? state.locations.map(location => [String(location.id), location.name]) : scope === 'group' ? state.groups.map(g => [String(g.id), g.location + ' / ' + g.name]) : [];
  $('#exclude-target').innerHTML = options.map(([value, label]) => `<label class="check"><input type="checkbox" value="${escape(value)}" ${previous.includes(value) ? 'checked' : ''}>${escape(label)}</label>`).join('');
}

function renderExclusions() {
  $('#exclusions').innerHTML = state.exclusions.map(exclusion => {
    const group = state.groups.find(g => g.id === exclusion.group_id);
    const scope = exclusion.scope === 'all' ? 'Wszystkie lokalizacje' : exclusion.scope === 'location' ? exclusion.location : group?.location + ' / ' + group?.name;
    return `<div class="entry exclusion-entry"><div><strong>${escape(exclusion.reason)}</strong><small>${escape(exclusion.start_date)} — ${escape(exclusion.end_date)}<br>${escape(scope)}</small></div><button type="button" class="secondary" data-remove-exclusion="${exclusion.id}">Usuń wykluczenie</button></div>`;
  }).join('') || emptyState('calendar', 'Bez zaplanowanych przerw', 'Dodaj święta lub inne dni wolne, żeby wyłączyć je z grafiku i rozliczeń.');
}

function openAssignment(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  $('#assign-trainers [name="group_id"]').value = groupId;
  $('#assignment-group').textContent = group.location + ' / ' + group.name;
  $('#assignment-options').innerHTML = trainerCheckboxes(trainersFor(groupId).map(t => t.id)) || '<p class="hint">Najpierw dodaj trenerów w dziale „Trenerzy”.</p>';
  openDialog('assignment-dialog');
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-new-location')) openLocation();
  if (button.dataset.editLocation) openLocation(Number(button.dataset.editLocation));
  if (button.dataset.view) {
    button.closest('dialog')?.close();
    window.location.hash = button.dataset.view;
    switchView(button.dataset.view);
  }
  if (button.dataset.open) button.dataset.open === 'group-dialog' ? openGroup() : button.dataset.open === 'trainer-dialog' ? openTrainer() : openDialog(button.dataset.open);
  if(button.dataset.editTrainer)openTrainer(Number(button.dataset.editTrainer));
  if(button.dataset.trainerAccount)createTrainerAccount(Number(button.dataset.trainerAccount),button);
  if(button.dataset.coachNote)openCoachNote(Number(button.dataset.coachNote));
  if (button.dataset.editGroup) openGroup(Number(button.dataset.editGroup));
  if(button.hasAttribute('data-new-season'))openSeason();
  if(button.dataset.editSeason)openSeason(Number(button.dataset.editSeason));
  if(button.dataset.copyGroup)copyGroup(Number(button.dataset.copyGroup));
  if(button.dataset.lifecycle)openLifecycle(Number(button.dataset.lifecycle));
  if(button.dataset.withdrawGroup)openWithdrawal(Number(button.dataset.child),Number(button.dataset.withdrawGroup));
  if (button.dataset.locationGroups) { selectedGroupLocation=Number(button.dataset.locationGroups); selectedAdminGroup=null; window.location.hash='groups'; renderCalendar(); }
  if (button.hasAttribute('data-back-locations')) {selectedGroupLocation=null;selectedAdminGroup=null;renderCalendar();}
  if(button.hasAttribute('data-back-groups')){selectedAdminGroup=null;renderCalendar();}
  if(button.dataset.enterGroup){selectedAdminGroup=Number(button.dataset.enterGroup);renderCalendar();}
  if(button.dataset.registerGroup)openEnrollment(Number(button.dataset.registerGroup));
  if (button.dataset.roster) openRoster(Number(button.dataset.roster));
  if (button.dataset.athlete) openAthleteDetail(Number(button.dataset.athlete));
  if (button.dataset.athleteTab) selectAthleteTab(button.dataset.athleteTab);
  if (button.hasAttribute('data-new-athlete')) openAthlete();
  if (button.dataset.editAthlete) openAthlete(Number(button.dataset.editAthlete));
  if (button.dataset.invite) createInvitation(Number(button.dataset.invite));
  if (button.dataset.enrollAthlete) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    window.location.hash = 'parent'; switchView('parent');
    $('#enrollment-athlete').value = button.dataset.enrollAthlete;
    $('#location').focus();
  }
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
  if (button.dataset.assign) openAssignment(Number(button.dataset.assign));
});
window.addEventListener('hashchange', () => {
  if(window.location.hash.startsWith('#reset/')){authInfo.user=null;showAuth();return;}
  if(authInfo.user) {
    if(window.location.hash.startsWith('#guardian/'))showGuardianAcceptance();
    else switchView(window.location.hash.slice(1));
  }else showAuth(authMode);
});
switchView(window.location.hash.slice(1));

$('#audit-refresh').onclick=()=>loadAudit();
$('#audit-more').onclick=()=>loadAudit(true);
$('#location-status-filter').onchange=renderLocations;
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-parent-access]');
  if(!button)return;
  if(!confirm(button.dataset.accessStatus==='blocked'?'Zablokować konto rodzica i zakończyć jego sesje?':'Odblokować konto rodzica?'))return;
  button.disabled=true;
  try {
    await api('parents/access',{parent_id:Number(button.dataset.parentAccess),access_status:button.dataset.accessStatus});
    await refresh();openAthleteDetail(Number(button.dataset.profile));selectAthleteTab('parent');notice('Dostęp do konta został zmieniony.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});
$('#location').onchange = updateGroups;
$('#group').onchange = updateTrials;
$('[name="month"]').onchange = updateTrials;
$('#trial').onchange = updateQuote;
$('#calendar-month').onchange = renderCalendar;
$('#exclude-scope').onchange = updateExclusionTargets;

$('#save-location').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = form.querySelector('[type="submit"]');
  const body = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    const result = await api(body.id ? 'locations/update' : 'locations', { ...body, ...(body.id ? { id: Number(body.id) } : {}) });
    $('#location-dialog').close();
    await refresh();
    $('#group-location').value = result.id;
    notice(body.id ? 'Ustawienia placówki zostały zapisane.' : 'Lokalizacja dodana. Możesz teraz wybrać ją przy tworzeniu grupy.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#create-group').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const body = Object.fromEntries(new FormData(form));
  try {
    const result = await api(body.id ? 'groups/update' : 'groups', { ...body, min_age:body.min_age===''?null:Number(body.min_age),max_age:body.max_age===''?null:Number(body.max_age),questions:body.questions_text.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({label:s.startsWith('*')?s.slice(1).trim():s,required:false})), id: body.id ? Number(body.id) : undefined, location_id: Number($('#group-location').value), season_id: $('#group-season').value?Number($('#group-season').value):null, registration_open: form.elements.registration_open.checked, price: Math.round(Number(body.price) * 100), trial_price: Math.round(Number(body.trial_price) * 100), capacity: Number(body.capacity), trials: body.trials === 'on', weekday: Number(body.weekday), trainer_ids: selectedIds('#new-group-trainers') });
    form.reset();
    $('#group-dialog').close();
    await refresh();
    notice(body.id ? 'Ustawienia grupy zapisane. Przyszły grafik i należności zostały przeliczone.' : `Grupa zapisana. Automatycznie utworzono ${result.count} terminów.`);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#create-trainer').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const body=Object.fromEntries(new FormData(form));
    await api(body.id?'trainers/update':'trainers',{...body,id:body.id?Number(body.id):undefined});
    form.reset();
    $('#trainer-dialog').close();
    await refresh();
    if($('#trainer-profile-dialog').open)await openTrainerProfile(Number(body.id),'data');
    notice('Dane trenera zostały zapisane.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#assign-trainers').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('groups/trainers', { group_id: Number($('#assign-trainers [name="group_id"]').value), trainer_ids: selectedIds('#assignment-options') });
    $('#assignment-dialog').close();
    await refresh();
    notice('Przypisanie trenerów zostało zapisane.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#enroll').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('enrollments', enrollmentBody());
    $('#enrollment-dialog').close();
    await refresh();
    notice(result.queued?'Zgłoszenie na listę rezerwową zapisane. Sprawdzaj oferty w Moich dzieciach.':`Zapis potwierdzony. Należność: ${money(result.amount)}.`);
  } catch (error) { notice(error.message, true); }
  finally { updateQuote(); }
};

$('#enrollments').onclick = async event => {
  const id = event.target.dataset.adjust;
  if (!id) return;
  const value = prompt('Kwota korekty w zł. Obniżka: kwota ujemna, np. -50.');
  if (value === null || !value.trim()) return;
  const amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount)) { notice('Podaj poprawną kwotę.', true); return; }
  const reason = prompt('Powód korekty:');
  if (!reason) return;
  try {
    await api('adjustments', { enrollment_id: Number(id), amount: Math.round(amount * 100), reason });
    await refresh();
    notice('Korekta została zapisana w historii.');
  } catch (error) { notice(error.message, true); }
};

$('#exclude-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, body = Object.fromEntries(new FormData(form));
  const targets = [...$('#exclude-target').querySelectorAll('input:checked')].map(input => input.value);
  if (body.scope !== 'all' && !targets.length) { notice('Wybierz co najmniej jedną lokalizację lub grupę.', true); return; }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('exclusions', { ...body, targets: body.scope === 'all' ? [] : targets });
    form.reset();
    $('#exclusion-dialog').close();
    await refresh();
    notice('Wykluczenia zapisane. Grafik i należności zostały przeliczone.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#exclusions').onclick = async event => {
  const id = event.target.dataset.removeExclusion;
  if (!id) return;
  if (!confirm('Usunąć wykluczenie? Terminy i związane z nimi należności zostaną przywrócone, o ile nie obejmuje ich inne wykluczenie.')) return;
  try {
    await api('exclusions/remove', { id: Number(id) });
    await refresh();
    notice('Wykluczenie usunięte. Grafik i należności zostały przeliczone.');
  } catch (error) { notice(error.message, true); }
};

$('#logo-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = form.querySelector('button');
  const file = form.querySelector('input').files[0];
  if (!file) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/logo', { method: 'POST', body: file });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await refresh();
    form.reset();
    notice('Logo zapisane. Jest widoczne w menu po lewej stronie.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#calendar-month').value = $('[name="month"]').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' }).format(new Date());
initialize().catch(error => notice(error.message, true));

function openGroup(id = null) {
  const form = $('#create-group');
  form.reset();
  form.elements.id.value = id || '';
  const group = state.groups.find(entry => entry.id === id);
  form.elements.location_id.disabled=Boolean(group);
  $('#new-group-title').textContent = group ? 'Ustawienia grupy' : 'Nowa grupa';
  $('#group-edit-note').hidden = !group;
  form.querySelector('[type="submit"]').textContent = group ? 'Zapisz zmiany' : 'Utwórz grupę';
  if (group) {
    form.elements.questions_text.value=JSON.parse(group.questions||'[]').map(q=>q.label).join('\n');
    for (const key of ['activity_type','parent_description','min_age','max_age','name','location_id','capacity','price','trial_price','start_date','end_date','start_time','end_time','weekday','season_id','status']) {
      if (group[key] !== null) form.elements[key].value = ['price','trial_price'].includes(key) ? group[key] / 100 : group[key];
    }
    form.elements.trials.checked = Boolean(group.trials);
    form.elements.registration_open.checked=Boolean(group.registration_open);
    const terms = state.sessions.filter(session => session.group_id === id && !session.cancelled);
    if (!group.start_date && terms.length) {
      form.elements.start_date.value = terms[0].starts_at.slice(0,10);
      form.elements.end_date.value = terms.at(-1).starts_at.slice(0,10);
      form.elements.start_time.value = terms[0].starts_at.slice(11,16);
      const end = new Date(terms[0].starts_at + 'Z'); end.setUTCMinutes(end.getUTCMinutes() + 30);
      form.elements.end_time.value = end.toISOString().slice(11,16);
      form.elements.weekday.value = new Date(terms[0].starts_at.slice(0,10)+'T00:00:00Z').getUTCDay();
    }
  } else if (selectedGroupLocation) form.elements.location_id.value = selectedGroupLocation;
  $('#new-group-trainers').innerHTML = trainerCheckboxes(group ? trainersFor(id).map(trainer => trainer.id) : []);
  openDialog('group-dialog');
}

function rosterRow(athlete) {
  const parent = state.parents.find(entry => entry.id === athlete.parent_id);
  return `<div class="entry exclusion-entry"><div><strong>${escape(athlete.name)}</strong><small>Rodzic: ${escape(parent?.name || '—')} · ${escape(parent?.email || '')}</small></div><button class="secondary" data-athlete="${athlete.id}">Kartoteka</button></div>`;
}
function parentsFor(athleteId) {
  const ids=new Set((state.guardian_links||[]).filter(link=>link.athlete_id===athleteId).map(link=>link.user_id));
  return state.parents.filter(parent=>ids.has(parent.id));
}

let rosterGroupId;
function openRoster(groupId) {
  rosterGroupId=groupId;
  const group = state.groups.find(entry => entry.id === groupId);
  const members = state.memberships.filter(member => member.group_id === groupId);
  $('#roster-title').textContent = `${group.name} · ${group.member_count} / ${group.capacity}`;
  $('#group-roster').innerHTML = `<p class="hint">${escape(group.location)}</p>` + (members.map(member => {
    const athlete = state.athletes.find(entry => entry.id === member.athlete_id);
    return (['active','suspended'].includes(member.status)?`<label class="check"><input type="checkbox" data-member-selection="${athlete.id}">Wybierz ${escape(athlete.name)}</label>`:'')+rosterRow(athlete) + (member.status==='suspended'?'<span class="pill">Udział zawieszony</span>':member.status==='ended'?'<span class="pill">Udział zakończony</span>':member.status === 'trial' ? '<span class="pill">Zapis próbny</span>' : '');
  }).join('') || '<p>W tej grupie nie ma jeszcze zapisanych zawodników.</p>');
  openDialog('roster-dialog');
}

function renderAthletes() {
  updateDirectoryFilters('athlete');
  const search = $('#athlete-search').value.trim().toLocaleLowerCase('pl');
  const location = $('#athlete-filter-location').value, group = $('#athlete-filter-group').value;
  const status = $('#athlete-filter-status').value;
  const season=$('#athlete-filter-season').value;
  const matches = state.athletes.filter(athlete => {
    const parent = state.parents.find(entry => entry.id === athlete.parent_id);
    const memberships = state.memberships.filter(member => member.athlete_id === athlete.id);
    const membershipMatches = memberships.some(member => {
      const assignedGroup = state.groups.find(entry=>entry.id===member.group_id);
      return (!location || String(assignedGroup?.location_id) === location)
        && (!group || String(member.group_id) === group)
        && matchesSeason(assignedGroup,season)
        && (!status || member.status === status);
    });
    return [athlete.name, parent?.name, parent?.email,...parentsFor(athlete.id).flatMap(parent=>[parent.name,parent.email,parent.phone])].join(' ').toLocaleLowerCase('pl').includes(search)
      && (status === 'none' ? memberships.length === 0 && !location && !group && !season : (!location && !group && !status && !season) || membershipMatches);
  }).sort((a,b)=>a.name.localeCompare(b.name,'pl') || a.id-b.id);
  const visible = directorySlice('athlete',matches);
  $('#athlete-list').innerHTML = `<p class="athlete-count">Liczba zawodników: ${matches.length} z ${state.athletes.length}</p>` + (visible.length
    ? `<div class="table-scroll"><table class="directory-table"><thead><tr><th scope="col">Zawodnik</th><th scope="col">Data urodzenia</th><th scope="col">Rodzic / kontakt</th><th scope="col">Rozliczenia</th><th scope="col">Kartoteka</th></tr></thead><tbody>${visible.map(athleteTableRow).join('')}</tbody></table></div>`
    : emptyState('users','Brak zawodników','Brak zawodników pasujących do wybranych filtrów.'));
}

function athleteTableRow(athlete) {
 const parent=state.parents.find(p=>p.id===athlete.parent_id);
 const charges=state.enrollments.filter(e=>e.athlete_id===athlete.id);
 const overdue=charges.reduce((sum,e)=>sum+e.overdue_amount,0);
 const balance=charges.reduce((sum,e)=>sum+e.balance,0);
 const status=overdue>0?`<span class="status-badge danger">Po terminie: ${money(overdue)}</span>`:balance>0?`<span class="status-badge">Do zapłaty: ${money(balance)}</span>`:balance<0?`<span class="status-badge success">Nadpłata: ${money(-balance)}</span>`:charges.length?'<span class="status-badge success">Rozliczone</span>':'<span class="status-badge neutral">Brak należności</span>';
 return `<tr><td><strong>${escape(athlete.name)}</strong><small>#${athlete.id}</small></td><td>${athlete.birth_date?escape(athlete.birth_date.split('-').reverse().join('.')):'—'}</td><td>${escape(parent?.name||'—')}<small>${escape(parent?.email||'')}<br>${escape(parent?.phone||'')}</small></td><td>${status}</td><td><button class="secondary" data-athlete="${athlete.id}" aria-label="Kartoteka: ${escape(athlete.name)}">Otwórz →</button></td></tr>`;
}

function updateAthleteSelects() {
  const selected = $('#enrollment-athlete').value;
  $('#enrollment-athlete').innerHTML = '<option value="">Wybierz dziecko</option>' + state.athletes.map(athlete => `<option value="${athlete.id}">${escape(athlete.name)}</option>`).join('');
  $('#enrollment-athlete').value = selected;
  $('#athlete-parent').innerHTML = '<option value="">Wybierz rodzica</option>' + state.parents.map(parent => `<option value="${parent.id}">${escape(parent.name)} · ${escape(parent.email)}</option>`).join('');
}

function openAthlete(id = null) {
  const form = $('#save-athlete'), athlete = state.athletes.find(entry => entry.id === id);
  form.reset();
  form.elements.id.value = id || '';
  for (const key of ['name','birth_date','notes','parent_id']) if (athlete?.[key] != null) form.elements[key].value = athlete[key];
  const admin = state.user.role === 'admin';
  $('#athlete-parent-label').hidden = !admin;
  form.elements.parent_id.required = admin;
  $('#athlete-notes-label').hidden = !admin;
  $('#athlete-form-title').textContent = athlete ? 'Edytuj kartotekę' : 'Dodaj dziecko';
  openDialog('athlete-dialog');
}

function openAthleteDetail(id) {
  const athlete = state.athletes.find(entry => entry.id === id);
  const parent = state.parents.find(entry => entry.id === athlete.parent_id);
  const admin = state.user.role === 'admin';
  const parentActive = Boolean(parent?.active ?? !admin);
  const memberships = state.memberships.filter(member => member.athlete_id === id);
  const charges = state.enrollments.filter(enrollment => enrollment.athlete_id === id);
  const balance = charges.reduce((total,charge)=>total+charge.balance,0)-(state.finance?.payments||[]).filter(p=>p.athlete_id===id).reduce((sum,p)=>sum+p.credit,0);
  const outstanding = Math.max(0,balance);
  const credit = Math.max(0,-balance);
  const previousDue = charges.reduce((total,charge)=>total+charge.overdue_amount,0);
  const tabs = [['data','Dane'],['parent','Opiekunowie'],['groups','Grupy'],['attendance','Obecności'],['finances','Rozliczenia']];
  $('#athlete-detail').dataset.athleteId=id;
  $('#athlete-detail-title').textContent = athlete.name;
  $('#athlete-detail').innerHTML = `
    <div class="profile-summary"><span>Zawodnik #${id}</span><span>${memberships.filter(m=>['active','trial'].includes(m.status)).length} aktywnych grup</span><span>Do zapłaty: <strong>${money(outstanding)}</strong></span>${previousDue?`<span class="status-badge danger">Po terminie: ${money(previousDue)}</span>`:''}</div>
    <div class="athlete-tabs" role="tablist" aria-label="Kartoteka zawodnika">${tabs.map(([key,label],index)=>`<button type="button" role="tab" id="athlete-tab-${key}" aria-controls="athlete-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}" data-athlete-tab="${key}">${label}</button>`).join('')}</div>
    <section role="tabpanel" id="athlete-panel-data" aria-labelledby="athlete-tab-data" tabindex="0">
      ${(state.registration_answers||[]).filter(r=>r.athlete_id===id).map(r=>`<details class="entry"><summary>Formularz: ${escape(state.groups.find(g=>g.id===r.group_id)?.name||'Grupa')}</summary>${Object.entries(JSON.parse(r.values_json)).map(([label,value])=>`<p><strong>${escape(label)}</strong>: ${escape(value||'—')}</p>`).join('')}</details>`).join('')}<dl class="athlete-fields"><div><dt>Imię i nazwisko</dt><dd>${escape(athlete.name)}</dd></div><div><dt>Data urodzenia</dt><dd>${escape(athlete.birth_date||'Nie podano')}</dd></div>${admin?`<div class="athlete-note"><dt>Notatka administracyjna</dt><dd>${escape(athlete.notes||'Brak notatki')}</dd></div>`:''}</dl>
      <button class="secondary" data-edit-athlete="${id}">Edytuj dane</button>
      ${admin?(state.trainer_notes||[]).filter(note=>note.athlete_id===id).map(note=>`<div class="profile-group"><h3>Notatka trenera · ${escape(state.trainers.find(trainer=>trainer.id===note.trainer_id)?.name||'Trener')}</h3><p class="coach-note-body">${escape(note.body||'Brak notatki')}</p></div>`).join(''):''}
    </section>
    <section role="tabpanel" id="athlete-panel-groups" aria-labelledby="athlete-tab-groups" tabindex="0" hidden>
      <div class="profile-section-heading"><h3>Przypisane grupy</h3><button class="secondary" data-enroll-athlete="${id}">Zapisz do grupy</button></div>
      ${waitingMarkup(id)}${memberships.map(member=>{
        const group=state.groups.find(entry=>entry.id===member.group_id);
        return `<div class="profile-group"><h3>${escape(group.name)}</h3><p>${escape(group.location)}</p><p>${escape(scheduleLabel(group))}</p>${group.parent_description?`<p>${escape(group.parent_description)}</p>`:''}${group.activity_type?`<p>${escape(group.activity_type)}</p>`:''}<p>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ')||'Nie przypisano')}</p><span class="pill">${member.status==='suspended'?'Udział zawieszony':member.status==='ended'?'Udział zakończony':member.status==='trial'?'Zapis próbny':'Zapis stały'}</span>${participationMarkup(member)}</div>`;
      }).join('')||'<p class="hint">Zawodnik nie jest jeszcze przypisany do grupy.</p>'}
    </section>
    <section role="tabpanel" id="athlete-panel-parent" aria-labelledby="athlete-tab-parent" tabindex="0" hidden>
      ${(state.registration_answers||[]).filter(r=>r.athlete_id===id).map(r=>`<details class="entry"><summary>Formularz: ${escape(state.groups.find(g=>g.id===r.group_id)?.name||'Grupa')}</summary>${Object.entries(JSON.parse(r.values_json)).map(([label,value])=>`<p><strong>${escape(label)}</strong>: ${escape(value||'—')}</p>`).join('')}</details>`).join('')}<dl class="athlete-fields"><div><dt>Rodzic</dt><dd>${escape(parent?.name||'Nie podano')}</dd></div><div><dt>Email</dt><dd>${escape(parent?.email||'Nie podano')}</dd></div><div><dt>Telefon</dt><dd>${escape(parent?.phone||'Nie podano')}</dd></div><div><dt>Konto rodzica</dt><dd>${parent?.access_status==='blocked'?'Zablokowane':parentActive?'Aktywne':'Oczekuje na aktywację'}</dd></div></dl>
      ${admin&&parent?.access_status!=='blocked'&&!parentActive?`<button class="secondary" data-invite="${athlete.parent_id}">Utwórz link aktywacyjny</button>`:''}
      ${admin?`<button class="secondary" data-parent-access="${athlete.parent_id}" data-access-status="${parent?.access_status==='blocked'?'active':'blocked'}" data-profile="${id}">${parent?.access_status==='blocked'?'Odblokuj konto rodzica':'Zablokuj konto rodzica'}</button>`:''}
      ${(state.guardian_links||[]).filter(link=>link.athlete_id===id&&!link.primary_guardian).map(link=>{
        const guardian=state.parents.find(parent=>parent.id===link.user_id);
        return `<div class="entry"><strong>${escape(guardian?.name||'Opiekun')}</strong><small>${escape(guardian?.email||'')} · ${escape(guardian?.phone||'Brak telefonu')} · ${guardian?.access_status==='blocked'?'Zablokowane':'Dostęp potwierdzony'}</small>${admin||athlete.parent_id===state.user.id||link.user_id===state.user.id?`<button class="secondary" data-revoke-guardian="${link.user_id}" data-child="${id}">Cofnij dostęp do dziecka</button>`:''}${admin?`<button class="secondary" data-parent-access="${link.user_id}" data-access-status="${guardian?.access_status==='blocked'?'active':'blocked'}" data-profile="${id}">${guardian?.access_status==='blocked'?'Odblokuj konto rodzica':'Zablokuj konto rodzica'}</button>`:''}</div>`;
      }).join('')}
      ${(state.guardian_invitations||[]).filter(invitation=>invitation.athlete_id===id).map(invitation=>`<div class="entry"><strong>${escape(invitation.email)}</strong><small>Oczekuje na przyjęcie zaproszenia</small>${admin||athlete.parent_id===state.user.id||invitation.invited_by===state.user.id?`<button class="secondary" data-cancel-guardian="${invitation.id}" data-child="${id}">Cofnij zaproszenie</button>`:''}</div>`).join('')}
      <div class="trainer-actions"><button class="secondary" data-invite-guardian="${id}">Zaproś kolejnego opiekuna</button></div>
    </section>
    <section role="tabpanel" id="athlete-panel-attendance" aria-labelledby="athlete-tab-attendance" tabindex="0" hidden><div id="athlete-attendance-content" aria-live="polite"></div></section>
    <section role="tabpanel" id="athlete-panel-finances" aria-labelledby="athlete-tab-finances" tabindex="0" hidden>
      <div class="athlete-finance-summary"><div><span>Do zapłaty</span><strong>${money(outstanding)}</strong></div><div><span>Nadpłata</span><strong>${money(credit)}</strong></div><div><span>Po terminie</span><strong>${money(previousDue)}</strong></div></div>
      ${state.finance?.settings.bank_account?`<div class="entry"><strong>Przelew tradycyjny</strong><p>Rachunek: ${escape(state.finance.settings.bank_account)}</p><p>Tytuł: EA / zawodnik ${id} / ${escape(state.now.slice(0,7))}</p><small>Termin płatności znajdziesz przy każdej należności poniżej.</small></div>`:''}<p class="hint">Saldo naliczeń: ${money(balance)}. Kwota dodatnia oznacza należność, ujemna — nadpłatę. Płatności online nie są jeszcze podłączone.</p>
      <h3 class="profile-ledger-title">Wpłaty i zwroty</h3>${(state.finance?.payments||[]).filter(p=>p.athlete_id===id).map(p=>`<div class="entry"><strong>${money(p.amount)} · ${escape(p.paid_on)}</strong><small>${escape(p.reference)} · wolne środki ${money(p.credit)}</small>${(state.finance.refunds||[]).filter(r=>r.payment_id===p.id).map(r=>`<small>Zwrot ${money(r.amount)} · ${r.status==='paid'?'wykonany':'zatwierdzony do wykonania'}</small>`).join('')}</div>`).join('')||'<p class="hint">Brak wpłat.</p>'}
      <h3 class="profile-ledger-title">Historia rozliczeń</h3>
      ${charges.map(charge=>`<div class="entry"><div class="profile-charge-heading"><strong>${escape(charge.month)} · ${escape(charge.group_name)}</strong><strong>${money(charge.balance)}</strong></div><small>${escape(charge.location)} · naliczono ${money(charge.amount)}</small><small>${escape(paymentDeadlineLabel(charge))}</small>${(state.finance?.deadlines||[]).filter(d=>d.enrollment_id===charge.id).map(d=>`<small>Zmiana terminu na ${escape(d.new_due_on)}: ${escape(d.reason)}</small>`).join('')}${state.adjustments.filter(adjustment=>adjustment.enrollment_id===charge.id).map(adjustment=>`<small>${escape(adjustment.created_at.slice(0,10))} · ${money(adjustment.amount)} · ${escape(adjustment.reason)}</small>`).join('')}</div>`).join('')||'<p class="hint">Brak naliczeń.</p>'}
    </section>`;
  openDialog('athlete-detail-dialog');
}

function selectAthleteTab(key,focus=false) {
  if(key==='attendance')loadAthleteAttendance(Number($('#athlete-detail').dataset.athleteId));
  for(const tab of document.querySelectorAll('#athlete-detail [role="tab"]')) {
    const active=tab.dataset.athleteTab===key;
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;
    if(active&&focus)tab.focus();
  }
}
$('#athlete-detail').addEventListener('keydown',event=>{
  const tab=event.target.closest('[role="tab"]');
  if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const tabs=[...document.querySelectorAll('#athlete-detail [role="tab"]')];
  const index=tabs.indexOf(tab);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  selectAthleteTab(tabs[next].dataset.athleteTab,true);
});

function renderMyChildren() {
  $('#my-children').innerHTML = state.athletes.map(athlete => {
    const memberships = state.memberships.filter(member => member.athlete_id === athlete.id);
    const balance = state.enrollments.filter(enrollment => enrollment.athlete_id === athlete.id).reduce((sum,enrollment)=>sum+enrollment.balance,0)-(state.finance?.payments||[]).filter(p=>p.athlete_id===athlete.id).reduce((sum,p)=>sum+p.credit,0);
    return `<article class="section-card child-card"><h2>${escape(athlete.name)}</h2><p class="hint">Należności: ${money(balance)} · Po terminie: ${money(state.enrollments.filter(e=>e.athlete_id===athlete.id).reduce((sum,e)=>sum+e.overdue_amount,0))}</p>${waitingMarkup(athlete.id)}${memberships.map(member=>{
      const group=state.groups.find(entry=>entry.id===member.group_id);
      const terms=state.sessions.filter(session=>session.group_id===group.id&&session.starts_at>=state.now&&(!member.ends_at||session.starts_at<member.ends_at)&&member.status!=='ended'&&(!session.cancelled||member.trial_id===session.id)&&(!member.trial_id||session.id===member.trial_id)).slice(0,6);
      return `<div class="child-group"><h3>${escape(group.location)} / ${escape(group.name)}</h3><p class="hint">${member.status==='suspended'?'Udział zawieszony':member.status==='ended'?'Udział zakończony':member.status==='trial'?'Zajęcia próbne':'Zapis stały'}${group.start_time?' · '+escape(group.start_time)+'–'+escape(group.end_time):''}</p><p class="hint">Najbliższe terminy:</p>${terms.map(session=>termMarkup(session)).join('')||'<p class="hint">Brak przyszłych terminów.</p>'}${participationMarkup(member,false)}</div>`;
    }).join('')||((state.waiting_list||[]).some(entry=>entry.athlete_id===athlete.id&&['waiting','offered'].includes(entry.status))?'':'<p>Dziecko nie jest jeszcze przypisane do grupy. Wybierz zajęcia w zakładce „Zapisy na zajęcia”.</p>')}<button class="secondary" data-athlete="${athlete.id}">Kartoteka i rozliczenia</button></article>`;
  }).join('')||emptyState('users','Dodaj swoje dziecko','Najpierw dodaj dane dziecka, a potem wybierz lokalizację i grupę.');
}

async function createInvitation(parentId) {
  try {
    const result = await api('parents/invite',{parent_id:parentId});
    $('#invitation-title').textContent='Aktywacja konta rodzica';
    $('#invitation-link').value = window.location.origin + '/#activate/' + result.token;
    openDialog('invitation-dialog');
  } catch(error) { notice(error.message,true); }
}

for (const prefix of ['athlete','billing']) {
  const render = prefix === 'athlete' ? renderAthletes : renderAdmin;
  const search = $(`#${prefix}-search`);
  search.oninput = () => { directoryPages[prefix] = 1; if (prefix === 'billing') directoryPages.history = 1; render(); };
  $(`#${prefix}-filters`).onchange = event => {
    if ([`${prefix}-filter-location`,`${prefix}-filter-season`].includes(event.target.id)) $(`#${prefix}-filter-group`).value = '';
    if (prefix === 'athlete' && event.target.value === 'none') {
      $('#athlete-filter-location').value = ''; $('#athlete-filter-group').value = ''; $('#athlete-filter-season').value='';
    } else if (prefix === 'athlete' && ['athlete-filter-location','athlete-filter-group','athlete-filter-season'].includes(event.target.id) && $('#athlete-filter-status').value === 'none') $('#athlete-filter-status').value = '';
    directoryPages[prefix] = 1; if (prefix === 'billing') directoryPages.history = 1; render();
  };
  $(`#${prefix}-filter-reset`).onclick = () => {
    search.value = '';
    $(`#${prefix}-filters`).querySelectorAll('input,select').forEach(input=>input.value='');
    directoryPages[prefix] = 1; if (prefix === 'billing') directoryPages.history = 1; render();
  };
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-directory-page]');
  if (!button || button.disabled) return;
  const prefix = button.dataset.directoryPage;
  directoryPages[prefix] = Number(button.dataset.page);
  (prefix === 'athlete' ? renderAthletes : renderAdmin)();
  $(`#${prefix === 'athlete' ? 'athlete-list' : prefix === 'history' ? 'history' : 'enrollments'}`).scrollIntoView({block:'start'});
});
$('#save-athlete').onsubmit = async event => {
  event.preventDefault();
  const form=event.target,button=form.querySelector('[type="submit"]'),body=Object.fromEntries(new FormData(form));
  button.disabled=true;
  try {
    const result=await api(body.id?'athletes/update':'athletes',{...body,id:body.id?Number(body.id):undefined,parent_id:Number(body.parent_id)});
    $('#athlete-dialog').close();
    if($('#athlete-detail-dialog').open) $('#athlete-detail-dialog').close();
    await refresh();
    $('#enrollment-athlete').value=result.id;
    notice('Kartoteka zawodnika została zapisana.');
  } catch(error) {notice(error.message,true);} finally {button.disabled=false;}
};
$('#create-parent').onsubmit = async event => {
  event.preventDefault();
  const form=event.target,button=form.querySelector('[type="submit"]');button.disabled=true;
  try {
    const result=await api('parents',Object.fromEntries(new FormData(form)));
    $('#parent-dialog').close();form.reset();await refresh();
    $('#athlete-parent').value=result.id;
    notice('Rodzic dodany. Dodaj dziecko i przypisz je do tego rodzica.');
  } catch(error) {notice(error.message,true);} finally {button.disabled=false;}
};

function showAuth(mode='login') {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  authMode = authInfo.needs_setup ? 'setup' : window.location.hash.startsWith('#activate/') ? 'activate' : window.location.hash.startsWith('#reset/')?'reset':mode;
  if(authMode==='reset')authInfo.mfa_required=false;
  const details={login:['Zaloguj się.','Wejdź do panelu rodzica, trenera lub administratora.','Zaloguj się'],register:['Konto rodzica.','Po rejestracji dodasz dziecko i wybierzesz grupę.','Utwórz konto rodzica'],setup:['Pierwsze uruchomienie.','Utwórz konto administratora tej lokalnej instalacji. Rodzice będą rejestrować osobne konta.','Utwórz konto administratora'],activate:['Aktywuj konto.','Ustaw własne hasło do konta przygotowanego przez administratora.','Aktywuj konto'],forgot:['Odzyskaj dostęp','Podaj email swojego konta.','Przygotuj link'],reset:['Nowe hasło','Link działa jednorazowo przez 30 minut.','Zapisz nowe hasło']};
  const [title,description,submit]=details[authMode];
  $('#auth-title').textContent=title;
  $('#auth-description').textContent=description;
  $('#auth-submit').textContent=submit;
  for(const id of ['auth-name-label','auth-phone-label']) document.getElementById(id).hidden=!['register','setup'].includes(authMode);
  $('#auth-form [name=name]').required=['register','setup'].includes(authMode);
  const email=$('#auth-form [name=email]');email.closest('label').hidden=['activate','reset'].includes(authMode);email.required=!['activate','reset'].includes(authMode);
  const password=$('#auth-form [name=password]');password.autocomplete=authMode==='login'?'current-password':'new-password';password.closest('label').hidden=authMode==='forgot';password.required=authMode!=='forgot';password.disabled=authMode==='forgot';$('#password-help').hidden=authMode==='forgot';
  $('#auth-toggle').hidden=['setup','activate','reset'].includes(authMode);
  $('#auth-toggle').textContent=authMode==='login'?'Nie masz konta? Zarejestruj się jako rodzic':'Masz konto? Zaloguj się';
  $('#auth-error').hidden=true;
  $('#auth-message').hidden=true;
  $('#auth-forgot').hidden=authMode!=='login';
  $('#auth-form').hidden=Boolean(authInfo.mfa_required);
  $('#mfa-panel').hidden=!authInfo.mfa_required;
  if(window.location.hash.startsWith('#guardian/'))$('#auth-description').textContent='Zaloguj się lub utwórz konto na adres, na który otrzymano zaproszenie opiekuna.';
  switchView('auth');
  if(authInfo.mfa_required)showMfa().catch(error=>{$('#mfa-error').textContent=error.message;$('#mfa-error').hidden=false;});
}

async function initialize() {
  authInfo=await api('auth/status');
  if(window.location.hash.startsWith('#reset/')){authInfo.user=null;showAuth();return;}
  if(!authInfo.user){showAuth();return;}
  await refresh();
  if(window.location.hash.startsWith('#guardian/'))await showGuardianAcceptance();
  else switchView(window.location.hash.slice(1));
}
$('#auth-toggle').onclick=()=>showAuth(authMode==='login'?'register':'login');
$('#auth-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=$('#auth-submit');button.disabled=true;
  try {
    const body=Object.fromEntries(new FormData(form));
    if(['activate','reset'].includes(authMode)) body.token=window.location.hash.slice(('#'+authMode+'/').length);
    const result=await api('auth/'+authMode,body);
    if(authMode==='forgot'){$('#auth-message').textContent=result.message;$('#auth-message').hidden=false;return;}
    if(authMode==='reset'){await api('auth/logout',{});history.replaceState(null,'','/');authInfo=await api('auth/status');showAuth('login');$('#auth-message').textContent='Hasło zmienione. Zaloguj się ponownie.';$('#auth-message').hidden=false;return;}
    form.reset();authInfo=await api('auth/status');
    if(authInfo.mfa_required){showAuth();return;}
    await enterPanel();
  }catch(error){$('#auth-error').textContent=error.message;$('#auth-error').hidden=false;}finally{button.disabled=false;}
};
$('#auth-forgot').onclick=()=>showAuth('forgot');
async function enterPanel() {
  authInfo=await api('auth/status');
  if(!authInfo.user){showAuth();return;}
  await refresh();
  if(window.location.hash.startsWith('#guardian/'))return showGuardianAcceptance();
  window.location.hash=authInfo.user.role==='admin'?'dashboard':authInfo.user.role==='trainer'?'coach':'children';
  switchView(window.location.hash.slice(1));
}
async function showMfa() {
  $('#auth-title').textContent='Potwierdź logowanie';
  $('#auth-description').textContent='Zabezpieczenie konta administratora';
  $('#auth-toggle').hidden=true;$('#auth-forgot').hidden=true;
  $('#mfa-error').hidden=true;$('#mfa-recovery').hidden=true;$('#mfa-form').hidden=false;
  $('#mfa-form').reset();
  $('#mfa-instructions').textContent=authInfo.mfa_enrolled?'Podaj aktualny kod z aplikacji uwierzytelniającej.':'Dodaj Evolution Academy do aplikacji uwierzytelniającej na swoim telefonie.';
  $('#mfa-enrollment').hidden=authInfo.mfa_enrolled;
  $('#mfa-replace-label').hidden=!authInfo.mfa_enrolled;
  if(!authInfo.mfa_enrolled){const result=await api('auth/mfa/setup',{});$('#mfa-secret').value=result.secret;}
}
$('#mfa-form').onsubmit=async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try {
    const result=await api('auth/mfa/verify',{code:event.target.elements.code.value,replace_device:event.target.elements.replace_device.checked});
    $('#mfa-error').hidden=true;$('#mfa-secret').value='';event.target.reset();
    if(result.reenroll){authInfo=await api('auth/status');showAuth();return;}
    if(result.recovery_codes){
      $('#mfa-enrollment').hidden=true;$('#mfa-form').hidden=true;$('#mfa-recovery').hidden=false;
      $('#mfa-codes').textContent=result.recovery_codes.join('\n');
    }else await enterPanel();
  }catch(error){$('#mfa-error').textContent=error.message;$('#mfa-error').hidden=false;}
  finally{button.disabled=false;}
};
$('#mfa-continue').onclick=async()=>{$('#mfa-codes').textContent='';await enterPanel();};
$('#mfa-back').onclick=async()=>{await api('auth/logout',{});window.location.assign('/');};
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-invite-guardian],[data-revoke-guardian],[data-cancel-guardian]');
  if(!button)return;
  if(button.dataset.inviteGuardian){
    $('#guardian-form').reset();$('#guardian-form [name=athlete_id]').value=button.dataset.inviteGuardian;
    $('#guardian-error').hidden=true;openDialog('guardian-dialog');return;
  }
  if(!confirm('Cofnąć dostęp lub zaproszenie do tego dziecka?'))return;
  button.disabled=true;
  try {
    const id=Number(button.dataset.child),action=button.dataset.revokeGuardian?'revoke':'cancel';
    await api('guardians/'+action,{athlete_id:id,user_id:Number(button.dataset.revokeGuardian),id:Number(button.dataset.cancelGuardian)});
    await refresh();
    if(state.athletes.some(athlete=>athlete.id===id)){openAthleteDetail(id);selectAthleteTab('parent');}
    else $('#athlete-detail-dialog').close();
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});
$('#guardian-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
    const id=Number(form.elements.athlete_id.value),result=await api('guardians/invite',{athlete_id:id,email:form.elements.email.value});
    $('#guardian-dialog').close();await refresh();openAthleteDetail(id);selectAthleteTab('parent');notice(result.message);
  }catch(error){$('#guardian-error').textContent=error.message;$('#guardian-error').hidden=false;}finally{button.disabled=false;}
};
async function showGuardianAcceptance() {
  switchView('children');openDialog('guardian-accept-dialog');
  $('#guardian-accept').hidden=true;$('#guardian-accept-error').hidden=true;
  $('#guardian-accept-description').textContent='Sprawdzanie zaproszenia…';
  try {
    const result=await api('guardians/preview',{token:window.location.hash.slice('#guardian/'.length)});
    $('#guardian-accept-description').textContent=`Czy przyjmujesz dostęp do kartoteki dziecka: ${result.child}? Konto: ${authInfo.user.email}`;
    $('#guardian-accept').hidden=false;
  }catch(error){$('#guardian-accept-description').textContent=error.message;}
}
$('#guardian-accept').onclick=async()=>{
  const button=$('#guardian-accept');button.disabled=true;
  try{
    await api('guardians/accept',{token:window.location.hash.slice('#guardian/'.length)});
    $('#guardian-accept-dialog').close();history.replaceState(null,'','/#children');await enterPanel();
    notice('Dziecko jest już widoczne na Twoim koncie.');
  }catch(error){$('#guardian-accept-error').textContent=error.message;$('#guardian-accept-error').hidden=false;}finally{button.disabled=false;}
};
$('#guardian-switch').onclick=async()=>{await api('auth/logout',{});window.location.reload();};
$('#logout').onclick=async()=>{
  try{await api('auth/logout',{});window.location.assign('/');}catch(error){notice(error.message,true);}
};


function openTrainer(id=null) {
  const form=$('#create-trainer'),trainer=state.trainers.find(entry=>entry.id===id);
  form.reset();form.elements.id.value=id||'';
  for(const key of ['name','email','phone'])form.elements[key].value=trainer?.[key]||'';
  form.elements.status.value=trainer?.status||'active';
  $('#trainer-status-label').hidden=!trainer;
  $('#new-trainer-title').textContent=trainer?'Ustawienia trenera':'Nowy trener';
  form.querySelector('[type=submit]').textContent=trainer?'Zapisz zmiany':'Dodaj trenera';
  openDialog('trainer-dialog');
}
async function createTrainerAccount(id,button) {
  button.disabled=true;
  try {
    const result=await api('trainers/account',{trainer_id:id});
    await refresh();$('#invitation-title').textContent='Aktywacja konta trenera';
    $('#invitation-link').value=window.location.origin+'/#activate/'+result.token;openDialog('invitation-dialog');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
}
function renderCoach() {
  const selected=$('#coach-group').value;
  $('#coach-group').innerHTML='<option value="">Wszystkie moje grupy</option>'+state.groups.map(group=>`<option value="${group.id}">${escape(group.location)} · ${escape(group.name)}</option>`).join('');
  $('#coach-group').value=selected;
  if(!$('#coach-month').value)$('#coach-month').value=state.now.slice(0,7);
  const groups=state.groups.filter(group=>!$('#coach-group').value||String(group.id)===$('#coach-group').value);
  const groupIds=new Set(groups.map(group=>group.id)),month=$('#coach-month').value;
  const sessions=state.sessions.filter(session=>groupIds.has(session.group_id)&&session.starts_at.startsWith(month));
  $('#coach-sessions').innerHTML=sessions.map(session=>{
    const group=state.groups.find(group=>group.id===session.group_id);
    return `<div class="entry"><strong>${escape(termLabel(session))}</strong><small>${escape(group.location)} · ${escape(group.name)}</small>${session.excluded?'<span class="pill">Zajęcia odwołane / dzień wolny</span>':''}</div>`;
  }).join('')||'<p class="hint">Brak terminów w wybranym miesiącu.</p>';
  $('#coach-roster').innerHTML=groups.map(group=>`<details class="coach-group" ${groups.length===1?'open':''}><summary>${escape(group.location)} · ${escape(group.name)} <span class="pill">${group.member_count} / ${group.capacity}</span></summary>${state.memberships.filter(member=>member.group_id===group.id).map(member=>{
    const athlete=state.athletes.find(athlete=>athlete.id===member.athlete_id),note=state.trainer_notes.find(note=>note.athlete_id===athlete.id);
    return `<div class="entry"><strong>${escape(athlete.name)}</strong> ${member.status==='trial'?'<span class="pill">Próba</span>':''}<small>Data urodzenia: ${escape(athlete.birth_date||'Nie podano')}</small>${parentsFor(athlete.id).map(parent=>`<small>Opiekun: ${escape(parent.name)}<br>Telefon: ${escape(parent.phone||'Nie podano')}<br>Email: ${escape(parent.email)}</small>`).join('')}${note?.body?`<p class="coach-note-body">${escape(note.body)}</p>`:''}<button class="secondary" data-coach-note="${athlete.id}">${note?.body?'Edytuj notatkę':'Dodaj notatkę'}</button></div>`;
  }).join('')||'<p class="hint">Brak zawodników w grupie.</p>'}</details>`).join('')||'<p class="hint">Administrator nie przypisał Ci jeszcze grup.</p>';
}
function openCoachNote(id) {
  const athlete=state.athletes.find(athlete=>athlete.id===id);
  if(!athlete)return;
  const form=$('#coach-note-form');form.elements.athlete_id.value=id;
  form.elements.body.value=state.trainer_notes.find(note=>note.athlete_id===id)?.body||'';
  $('#coach-note-title').textContent='Notatka · '+athlete.name;openDialog('coach-note-dialog');
}
$('#coach-group').onchange=renderCoach;
$('#coach-month').onchange=renderCoach;
$('#coach-refresh').onclick=()=>refresh().catch(error=>notice(error.message,true));
$('#coach-note-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    await api('trainer-notes',{athlete_id:Number(form.elements.athlete_id.value),body:form.elements.body.value});
    $('#coach-note-dialog').close();await refresh();notice('Notatka zapisana.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
};

let userRows=[],userPage=1,userRequest=0;
const userRoles={admin:'Administrator',trainer:'Trener',parent:'Rodzic'};
async function loadUsers(page=1) {
  const version=++userRequest;
  try {
    const params=new URLSearchParams(new FormData($('#user-filters')));params.set('page',page);
    const data=await api('users?'+params);
    if(version!==userRequest||authInfo.user?.role!=='admin')return;
    userRows=data.items;userPage=data.page;
    $('#user-list').innerHTML=`<p class="hint">Liczba użytkowników: ${data.total}</p>`+data.items.map(user=>`<div class="entry exclusion-entry"><div><strong>${escape(user.name)}</strong> <span class="pill">${userRoles[user.role]}</span><small>${escape(user.email)}${user.phone?' · '+escape(user.phone):''}<br>${user.access_status==='blocked'?'Dostęp zablokowany':'Dostęp aktywny'} · ${user.activated?'Hasło ustawione':'Oczekuje na aktywację'}${user.role==='admin'?' · MFA: '+(user.mfa_enrolled?'włączone':'do skonfigurowania'):''}${user.id===authInfo.user.id?' · Twoje konto':''}</small></div><div class="heading-actions"><button class="secondary" data-edit-user="${user.id}">Edytuj</button>${!user.activated&&user.access_status==='active'?`<button class="secondary" data-invite-user="${user.id}">Link aktywacyjny</button>`:''}${user.id!==authInfo.user.id?`<button class="secondary" data-access-user="${user.id}" data-next-access="${user.access_status==='active'?'blocked':'active'}">${user.access_status==='active'?'Zablokuj dostęp':'Odblokuj dostęp'}</button>`:''}</div></div>`).join('');
    if(!data.items.length)$('#user-list').innerHTML+='<p>Brak użytkowników spełniających wybrane filtry.</p>';
    $('#user-pagination').innerHTML=`<button class="secondary" data-user-page="${page-1}" ${page<=1?'disabled':''}>Poprzednia</button><span>Strona ${page} z ${data.pages}</span><button class="secondary" data-user-page="${page+1}" ${page>=data.pages?'disabled':''}>Następna</button>`;
  }catch(error){if(version===userRequest)notice(error.message,true);}
}
function userRoleHelp() {
  const form=$('#user-form');
  $('#user-role-help').textContent=form.elements.id.value?'Edytujesz dane kontaktowe. Rola i adres logowania pozostają bez zmian.':form.elements.role.value==='admin'?'Administrator ma dostęp do wszystkich danych i ustawień. Ustawi własne hasło i skonfiguruje MFA.':'Użytkownik ustawi własne hasło przez link aktywacyjny. Link przekaż mu samodzielnie; system nie wysyła emaila.';
}
function openUser(user=null) {
  const form=$('#user-form');form.reset();
  for(const key of ['id','name','email','phone','role'])form.elements[key].value=user?.[key]??(key==='role'?'parent':'');
  form.elements.email.readOnly=Boolean(user);form.elements.role.disabled=Boolean(user);
  $('#user-title').textContent=user?'Edytuj użytkownika':'Dodaj użytkownika';userRoleHelp();openDialog('user-dialog');
}
$('#user-form [name=role]').onchange=userRoleHelp;
$('#user-filters').onsubmit=event=>{event.preventDefault();loadUsers();};
$('#user-filters').onchange=()=>loadUsers();
$('#user-filters').onreset=()=>setTimeout(()=>loadUsers(),0);
$('#user-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    const body=Object.fromEntries(new FormData(form));if(body.id)body.id=Number(body.id);else delete body.id;
    const result=await api(body.id?'users/update':'users',body);
    $('#user-dialog').close();await refresh();await loadUsers(body.id?userPage:1);
    $('#account-name').textContent=authInfo.user.name;
    if(result.token){$('#invitation-link').value=location.origin+'/#activate/'+result.token;openDialog('invitation-dialog');}
    else notice('Dane użytkownika zapisane.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
};
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-new-user'))return openUser();
  if(button.dataset.editUser)return openUser(userRows.find(user=>user.id===Number(button.dataset.editUser)));
  if(button.dataset.userPage)return loadUsers(Number(button.dataset.userPage));
  if(!button.dataset.inviteUser&&!button.dataset.accessUser)return;
  if(button.dataset.accessUser&&!confirm(button.dataset.nextAccess==='blocked'?'Zablokować dostęp i zakończyć sesje tego użytkownika? Dane i historia pozostaną zachowane.':'Odblokować dostęp tego użytkownika?'))return;
  button.disabled=true;
  try {
    if(button.dataset.inviteUser){const result=await api('users/invite',{id:Number(button.dataset.inviteUser)});$('#invitation-link').value=location.origin+'/#activate/'+result.token;openDialog('invitation-dialog');}
    else {await api('users/access',{id:Number(button.dataset.accessUser),access_status:button.dataset.nextAccess});await refresh();await loadUsers(userPage);notice('Dostęp użytkownika został zmieniony.');}
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});

function queueSelected() {
 const group=state?.groups.find(g=>g.id===Number($('#group').value));
 return Boolean(group&&group.capacity-group.member_count-(group.reserved_count||0)<=0&&!state.memberships.some(m=>m.group_id===group.id&&m.athlete_id===Number($('#enrollment-athlete').value)&&m.status!=='ended'));
}
$('#enrollment-athlete').onchange=updateTrials;
function deadlineLabel(value){return new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'short'}).format(new Date(value));}
function waitingMarkup(athleteId=null,groupId=null,history=false) {
 const labels={waiting:'Oczekuje',offered:'Oferta miejsca',accepted:'Zapis potwierdzony',cancelled:'Anulowane',expired:'Oferta wygasła'};
 return (state.waiting_list||[]).filter(entry=>(athleteId===null||entry.athlete_id===athleteId)&&(groupId===null||entry.group_id===groupId)&&(history||['waiting','offered'].includes(entry.status))).map(entry=>{
  const child=state.athletes.find(a=>a.id===entry.athlete_id),group=state.groups.find(g=>g.id===entry.group_id);
  return `<div class="entry"><strong>${escape(child?.name||'')} · ${escape(group?.location||'')} / ${escape(group?.name||'')}</strong><small>${labels[entry.status]}${entry.position?' · pozycja '+entry.position:''}${entry.status==='offered'?' · potwierdź do '+escape(deadlineLabel(entry.expires_at)):''}</small><div class="trainer-actions">${entry.status==='offered'?`<button class="primary" data-accept-offer="${entry.id}" data-child="${entry.athlete_id}" data-group="${entry.group_id}">Przyjmij miejsce</button>`:''}${['waiting','offered'].includes(entry.status)?`<button class="secondary" data-cancel-waiting="${entry.id}" data-child="${entry.athlete_id}">Zrezygnuj z kolejki</button>`:''}</div></div>`;
 }).join('')||(groupId!==null?'<p class="hint">Brak zgłoszeń na liście rezerwowej.</p>':'');
}
function renderWaiting(){
 if(state.user.role==='admin'){
  $('#waiting-list').innerHTML=waitingMarkup(null,null,$('#waiting-filter').value==='all')||'<p class="hint">Brak zgłoszeń.</p>';
  for(const field of ['trial_hours','offer_hours'])$('#admission-settings').elements[field].value=state.admission_settings[field];
 }
}
$('#waiting-filter').onchange=renderWaiting;
$('#admission-settings').onsubmit=async event=>{
 event.preventDefault();try{const form=event.target;await api('admissions/settings',{trial_hours:Number(form.elements.trial_hours.value),offer_hours:Number(form.elements.offer_hours.value)});await refresh();notice('Terminy dla nowych prób i ofert zapisane.');}catch(error){notice(error.message,true);}
};
let admissionConfirmation;
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-trial-convert],[data-accept-offer],[data-cancel-waiting]');if(!button)return;
 button.disabled=true;
 try {
  const athleteId=Number(button.dataset.child);
  if(button.dataset.cancelWaiting){if(!confirm('Zrezygnować z miejsca na liście rezerwowej?'))return;await api('waiting/cancel',{id:Number(button.dataset.cancelWaiting),athlete_id:athleteId});await refresh();if($('#athlete-detail-dialog').open){openAthleteDetail(athleteId);selectAthleteTab('groups');}return;}
  const conversion=Boolean(button.dataset.trialConvert),id=Number(button.dataset.trialConvert||button.dataset.acceptOffer);
  const body={id,athlete_id:athleteId,month:state.now.slice(0,7)};
  const q=await api(conversion?'trials/quote':'quote',conversion?body:{group_id:Number(button.dataset.group),month:body.month});
  admissionConfirmation={path:conversion?'trials/convert':'waiting/accept',body:{...body,expected_amount:q.amount}};
  $('#admission-summary').textContent=`${state.athletes.find(a=>a.id===athleteId).name}: ${q.count} pozostałych zajęć w bieżącym miesiącu. Należność: ${money(q.amount)}.`;
  openDialog('admission-dialog');
 }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});
$('#admission-confirm').onsubmit=async event=>{
 event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
 try{await api(admissionConfirmation.path,admissionConfirmation.body);$('#admission-dialog').close();await refresh();if($('#athlete-detail-dialog').open){openAthleteDetail(admissionConfirmation.body.athlete_id);selectAthleteTab('groups');}notice('Zapis stały potwierdzony.');}catch(error){notice(error.message,true);}finally{button.disabled=false;}
};

let lessonDetail;
let calendarRequest=0;
async function loadCalendar() {
 if(!state)return;
 const form=$('#lesson-filters');
 const request=++calendarRequest;
 if(!form.elements.from.value){const d=new Date(state.now.slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);form.elements.from.value=d.toISOString().slice(0,10);form.elements.to.value=calendarEnd(form.elements.from.value,form.elements.view.value);}
 const selected=form.elements.group_id.value;form.elements.group_id.innerHTML='<option value="">Wszystkie grupy</option>'+state.groups.map(g=>`<option value="${g.id}">${escape(g.name)}</option>`).join('');form.elements.group_id.value=selected;
 for(const [name,items] of [['location_id',state.locations],['trainer_id',state.trainers||(state.trainer?[state.trainer]:[])]]){const select=form.elements[name],value=select.value;select.innerHTML='<option value="">Wszystkie</option>'+items.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('');select.value=value;}
 try {const result=await api('calendar?'+new URLSearchParams(new FormData(form)));if(request===calendarRequest)renderLessonCalendar(result.items,form.elements.from.value,form.elements.to.value,form.elements.view.value);}catch(error){notice(error.message,true);}
}
$('#lesson-filters').onsubmit=e=>{e.preventDefault();loadCalendar();};
function calendarEnd(from,view){const d=new Date(from+'T12:00:00Z');if(view==='month')d.setUTCMonth(d.getUTCMonth()+1,0);else d.setUTCDate(d.getUTCDate()+(view==='week'?6:0));return d.toISOString().slice(0,10);}
$('#lesson-filters [name=view]').onchange=()=>{const f=$('#lesson-filters');if(!f.elements.from.value)return;f.elements.to.value=calendarEnd(f.elements.from.value,f.elements.view.value);loadCalendar();};
$('#calendar-today').onclick=()=>{const f=$('#lesson-filters');f.elements.from.value=state.now.slice(0,10);f.elements.to.value=calendarEnd(f.elements.from.value,f.elements.view.value);loadCalendar();};
document.addEventListener('click',event=>{const button=event.target.closest('[data-calendar-move]');if(!button)return;const f=$('#lesson-filters'),d=new Date(f.elements.from.value+'T12:00:00Z'),step=Number(button.dataset.calendarMove);if(f.elements.view.value==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+step);}else d.setUTCDate(d.getUTCDate()+step*(f.elements.view.value==='week'?7:1));f.elements.from.value=d.toISOString().slice(0,10);f.elements.to.value=calendarEnd(f.elements.from.value,f.elements.view.value);loadCalendar();});
function renderLessonCalendar(items,from,to,view){
 $('#calendar-range').textContent=from.split('-').reverse().join('.')+' — '+to.split('-').reverse().join('.');
 const byDate=new Map();items.sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 for(const item of items){const date=item.starts_at.slice(0,10);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(item);}
 const compact=view==='month'||(Date.parse(to)-Date.parse(from))/86400000>31;
 const days=[];const cursor=new Date(from+'T12:00:00Z');while(!compact&&cursor.toISOString().slice(0,10)<=to){days.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1);}
 if(!compact){renderHourlyCalendar(days,byDate);return;}
 const shown=[...byDate.keys()];
 $('#lesson-list').innerHTML=shown.length?`<div class="lesson-board ${compact?'agenda-board':view==='day'?'day-board':'week-board'}">${shown.map(date=>`<section class="lesson-day"><h3>${escape(new Date(date+'T12:00:00Z').toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}))}${date===state.now.slice(0,10)?'<span class="today-marker">Dzisiaj</span>':''}</h3><div>${(byDate.get(date)||[]).map(s=>`<button class="lesson-event ${s.excluded?'cancelled':s.completed?'completed':''}" data-lesson="${s.id}"><span class="lesson-time">${escape(s.starts_at.slice(11,16))}${s.ends_at?'–'+escape(s.ends_at.slice(11,16)):''}</span><strong>${escape(s.group_name)}</strong><span>${escape(s.location)}</span><small>${escape(s.trainers.map(t=>t.name).join(', ')||'Bez trenera')}</small><span class="lesson-status">${s.excluded?'Odwołane / dzień wolny':s.completed?'Zrealizowane':`Brakujące obecności: ${s.missing}`}</span><span class="lesson-open">Otwórz dziennik →</span></button>`).join('')||'<p class="hint">Brak zajęć</p>'}</div></section>`).join('')}</div>`:'<p class="hint">Brak zajęć w wybranym zakresie.</p>';
}

async function openLesson(id){
 try{lessonDetail=await api('calendar/detail?id='+id);const {session,children,completion}=lessonDetail;const parent=authInfo.user.role==='parent';
 $('#lesson-roster').innerHTML=`<p>${escape(termLabel(session))}</p>${children.map(a=>`<div class="entry"><strong>${escape(a.name)}</strong><small>${a.reported_absent?'Rodzic zgłosił nieobecność · ':''}${{present:'Obecny',absent:'Nieobecny',unmarked:'Niezgłoszony'}[a.attendance]} · Pieczątki za obecność: ${a.stamps}</small>${parent?`<button class="secondary" data-absence="${a.id}" data-active="${!a.reported_absent}">${a.reported_absent?'Cofnij zgłoszenie':'Zgłoś nieobecność'}</button>`:`<label>Obecność<select data-attendance="${a.id}">${[['unmarked','Niezgłoszony'],['present','Obecny'],['absent','Nieobecny']].map(([v,n])=>`<option value="${v}" ${a.attendance===v?'selected':''}>${n}</option>`).join('')}</select></label>`}</div>`).join('')}${!parent?`<button class="primary" data-complete-lesson="${!completion?.completed}">${completion?.completed?'Cofnij realizację':'Potwierdź realizację zajęć'}</button>`:''}${authInfo.user.role==='admin'?`<div class="trainer-actions"><button class="secondary" data-cancel-lesson="${!session.excluded}">Odwołaj / przywróć termin</button><button class="secondary" data-move-lesson>Przesuń termin</button><button class="secondary" data-substitute-lesson>Przypisz zastępstwo</button></div>`:''}`;
 if(!$('#lesson-dialog').open)openDialog('lesson-dialog');
 }catch(error){notice(error.message,true);}
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b)return;if(b.dataset.lesson)return openLesson(Number(b.dataset.lesson));
 if(!b.hasAttribute('data-absence')&&!b.hasAttribute('data-complete-lesson')&&!b.hasAttribute('data-cancel-lesson')&&!b.hasAttribute('data-move-lesson')&&!b.hasAttribute('data-substitute-lesson'))return;
 b.disabled=true;try{
 const body={session_id:lessonDetail.session.id};let action;
 if(b.dataset.absence){action='absence';Object.assign(body,{athlete_id:Number(b.dataset.absence),active:b.dataset.active==='true'});}
 else if(b.hasAttribute('data-complete-lesson')){action='complete';body.completed=b.dataset.completeLesson==='true';if(body.completed){const session=lessonDetail.session;const minutes=session.ends_at?Math.round((new Date(session.ends_at)-new Date(session.starts_at))/60000):60;return operationDialog('Potwierdź realizację',[{name:'actual_minutes',label:'Rzeczywisty czas zajęć (min)',type:'number',min:1,max:480,value:minutes}],async values=>{await api('calendar/complete',{...body,actual_minutes:Number(values.actual_minutes)});await openLesson(body.session_id);await loadCalendar();});}if(!body.completed){body.reason=prompt('Powód cofnięcia realizacji:');if(!body.reason)return;}}
 else {action='edit';body.reason=prompt('Powód zmiany:');if(!body.reason)return;
  if(b.hasAttribute('data-cancel-lesson'))body.cancelled=b.dataset.cancelLesson==='true';
  if(b.hasAttribute('data-move-lesson')){body.starts_at=prompt('Nowy początek (RRRR-MM-DDTGG:MM:SS)',lessonDetail.session.starts_at);if(!body.starts_at)return;body.ends_at=prompt('Nowy koniec (RRRR-MM-DDTGG:MM:SS)',lessonDetail.session.ends_at||'');if(!body.ends_at)return;}
  if(b.hasAttribute('data-substitute-lesson')){const value=prompt('Podaj ID trenera: '+state.trainers.map(t=>t.id+' — '+t.name).join(', '));if(!value)return;body.trainer_ids=[Number(value)];}
 }
 await api('calendar/'+action,body);await openLesson(body.session_id);await loadCalendar();notice('Zapisano.');
 }catch(error){notice(error.message,true);}finally{b.disabled=false;}
});
document.addEventListener('change',async event=>{const field=event.target;if(!field.dataset.attendance)return;try{const athlete=lessonDetail.children.find(a=>a.id===Number(field.dataset.attendance));const reason=athlete.attendance!=='unmarked'?prompt('Powód korekty obecności:'):'';if(reason===null)return openLesson(lessonDetail.session.id);await api('calendar/mark',{session_id:lessonDetail.session.id,athlete_id:athlete.id,status:field.value,reason});await openLesson(lessonDetail.session.id);}catch(error){notice(error.message,true);}});

let operationCallback;
function operationDialog(title,fields,callback,help='') {
 $('#operation-title').textContent=title;$('#operation-help').textContent=help;operationCallback=callback;
 $('#operation-form').innerHTML=fields.map(f=>`<label>${escape(f.label)}${f.options?`<select name="${f.name}" ${f.optional?'':'required'}>${f.options.map(([value,label])=>`<option value="${escape(value)}" ${String(f.value)===String(value)?'selected':''}>${escape(label)}</option>`).join('')}</select>`:f.type==='textarea'?`<textarea name="${f.name}" ${f.optional?'':'required'} maxlength="${f.maxlength||4000}">${escape(f.value||'')}</textarea>`:`<input name="${f.name}" type="${f.type||'text'}" value="${escape(f.value??'')}" ${f.optional?'':'required'} ${f.min!==undefined?'min="'+f.min+'"':''} ${f.max!==undefined?'max="'+f.max+'"':''} ${f.step?'step="'+f.step+'"':''}>`}</label>`).join('')+'<button class="primary" type="submit">Zapisz</button>';openDialog('operation-dialog');
}
$('#operation-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type=submit]');button.disabled=true;try{await operationCallback(Object.fromEntries(new FormData(event.target)));$('#operation-dialog').close();await refresh();notice('Zapisano.');}catch(error){notice(error.message,true);}finally{button.disabled=false;}};
function cents(value){const normalized=String(value).replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(normalized))throw Error('Podaj kwotę w złotych, maksymalnie dwa miejsca po przecinku.');const [whole,fraction='']=normalized.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
const athleteOptions=()=>state.athletes.map(a=>[a.id,a.name]);
const groupOptions=()=>state.groups.map(g=>[g.id,g.location+' / '+g.name]);
function renderFinance(){if(state.user.role!=='admin')return;const data=state.finance;
 $('#finance-ledger').innerHTML='<h2>Wpłaty</h2>'+data.payments.map(p=>`<div class="entry"><strong>${escape(state.athletes.find(a=>a.id===p.athlete_id)?.name||'')} · ${money(p.amount)}</strong><small>${escape(p.paid_on)} · ${escape(p.reference)} · wolne środki ${money(p.credit)}</small>${p.credit>0?`<button class="secondary" data-allocate-payment="${p.id}">Rozlicz z należnościami</button><button class="secondary" data-refund-payment="${p.id}">Zatwierdź zwrot</button>`:''}</div>`).join('')+'<h2>Zwroty</h2>'+data.refunds.map(r=>`<div class="entry"><strong>${money(r.amount)} · ${r.status==='paid'?'Wykonany':'Do wykonania'}</strong><small>${escape(r.reason)}</small>${r.status==='approved'?`<button class="secondary" data-refund-paid="${r.id}">Oznacz wykonanie</button>`:''}</div>`).join('')+'<h2>Datowane stawki</h2>'+data.prices.map(p=>`<div class="entry">${escape(state.groups.find(g=>g.id===p.group_id)?.name||'')} · od ${escape(p.starts_on)} · ${money(p.amount)} / zajęcia</div>`).join('');
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 const action=button.dataset.financeAction;
 if(action){let fields=[];const today=state.now.slice(0,10);
 if(action==='configure')fields=[{name:'auto_monthly',label:'Automatyczne naliczanie miesięczne',value:String(Boolean(state.finance.settings.auto_monthly)),options:[['false','Wyłączone'],['true','Włączone']]},{name:'due_day',label:'Dzień płatności w miesiącu',type:'number',min:1,max:28,value:state.finance.settings.due_day},{name:'bank_account',label:'Numer rachunku do przelewów',optional:true,value:state.finance.settings.bank_account}];
 if(action==='feeRule')fields=[{name:'season_id',label:'Sezon',options:state.seasons.map(s=>[s.id,s.name])},{name:'amount',label:'Wpisowe (zł)'}];
 if(action==='fee')fields=[{name:'athlete_id',label:'Zawodnik',options:athleteOptions()},{name:'season_id',label:'Sezon',options:state.seasons.map(s=>[s.id,s.name])},{name:'exempt',label:'Sposób rozliczenia',options:[['false','Nalicz wpisowe'],['true','Zwolnienie z wpisowego']]},{name:'reason',label:'Powód / opis'}];
 if(action==='payment')fields=[{name:'athlete_id',label:'Zawodnik',options:athleteOptions()},{name:'amount',label:'Otrzymana kwota (zł)'},{name:'date',label:'Data wpływu',type:'date',value:today},{name:'reference',label:'Unikalny identyfikator przelewu / wpłaty'}];
 if(action==='generate')fields=[{name:'month',label:'Miesiąc',type:'month',value:today.slice(0,7)},{name:'group_id',label:'Grupa',options:[['','Wszystkie grupy'],...groupOptions()],optional:true}];
 if(action==='price')fields=[{name:'group_id',label:'Grupa',options:groupOptions()},{name:'starts_on',label:'Obowiązuje od',type:'date',value:today},{name:'amount',label:'Stawka za zajęcia (zł)'},{name:'vat_bps',label:'VAT (%) — puste oznacza brak ustalonej stawki',optional:true}];
 if(action==='discount')fields=[{name:'athlete_id',label:'Zawodnik',options:athleteOptions()},{name:'starts_on',label:'Od',type:'date',value:today},{name:'ends_on',label:'Do',type:'date'},{name:'kind',label:'Rodzaj',options:[['percent','Procent od każdej jednostki'],['fixed','Kwota od każdej jednostki']]},{name:'value',label:'Rabat (% lub zł)'},{name:'reason',label:'Powód',type:'textarea'}];
 operationDialog(button.textContent,fields,async body=>{for(const field of ['athlete_id','group_id','season_id','due_day'])if(body[field])body[field]=Number(body[field]);for(const key of ['auto_monthly','exempt'])if(key in body)body[key]=body[key]==='true';if(body.amount)body.amount=cents(body.amount);if(body.value)body.value=cents(body.value);if('vat_bps' in body)body.vat_bps=body.vat_bps?cents(body.vat_bps):null;const result=await api('finance/'+action,body);if(action==='generate')notice('Utworzono naliczeń: '+result.created);});return;
 }
 if(button.dataset.allocatePayment){try{await api('finance/allocate',{payment_id:Number(button.dataset.allocatePayment)});await refresh();}catch(e){notice(e.message,true);}}
 if(button.dataset.refundPayment)operationDialog('Zatwierdź zwrot',[{name:'amount',label:'Kwota (zł)'},{name:'reason',label:'Powód'},{name:'reference',label:'Unikalny identyfikator zwrotu'}],b=>api('finance/refund',{...b,amount:cents(b.amount),payment_id:Number(button.dataset.refundPayment)}),'To rezerwuje środki do zwrotu. Przelew wykonujesz osobno.');
 if(button.dataset.refundPaid)operationDialog('Oznacz wykonany zwrot',[{name:'date',label:'Data wykonania',type:'date',value:state.now.slice(0,10)}],b=>api('finance/refundPaid',{...b,id:Number(button.dataset.refundPaid)}));
});

let workspaceData,conversationId;
async function loadWorkspace(){try{workspaceData=await api('workspace');const data=workspaceData,admin=authInfo.user.role==='admin';
 $('#new-policy').hidden=!admin;$('#new-equipment').hidden=!admin;$('#equipment-move').hidden=!admin;
 $('#notification-list').innerHTML=data.notifications.map(n=>`<div class="entry"><strong>${escape(n.title)}</strong><small>${escape(n.created_at)}</small>${!n.read_at?`<button class="tertiary" data-read-notification="${n.id}">Przeczytane</button>`:''}</div>`).join('')||'<p>Brak powiadomień.</p>';
 $('#conversation-list').innerHTML=data.conversations.map(c=>`<button class="admin-list-row" data-conversation="${c.id}"><span>${escape(c.subject)}<small>${escape(c.owner_name)} · ${escape(c.category)} · ${{new:'Nowa',progress:'W toku',waiting:'Oczekuje',closed:'Zamknięta'}[c.status]}</small></span><span>Otwórz →</span></button>`).join('')||'<p>Brak rozmów.</p>';
 $('#policy-list').innerHTML=data.documents.map(d=>`<div class="entry"><h2>${escape(d.title)}</h2><p>Wersja ${escape(d.version)}</p><details><summary>Przeczytaj treść</summary><p style="white-space:pre-wrap">${escape(d.body)}</p></details>${authInfo.user.role==='parent'?state.athletes.map(a=>{const records=data.acceptances.filter(r=>r.athlete_id===a.id&&r.document_id===d.id&&r.user_id===authInfo.user.id);const accepted=records.at(-1)?.accepted;return `<p>${escape(a.name)} · ${accepted?'Potwierdzono':'Nie potwierdzono'} ${!accepted?`<button class="secondary" data-consent="${d.id}" data-child="${a.id}" data-accepted="true">${['photos','marketing'].includes(d.kind)?'Wyrażam dobrowolną zgodę':'Potwierdzam zapoznanie się'}</button>`:['photos','marketing'].includes(d.kind)?`<button class="secondary" data-consent="${d.id}" data-child="${a.id}" data-accepted="false">Wycofaj zgodę</button>`:''}</p>`;}).join(''):''}</div>`).join('')||'<p>Organizator nie opublikował jeszcze dokumentów.</p>';
 if(data.equipment)$('#equipment-list').innerHTML='<h2>Stan sprzętu</h2>'+data.equipment.stock.map(s=>`<div class="entry"><strong>${escape(s.name)} · ${s.quantity} szt.</strong><small>${escape(s.location_name)} · ${{good:'Sprawny',damaged:'Uszkodzony',replace:'Do wymiany',retired:'Wycofany'}[s.status]}</small></div>`).join('')+'<h2>Zgłoszenia</h2>'+data.equipment.issues.map(i=>`<div class="entry"><p>${escape(i.body)}</p><small>${i.status==='open'?'Otwarte':'Rozwiązane'}</small>${admin&&i.status==='open'?`<button class="secondary" data-resolve-equipment="${i.id}" data-location="${i.location_id}">Zamknij zgłoszenie</button>`:''}</div>`).join('');
 }catch(e){notice(e.message,true);}}
async function openConversation(id){try{const data=await api('workspace/thread?id='+id);conversationId=id;$('#conversation-title').textContent=data.conversation.subject;$('#conversation-messages').innerHTML=data.messages.map(m=>`<div class="entry"><strong>${escape(m.sender_name)}</strong><p style="white-space:pre-wrap">${escape(m.body)}</p><small>${escape(m.created_at)}</small></div>`).join('')+(authInfo.user.role==='admin'?`<label>Status<select id="conversation-status">${[['new','Nowa'],['progress','W toku'],['waiting','Oczekuje'],['closed','Zamknięta']].map(([v,n])=>`<option value="${v}" ${v===data.conversation.status?'selected':''}>${n}</option>`).join('')}</select></label>`:'');if(!$('#conversation-dialog').open)openDialog('conversation-dialog');}catch(e){notice(e.message,true);}}
$('#new-conversation').onclick=()=>operationDialog('Nowa wiadomość',[...(authInfo.user.role==='admin'?[{name:'owner_id',label:'Odbiorca',options:[...state.parents.map(u=>[u.id,u.name+' (rodzic)']),...state.trainers.filter(t=>t.user_id).map(t=>[t.user_id,t.name+' (trener)'])]}]:[]),{name:'subject',label:'Temat'},{name:'category',label:'Kategoria',value:'Organizacja'},{name:'body',label:'Treść',type:'textarea',maxlength:10000}],async b=>{if(b.owner_id)b.owner_id=Number(b.owner_id);await api('workspace/message',b);await loadWorkspace();},authInfo.user.role==='admin'?'Wiadomość będzie widoczna w panelu odbiorcy.':'Wiadomość otrzyma administrator akademii.');
$('#conversation-reply').onsubmit=async e=>{e.preventDefault();try{await api('workspace/message',{id:conversationId,body:e.target.elements.body.value});e.target.reset();await openConversation(conversationId);}catch(error){notice(error.message,true);}};
$('#new-policy').onclick=()=>operationDialog('Opublikuj dokument organizatora',[{name:'kind',label:'Rodzaj',options:[['terms','Regulamin'],['privacy','Informacja RODO'],['som','Standardy Ochrony Małoletnich'],['photos','Dobrowolna zgoda na zdjęcia'],['marketing','Dobrowolna zgoda marketingowa']]},{name:'version',label:'Wersja'},{name:'title',label:'Tytuł'},{name:'body',label:'Treść organizatora',type:'textarea',maxlength:30000}],async b=>{await api('workspace/savePolicy',{...b,published:true});await loadWorkspace();},'Wklej zatwierdzoną treść organizatora. Opublikowany regulamin, RODO i SOM będą wymagały potwierdzenia przy zapisie.');
$('#new-equipment').onclick=()=>operationDialog('Dodaj sprzęt',[{name:'name',label:'Nazwa'},{name:'category',label:'Kategoria'},{name:'description',label:'Opis',type:'textarea',optional:true}],async b=>{await api('workspace/equipmentSave',b);await loadWorkspace();});
$('#equipment-move').onclick=()=>operationDialog('Stan sprzętu',[{name:'equipment_id',label:'Sprzęt',options:workspaceData.equipment.catalog.map(e=>[e.id,e.name])},{name:'from_location',label:'Z placówki (puste: wprowadzenie stanu)',options:[['','Wprowadzenie stanu'],...workspaceData.equipment.locations.map(l=>[l.id,l.name])],optional:true},{name:'to_location',label:'Do placówki / inwentaryzowana placówka',options:workspaceData.equipment.locations.map(l=>[l.id,l.name])},{name:'status',label:'Stan',options:[['good','Sprawny'],['damaged','Uszkodzony'],['replace','Do wymiany'],['retired','Wycofany']]},{name:'quantity',label:'Ilość',type:'number',min:0},{name:'inventory',label:'Tryb',options:[['false','Dodanie / przeniesienie ilości'],['true','Inwentaryzacja: faktyczna ilość']]},{name:'reason',label:'Powód / wynik inwentaryzacji'}],async b=>{for(const key of ['equipment_id','from_location','to_location','quantity'])b[key]=Number(b[key]);b.inventory=b.inventory==='true';await api('workspace/move',b);await loadWorkspace();});
$('#equipment-issue').onclick=()=>operationDialog('Zgłoszenie sprzętu',[{name:'location_id',label:'Placówka',options:workspaceData.equipment.locations.map(l=>[l.id,l.name])},{name:'body',label:'Opis braku, uszkodzenia lub naprawy',type:'textarea'}],async b=>{await api('workspace/issue',{...b,location_id:Number(b.location_id)});await loadWorkspace();});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.conversation)return openConversation(Number(b.dataset.conversation));if(b.dataset.readNotification)await api('workspace/read',{id:Number(b.dataset.readNotification)});else if(b.dataset.consent)await api('workspace/consent',{document_id:Number(b.dataset.consent),athlete_id:Number(b.dataset.child),accepted:b.dataset.accepted==='true'});else if(b.dataset.resolveEquipment)await api('workspace/issue',{id:Number(b.dataset.resolveEquipment),location_id:Number(b.dataset.location),status:'resolved'});else return;await loadWorkspace();}catch(error){notice(error.message,true);}});
document.addEventListener('change',async e=>{if(e.target.id==='conversation-status')try{await api('workspace/status',{id:conversationId,status:e.target.value});await loadWorkspace();}catch(error){notice(error.message,true);}});

let libraryData;
async function loadLibrary(){try{libraryData=await api('library');const parent=authInfo.user.role==='parent';$('#library-actions').hidden=parent;$('#asset-upload').hidden=parent;for(const button of document.querySelectorAll('[data-library-action]'))button.hidden=authInfo.user.role!=='admin'&&['program','skill','assign'].includes(button.dataset.libraryAction);$('#asset-upload [name=audience]').disabled=authInfo.user.role==='trainer';$('#asset-upload [name=group_id]').innerHTML='<option value="">Wszystkie grupy</option>'+state.groups.map(g=>`<option value="${g.id}">${escape(g.name)}</option>`).join('');renderLibrary();}catch(e){notice(e.message,true);}}
function renderLibrary(){const data=libraryData,query=$('#library-search').value.toLocaleLowerCase('pl');$('#library-content').innerHTML='<h2>Materiały</h2>'+data.assets.filter(a=>(a.title+' '+a.tags).toLocaleLowerCase('pl').includes(query)).map(a=>`<div class="entry"><strong>${escape(a.title)}</strong><small>${escape(a.tags)} · ${Math.ceil(a.bytes/1024)} KB</small><a href="/api/library/file?id=${a.id}" target="_blank" rel="noopener">Otwórz materiał</a></div>`).join('')+(!data.assets.length?'<p>Brak materiałów.</p>':'')+(data.plans.length?'<h2>Konspekty</h2>':'')+data.plans.map(p=>`<details class="entry"><summary>${escape(p.title)} · ${p.minutes} min</summary><p>Rozgrzewka: ${escape(p.warmup)}</p><p>Część główna: ${escape(p.main_part)}</p><p>Zabawy: ${escape(p.games)}</p><p>Zakończenie: ${escape(p.ending)}</p><p>Sprzęt: ${escape(p.equipment)}</p><a target="_blank" rel="noopener" href="/api/library/pdf?type=plan&id=${p.id}">Pobierz PDF</a></details>`).join('')+'<h2>Postępy dzieci</h2>'+data.children.map(a=>`<div class="entry"><h3>${escape(a.name)}</h3>${data.assessments.filter(r=>r.athlete_id===a.id).map(r=>`<p>${escape(data.skills.find(s=>s.id===r.skill_id)?.name||'')} · ${{new:'Nie rozpoczęto',learning:'W trakcie',mastered:'Opanowano'}[r.status]}${authInfo.user.role!=='parent'?(r.published?' · Udostępnione':' · Wewnętrzne'):''}<br>${escape(r.comment)}<small>${escape(r.created_at)}</small></p>`).join('')||'<p>Brak udostępnionych ocen.</p>'}<button class="secondary" data-adventure="${a.id}">Karta Przygody</button><a target="_blank" rel="noopener" href="/api/library/pdf?type=certificate&id=${a.id}">Dyplom PDF</a></div>`).join('');}
$('#library-search').oninput=()=>{if(libraryData)renderLibrary();};
$('#asset-upload').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;const messages=[];try{for(const file of form.elements.files.files){const params=new URLSearchParams({title:file.name,audience:form.elements.audience.value,group_id:form.elements.group_id.value,tags:form.elements.tags.value});const response=await fetch('/api/library/upload?'+params,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const result=await response.json();messages.push(file.name+': '+(response.ok?'dodano':result.error));}await loadLibrary();}catch(error){messages.push(error.message);}finally{$('#asset-upload-result').textContent=messages.join(' · ');button.disabled=false;}};
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;const action=button.dataset.libraryAction;if(action){let fields=[];const programs=libraryData.programs.map(p=>[p.id,p.name]);
 if(action==='program')fields=[{name:'name',label:'Program'},{name:'min_age',label:'Wiek od',type:'number',min:0,max:18},{name:'max_age',label:'Wiek do',type:'number',min:0,max:18},{name:'description',label:'Opis i etapy',type:'textarea'}];
 if(action==='skill')fields=[{name:'program_id',label:'Program',options:programs},{name:'name',label:'Umiejętność'},{name:'criteria',label:'Kryteria oceny',type:'textarea'},{name:'stage',label:'Etap'}];
 if(action==='assign')fields=[{name:'group_id',label:'Grupa',options:groupOptions()},{name:'program_id',label:'Program',options:programs}];
 if(action==='plan')fields=[{name:'title',label:'Tytuł'},{name:'warmup',label:'Rozgrzewka',type:'textarea'},{name:'main_part',label:'Część główna',type:'textarea'},{name:'games',label:'Zabawy',type:'textarea'},{name:'ending',label:'Zakończenie',type:'textarea'},{name:'equipment',label:'Sprzęt',optional:true},{name:'minutes',label:'Czas (min)',type:'number',min:1,max:240},{name:'private',label:'Widoczność',options:[['true','Prywatny'],['false','Wspólny (administrator)']]}];
 if(action==='assess')fields=[{name:'athlete_id',label:'Dziecko',options:libraryData.children.map(a=>[a.id,a.name])},{name:'skill_id',label:'Umiejętność',options:libraryData.skills.map(s=>[s.id,s.name])},{name:'status',label:'Poziom',options:[['new','Nie rozpoczęto'],['learning','W trakcie'],['mastered','Opanowano']]},{name:'comment',label:'Komentarz',type:'textarea',optional:true},{name:'published',label:'Widoczność',options:[['false','Wewnętrzna'],['true','Udostępnij rodzicowi']]}];
 operationDialog(button.textContent,fields,async body=>{for(const key of ['min_age','max_age','group_id','program_id','minutes','athlete_id','skill_id'])if(key in body)body[key]=Number(body[key]);for(const key of ['private','published'])if(key in body)body[key]=body[key]==='true';await api('library/'+action,body);await loadLibrary();});
 }if(button.dataset.adventure){const id=Number(button.dataset.adventure);operationDialog('Karta Przygody',[{name:'hero',label:'Bohater',options:[['fox','Lis'],['giraffe','Żyrafa'],['hare','Zając'],['turtle','Żółw'],['seal','Foka'],['monkey','Małpka']]}],async b=>{await api('library/card',{...b,athlete_id:id});await loadLibrary();});$('#operation-help').innerHTML=`35 pól na kartę. Pieczątki wynikają z potwierdzonych obecności. <a target="_blank" rel="noopener" href="/api/library/pdf?type=card&id=${id}">Pobierz kartę PDF</a>`;}});

let businessData;
const businessLabels={contract:'Warunki współpracy',availability:'Zgłoś dostępność',rate:'Stawka trenera',adjustment:'Korekta wynagrodzenia',category:'Kategoria kosztu',cost:'Dodaj koszt',rent:'Stawki najmu',snapshot:'Zapisz raport miesiąca'};
async function loadBusiness(){try{businessData=await api('business');const admin=authInfo.user.role==='admin';$('#business-month').value||=state.now.slice(0,7);$('#business-trainer').innerHTML=businessData.trainers.map(t=>`<option value="${t.id}">${escape(t.name)}</option>`).join('');$('#business-actions').innerHTML=Object.entries(businessLabels).filter(([key])=>admin||key==='availability').map(([key,label])=>`<button class="secondary" data-business-action="${key}">${label}</button>`).join('');$('#business-records').innerHTML='<h2>Stawki trenerów</h2>'+businessData.rates.map(r=>`<div class="entry">${escape(businessData.trainers.find(t=>t.id===r.trainer_id)?.name||'')} · ${money(r.amount)} / ${r.unit_minutes} min<small>Od ${escape(r.starts_on)} · ${escape(state.locations.find(l=>l.id===r.location_id)?.name||'Wszystkie lokalizacje')}</small></div>`).join('')+'<h2>Warunki współpracy</h2>'+businessData.contracts.map(c=>`<div class="entry">${escape(businessData.trainers.find(t=>t.id===c.trainer_id)?.name||'')} · ${{commission:'Zlecenie',b2b:'B2B',employment:'Umowa o pracę',other:'Inna'}[c.kind]}<small>Od ${escape(c.starts_on)}${c.ends_on?' do '+escape(c.ends_on):''} · kwoty ${{net:'netto',gross:'brutto',invoice:'faktury'}[c.presentation]}</small></div>`).join('')+'<h2>Dostępność</h2>'+businessData.availability.map(a=>`<div class="entry">${escape(businessData.trainers.find(t=>t.id===a.trainer_id)?.name||'')} · ${escape(a.starts_at)} – ${escape(a.ends_at)}<p>${escape(a.reason)}</p><small>${{pending:'Do zatwierdzenia',approved:'Zatwierdzona',rejected:'Odrzucona'}[a.status]}</small>${admin&&a.status==='pending'?`<button class="secondary" data-availability-decision="${a.id}" data-return-tab="${a.kind==='unavailable'?'absence':'availability'}" data-status="approved">Zatwierdź</button><button class="secondary" data-availability-decision="${a.id}" data-return-tab="${a.kind==='unavailable'?'absence':'availability'}" data-status="rejected">Odrzuć</button>`:''}</div>`).join('')+(admin?'<h2>Koszty</h2>'+businessData.costs.map(c=>`<div class="entry">${escape(c.label)} · ${money(c.amount)}<small>${escape(c.date)} · ${c.recurrence==='monthly'?'Co miesiąc':'Jednorazowy'}</small></div>`).join('')+'<h2>Zapisane raporty</h2>'+businessData.snapshots.map(r=>`<div class="entry">${escape(r.month)} · wersja ${r.revision}<small>${escape(r.reason)}</small><button class="secondary" data-report-snapshot="${r.id}">Otwórz zapisaną wersję</button></div>`).join(''):'');await previewBusiness();}catch(e){notice(e.message,true);}}
async function previewBusiness(){try{const month=$('#business-month').value,trainer=Number($('#business-trainer').value),admin=authInfo.user.role==='admin';$('#business-wages').innerHTML='';if(trainer){const data=await api('business/wages?trainer_id='+trainer+'&month='+month);$('#business-wages').innerHTML=`<h2>Wynagrodzenie: ${money(data.amount)}</h2><p>${{draft:'Podgląd',approved:'Zatwierdzone',paid:'Wypłacone'}[data.status]}${data.missing?' · Brak stawek lub czasu zajęć':''}</p>`+data.items.map(i=>`<div class="entry">${escape(i.date||i.reason||'Korekta')} · ${i.minutes?i.minutes+' min · ':''}${i.amount===null?'Brak stawki':money(i.amount)}</div>`).join('')+(admin&&data.status==='draft'&&!data.missing?`<button class="primary" data-settle-wages="${trainer}">Zatwierdź zestawienie</button>`:admin&&data.status==='approved'?`<button class="secondary" data-paid-wages="${data.id}">Oznacz wypłatę</button>`:'');}$('#business-report').innerHTML='';if(admin){const r=await api('business/report?month='+month);$('#business-report').innerHTML='<h2>Firma · '+escape(month)+'</h2>'+[['Naliczone przychody',r.revenue],['Otrzymane wpłaty',r.received],['Wykonane zwroty',r.refunds],['Koszty operacyjne',r.operating],['Zatwierdzone wynagrodzenia',r.wages],['Najem',r.rental],['Wynik operacyjny',r.result],['Podatki i ZUS (wprowadzone)',r.taxes]].map(([label,value])=>`<div class="entry">${label}: <strong>${money(value)}</strong></div>`).join('')+'<p class="hint">'+escape(r.note)+'</p>'+reportSources(r)+`<p><a href="/api/export?kind=report&amp;month=${month}&amp;format=xlsx">Raport XLSX</a> · <a href="/api/export?kind=wages&amp;month=${month}&amp;format=csv">Wynagrodzenia CSV</a></p>`;}}catch(e){notice(e.message,true);}}
$('#business-preview').onclick=previewBusiness;
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;const action=button.dataset.businessAction,today=state?.now.slice(0,10);if(action){const teacher={name:'trainer_id',label:'Trener',options:businessData.trainers.filter(t=>!button.dataset.profileTrainer||t.id===Number(button.dataset.profileTrainer)).map(t=>[t.id,t.name]),value:button.dataset.profileTrainer||$('#business-trainer').value},location={name:'location_id',label:'Lokalizacja',options:[['','Wszystkie / koszt ogólny'],...state.locations.map(l=>[l.id,l.name])],optional:true},start={name:'starts_on',label:'Od',type:'date',value:today},amount={name:'amount',label:'Kwota (zł)'},month={name:'month',label:'Miesiąc',type:'month',value:$('#business-month').value};let fields=[];
if(action==='contract')fields=[teacher,{name:'kind',label:'Forma współpracy',options:[['commission','Zlecenie'],['b2b','B2B'],['employment','Umowa o pracę'],['other','Inna']]},start,{name:'ends_on',label:'Do',type:'date',optional:true},{name:'presentation',label:'Znaczenie kwoty',options:[['gross','Brutto'],['net','Netto'],['invoice','Kwota faktury']]}];
if(action==='availability')fields=[teacher,{name:'starts_at',label:'Początek',type:'datetime-local'},{name:'ends_at',label:'Koniec',type:'datetime-local'},{name:'kind',label:'Rodzaj',options:[['available','Dostępność'],['unavailable','Niedostępność'],['substitute','Gotowość do zastępstwa']],value:button.dataset.availabilityKind||'available'},{name:'reason',label:'Opis'}];
if(action==='rate')fields=[teacher,location,start,amount,{name:'unit_minutes',label:'Za',options:[[30,'30 minut'],[60,'60 minut']]}];
if(action==='adjustment')fields=[teacher,month,location,{...amount,label:'Kwota korekty (zł, może być ujemna)'},{name:'reason',label:'Powód'}];
if(action==='category')fields=[{name:'name',label:'Nazwa kategorii'}];
if(action==='cost')fields=[{name:'category_id',label:'Kategoria',options:businessData.categories.map(c=>[c.id,c.name])},location,amount,{name:'date',label:'Data',type:'date',value:today},{name:'label',label:'Opis'},{name:'recurrence',label:'Powtarzanie',options:[['none','Jednorazowy'],['monthly','Co miesiąc']]},{name:'ends_on',label:'Koniec powtarzania',type:'date',optional:true},{name:'kind',label:'Rodzaj',options:[['operating','Operacyjny'],['vat','VAT'],['income_tax','Podatek dochodowy'],['social','ZUS']]}];
if(action==='rent')fields=[{...location,optional:false,options:location.options.slice(1)},start,{name:'amount_per_hour',label:'Stawka godzinowa (zł)',value:'0'},{name:'minimum_minutes',label:'Minimalny blok (min)',type:'number',min:0,value:0},{name:'cleaning',label:'Sprzątanie za blok (zł)',value:'0'},{name:'fixed_monthly',label:'Stała opłata miesięczna (zł)',value:'0'}];
if(action==='snapshot')fields=[month,{name:'reason',label:'Opis zapisanej wersji'}];
operationDialog(businessLabels[action],fields,async b=>{for(const key of ['trainer_id','location_id','category_id','unit_minutes','minimum_minutes'])if(key in b)b[key]=b[key]?Number(b[key]):null;for(const key of ['amount','amount_per_hour','cleaning','fixed_monthly'])if(key in b)b[key]=b[key].startsWith('-')?-cents(b[key].slice(1)):cents(b[key]);await api('business/'+action,b);await loadBusiness();if(button.dataset.profileTrainer)await openTrainerProfile(Number(button.dataset.profileTrainer),button.dataset.profileTab||'data');});}
try{if(button.dataset.availabilityDecision){await api('business/approveAvailability',{id:Number(button.dataset.availabilityDecision),status:button.dataset.status});await loadBusiness();if($('#trainer-profile-dialog').open)await openTrainerProfile(Number($('#trainer-profile-content').dataset.trainerId),button.dataset.returnTab||'availability');}if(button.dataset.settleWages)operationDialog('Zatwierdź wynagrodzenie',[],async()=>{await api('business/settle',{trainer_id:Number(button.dataset.settleWages),month:$('#business-month').value});await loadBusiness();if($('#trainer-profile-dialog').open)await openTrainerProfile(Number($('#trainer-profile-content').dataset.trainerId),'wages');},'Zapisane zestawienie zachowa kwoty. Późniejsze korekty wprowadź w otwartym miesiącu.');if(button.dataset.paidWages)operationDialog('Oznacz wykonaną wypłatę',[{name:'date',label:'Data wypłaty',type:'date',value:today}],async b=>{await api('business/paid',{...b,id:Number(button.dataset.paidWages)});await loadBusiness();if($('#trainer-profile-dialog').open)await openTrainerProfile(Number($('#trainer-profile-content').dataset.trainerId),'wages');});}catch(e){notice(e.message,true);}});

let bankPreview;
$('#bank-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;const response=await fetch('/api/import/preview?type='+file.name.split('.').at(-1).toLowerCase(),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw Error(result.error);bankPreview=result;$('#bank-mapping').innerHTML=[['date','Data wpływu'],['amount','Kwota (zł)'],['reference','Identyfikator transakcji']].map(([key,label])=>`<label>${label}<select data-bank-column="${key}"><option value="">Wybierz kolumnę</option>${result.headers.map((h,i)=>`<option value="${i}">${escape(h)}</option>`).join('')}</select></label>`).join('')+'<button type="button" class="secondary" id="bank-show">Pokaż podgląd</button>';$('#bank-preview').innerHTML='';$('#bank-commit').hidden=true;$('#bank-show').onclick=renderBankPreview;}catch(e){notice(e.message,true);}};
function renderBankPreview(){const mapping=Object.fromEntries([...document.querySelectorAll('[data-bank-column]')].map(s=>[s.dataset.bankColumn,s.value]));if(Object.values(mapping).some(v=>v===''))return notice('Wybierz wszystkie kolumny.',true);bankPreview.mapping=mapping;$('#bank-preview').innerHTML=(bankPreview.rows.length>100?'<p>Pierwsze 100 wierszy. Podziel większy plik na części.</p>':'')+bankPreview.rows.slice(0,100).map((row,index)=>`<div class="entry"><label class="check"><input type="checkbox" data-bank-row="${index}">Wybierz wpłatę</label><p>${escape(row[mapping.date]||'')} · ${escape(row[mapping.amount]||'')} zł · ${escape(row[mapping.reference]||'')}</p><label>Zawodnik<select data-bank-child="${index}"><option value="">Wybierz zawodnika</option>${bankPreview.athletes.map(a=>`<option value="${a.id}">${escape(a.name)} (#${a.id})</option>`).join('')}</select></label></div>`).join('');$('#bank-commit').hidden=false;}
$('#bank-commit').onclick=async event=>{const button=event.target;button.disabled=true;try{const m=bankPreview.mapping,rows=[...document.querySelectorAll('[data-bank-row]:checked')].map(input=>{const index=input.dataset.bankRow,row=bankPreview.rows[index];return {athlete_id:Number(document.querySelector(`[data-bank-child="${index}"]`).value),date:row[m.date].trim(),amount:cents(row[m.amount].replace(/\s/g,'')),reference:row[m.reference].trim()};});const result=await api('import/bank',{rows});await refresh();notice(`Dodano: ${result.created}. Już zaksięgowane: ${result.duplicates}.`);}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
for(const action of ['transfer','suspend','resume'])$('#members-'+action).onclick=()=>{const ids=[...document.querySelectorAll('[data-member-selection]:checked')].map(el=>Number(el.dataset.memberSelection));if(!ids.length)return notice('Zaznacz zawodników na liście.',true);operationDialog(action==='transfer'?'Przeniesienie zawodników':action==='resume'?'Wznowienie udziału':'Zawieszenie udziału',[...(action==='transfer'?[{name:'target_group_id',label:'Grupa docelowa',options:groupOptions().filter(([id])=>id!==rosterGroupId)}]:[]),{name:'reason',label:'Powód'}],async b=>{await api('memberships/operate',{...b,action,athlete_ids:ids,group_id:rosterGroupId,target_group_id:Number(b.target_group_id)||null});$('#roster-dialog').close();},action==='resume'?'Wznowienie od teraz przy wolnym miejscu, z naliczeniem pozostałych zajęć.':'Operacja od teraz. Przyszłe jednostki w dotychczasowej grupie zostaną skorygowane; przy przeniesieniu powstanie należność nowej grupy. Cała operacja zostanie wycofana, jeśli choć jeden zapis nie będzie możliwy.');};

let athleteImportRows;
$('#athlete-import-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;$('#athlete-import-commit').hidden=true;const response=await fetch('/api/import/preview?type='+file.name.split('.').at(-1).toLowerCase(),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const data=await response.json();if(!response.ok)throw Error(data.error);$('#athlete-import-map').innerHTML=[['name','Imię i nazwisko dziecka'],['birth_date','Data urodzenia'],['parent_email','Email rodzica'],['parent_name','Imię i nazwisko rodzica'],['parent_phone','Telefon rodzica']].map(([key,label])=>`<label>${label}<select data-athlete-column="${key}"><option value="">Wybierz kolumnę</option>${data.headers.map((h,i)=>`<option value="${i}">${escape(h)}</option>`).join('')}</select></label>`).join('')+'<button class="secondary" id="check-athlete-import">Sprawdź dane</button>';$('#check-athlete-import').onclick=async()=>{try{const map=Object.fromEntries([...document.querySelectorAll('[data-athlete-column]')].map(s=>[s.dataset.athleteColumn,s.value]));if(Object.values(map).some(v=>v===''))throw Error('Przypisz wszystkie kolumny.');if(data.rows.length>100)throw Error('Podziel plik na części po maksymalnie 100 wierszy.');athleteImportRows=data.rows.map(row=>Object.fromEntries(Object.entries(map).map(([key,index])=>[key,row[index]||''])));const result=await api('import/athletes/check',{rows:athleteImportRows});$('#athlete-import-preview').innerHTML=result.rows.map(row=>`<div class="entry">Wiersz ${row.index+1}: ${escape(row.error||row.name+' · '+row.parent_email+(row.existing_id?' · Istnieje, zostanie pominięty':' · Nowa kartoteka'))}</div>`).join('');$('#athlete-import-commit').hidden=result.rows.some(row=>row.error);}catch(e){$('#athlete-import-commit').hidden=true;notice(e.message,true);}};}catch(e){notice(e.message,true);}};
$('#athlete-import-commit').onclick=async event=>{const button=event.target;button.disabled=true;try{const result=await api('import/athletes',{rows:athleteImportRows});await refresh();notice(`Utworzono: ${result.created}. Pominięto istniejące: ${result.skipped}.`);}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
$('#find-duplicates').onclick=async()=>{try{const data=await api('athletes/duplicates');$('#athlete-duplicates').innerHTML=data.pairs.map(p=>`<div class="entry">${escape(p.target.name)} · kartoteki #${p.target.id} i #${p.source.id}<button class="secondary" data-merge-source="${p.source.id}" data-merge-target="${p.target.id}">Sprawdź i połącz</button></div>`).join('')||'<p>Brak zgodnych duplikatów w obrębie tego samego rodzica.</p>';}catch(e){notice(e.message,true);}};
document.addEventListener('click',event=>{const button=event.target.closest('[data-merge-source]');if(!button)return;operationDialog('Połącz kartoteki',[{name:'reason',label:'Powód połączenia'},{name:'confirmed',label:'Potwierdzenie',options:[['false','Wybierz decyzję'],['true','Potwierdzam: to ta sama osoba']]}],async b=>{await api('athletes/merge',{...b,confirmed:b.confirmed==='true',source_id:Number(button.dataset.mergeSource),target_id:Number(button.dataset.mergeTarget)});$('#athlete-duplicates').innerHTML='';},`Historia kartoteki #${button.dataset.mergeSource} zostanie przeniesiona do #${button.dataset.mergeTarget}. Konflikt zapisów lub dostępów przerwie całą operację. Sprawdź oba profile przed zatwierdzeniem.`);});
function reportSources(r){return '<details><summary>Źródła naliczeń i kosztów</summary><h3>Należności</h3>'+r.charges.map(c=>`<div class="entry">#${c.id} · ${escape(c.child)} · ${money(c.due)}</div>`).join('')+'<h3>Koszty</h3>'+r.costs.map(c=>`<div class="entry">${escape(c.label)} · ${money(c.amount)}</div>`).join('')+'<h3>Najem</h3>'+r.rent_items.map(c=>`<div class="entry">${escape(c.start||c.label)} · ${money(c.amount)}</div>`).join('')+'</details>';}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-report-snapshot]');if(!button)return;try{const saved=await api('business/snapshot?id='+button.dataset.reportSnapshot),r=saved.data;$('#report-snapshot-content').innerHTML=`<h3>${escape(saved.month)} · wersja ${saved.revision}</h3><p>${escape(saved.reason)}</p><p>Przychody: ${money(r.revenue)} · wpłaty: ${money(r.received)} · wynik operacyjny: ${money(r.result)}</p>`+reportSources(r);openDialog('report-dialog');}catch(e){notice(e.message,true);}});

function paymentDeadlineLabel(e){const date=e.due_on?e.due_on.split('-').reverse().join('.'):'nieustalony';const label={overdue:`Po terminie: ${e.overdue_days} dni`,pending:'W terminie',unknown:'Termin nieustalony',settled:'Rozliczona',credit:'Nadpłata'}[e.payment_status]||'';return `Termin płatności: ${date} · ${label}`;}
document.addEventListener('click',event=>{const button=event.target.closest('[data-deadline]');if(!button)return;const entry=state.enrollments.find(e=>e.id===Number(button.dataset.deadline));operationDialog('Termin płatności',[{name:'due_on',label:'Termin',type:'date',value:entry.due_on||state.now.slice(0,10)},{name:'reason',label:'Powód ustalenia lub zmiany terminu'}],b=>api('finance/dueDate',{...b,enrollment_id:entry.id}),'Zmiana dotyczy tylko tej należności i zostanie zapisana w historii.');});

function renderHourlyCalendar(days,byDate){
 const laidOut=days.map(day=>layoutLessons(byDate.get(day)||[]));
 const all=laidOut.flat(),startHour=Math.min(8,...all.map(e=>Math.floor(e.start/60))),endHour=Math.max(18,...all.map(e=>Math.ceil(e.end/60)));
 const scale=2,height=(endHour-startHour)*60*scale;
 const times=Array.from({length:endHour-startHour+1},(_,index)=>startHour+index);
 $('#lesson-list').innerHTML=`<div class="hour-calendar" style="--day-count:${days.length};--calendar-height:${height}px"><div class="hour-corner">Godzina</div>${days.map(day=>`<h3 class="hour-day-heading">${escape(new Date(day+'T12:00:00Z').toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}))}${day===state.now.slice(0,10)?'<small>Dzisiaj</small>':''}</h3>`).join('')}<div class="hour-axis">${times.map(hour=>`<span style="top:${(hour-startHour)*120}px">${String(hour).padStart(2,'0')}:00</span>`).join('')}</div>${days.map((day,index)=>`<section class="lesson-day hour-day" aria-label="${day}">${laidOut[index].map(event=>{const s=event.item,label=`${s.group_name} · ${s.location} · ${s.starts_at.slice(11,16)}${s.ends_at?'–'+s.ends_at.slice(11,16):' · koniec nieustalony'} · ${s.trainers.map(t=>t.name).join(', ')||'Bez trenera'} · ${s.excluded?'Odwołane':s.completed?'Zrealizowane':'Brakujące obecności: '+s.missing}`;return `<button class="lesson-event hour-event ${s.excluded?'cancelled':s.completed?'completed':''}" data-lesson="${s.id}" title="${escape(label)}" aria-label="${escape(label)}" style="top:${(event.start-startHour*60)*scale}px;height:${Math.max(2,(event.end-event.start)*scale)}px;left:calc(${event.lane/event.lanes*100}% + 3px);width:calc(${100/event.lanes}% - 6px)"><span class="lesson-time">${escape(s.starts_at.slice(11,16))}${s.ends_at?'–'+escape(s.ends_at.slice(11,16)):' · ?'}</span><strong>${escape(s.group_name)}</strong><small>${escape(s.location)}</small></button>`;}).join('')}${laidOut[index].length?'':'<p class="hour-empty">Brak zajęć</p>'}</section>`).join('')}</div><p class="hint">Kliknij zajęcia, aby otworzyć dziennik. Znak „?” oznacza nieustaloną godzinę zakończenia — kafelek zajmuje umownie 30 minut.</p>`;
}
let attendanceRequest=0;
async function loadAthleteAttendance(id){
 const request=++attendanceRequest,container=$('#athlete-attendance-content');container.innerHTML='<p class="hint">Wczytywanie obecności…</p>';
 try{const result=await api('calendar/athlete?id='+id);if(request!==attendanceRequest||Number($('#athlete-detail').dataset.athleteId)!==id)return;
 const past=result.items.filter(s=>s.starts_at<=state.now&&!s.excluded),present=past.filter(s=>s.status==='present').length;
 container.innerHTML=`<div class="profile-summary"><span>Obecności: <strong>${present}</strong></span><span>Nieobecności: <strong>${past.filter(s=>s.status==='absent').length}</strong></span><span>Nieuzupełnione: <strong>${past.filter(s=>s.status==='unmarked').length}</strong></span></div><label>Miesiąc<input type="month" id="attendance-month" value="${state.now.slice(0,7)}"></label><div id="attendance-history"></div>`;
 const render=()=>{const month=$('#attendance-month').value,rows=result.items.filter(s=>!month||s.starts_at.startsWith(month));$('#attendance-history').innerHTML=rows.map(s=>`<div class="entry exclusion-entry"><div><strong>${escape(s.group_name)}</strong><small>${escape(termLabel(s))} · ${escape(s.location)}</small><span class="status-badge ${s.status==='present'?'success':s.status==='absent'?'danger':'neutral'}">${s.excluded?'Zajęcia odwołane':s.starts_at>state.now?'Zaplanowane':{present:'Obecny',absent:'Nieobecny',unmarked:'Nieuzupełniona obecność'}[s.status]}</span>${s.reported_absent?'<small>Rodzic zgłosił nieobecność</small>':''}</div><button class="secondary" data-lesson="${s.id}">Dziennik</button></div>`).join('')||'<p class="hint">Brak zajęć w wybranym miesiącu.</p>';};$('#attendance-month').onchange=render;render();
 }catch(error){if(request===attendanceRequest)container.textContent=error.message;}
}
let dashboardRequest=0;
async function loadDashboard(){
 if(!state||state.user.role!=='admin')return;
 const request=++dashboardRequest,today=state.now.slice(0,10);$('#dashboard-date').textContent=new Date(today+'T12:00:00Z').toLocaleDateString('pl-PL',{dateStyle:'full',timeZone:'UTC'});$('#dashboard-content').innerHTML='<p class="hint">Wczytywanie podsumowania…</p>';
 try{const [calendar,business]=await Promise.all([api('calendar?from='+today+'&to='+today),api('business')]);if(request!==dashboardRequest)return;
 const overdue=state.enrollments.filter(e=>e.overdue_amount>0),pending=business.availability.filter(a=>a.status==='pending'),waiting=state.waiting_list.filter(w=>w.status==='waiting');
 const recent=[...state.athletes].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5);
 $('#dashboard-content').innerHTML=`<div class="dashboard-metrics"><button data-dashboard-calendar><span>Zajęcia dzisiaj</span><strong>${calendar.items.filter(s=>!s.excluded).length}</strong></button><button data-dashboard-overdue><span>Po terminie</span><strong>${money(overdue.reduce((sum,e)=>sum+e.overdue_amount,0))}</strong><small>${overdue.length} należności</small></button><button data-view="waiting"><span>Lista rezerwowa</span><strong>${waiting.length}</strong></button><button data-view="athletes"><span>Zawodnicy</span><strong>${state.athletes.length}</strong></button></div><div class="dashboard-grid"><article class="section-card"><div class="section-toolbar"><h2>Dzisiejsze zajęcia</h2><button class="secondary" data-dashboard-calendar>Cały kalendarz</button></div>${calendar.items.map(s=>`<div class="entry exclusion-entry"><div><strong>${escape(s.starts_at.slice(11,16))} · ${escape(s.group_name)}</strong><small>${escape(s.location)} · ${escape(s.trainers.map(t=>t.name).join(', ')||'Bez trenera')}</small><small>${s.excluded?'Odwołane':s.completed?'Zrealizowane':'Brakujące obecności: '+s.missing}</small></div><button class="secondary" data-lesson="${s.id}">Dziennik</button></div>`).join('')||'<p class="hint">Na dziś nie zaplanowano zajęć.</p>'}</article><article class="section-card"><h2>Wymaga uwagi</h2>${pending.map(a=>`<button class="attention-link" data-trainer-profile="${a.trainer_id}" data-profile-tab="availability">${escape(business.trainers.find(t=>t.id===a.trainer_id)?.name||'Trener')}<small>${a.kind==='unavailable'?'Nieobecność':'Dostępność'} do zatwierdzenia · ${escape(a.starts_at.slice(0,10))}</small></button>`).join('')}${overdue.length?'<button class="attention-link" data-dashboard-overdue>Zaległe należności<small>Przejdź do rozliczeń po terminie →</small></button>':''}${!pending.length&&!overdue.length?'<p class="hint">Brak oczekujących dostępności i zaległych należności.</p>':''}</article><article class="section-card"><h2>Ostatnio dodani zawodnicy</h2>${recent.map(a=>`<button class="attention-link" data-athlete="${a.id}">${escape(a.name)}<small>${escape(a.created_at.slice(0,10))} · Otwórz kartotekę →</small></button>`).join('')||'<p class="hint">Brak zawodników.</p>'}</article><article class="section-card"><h2>Szybkie działania</h2><div class="quick-actions"><button class="primary" data-new-athlete>Dodaj zawodnika</button><button class="secondary" data-open="group-dialog">Dodaj grupę</button><button class="secondary" data-view="finance">Wpłaty i cenniki</button><a class="secondary" href="/zapisy" target="_blank" rel="noopener">Formularz zapisów ↗</a></div></article></div>`;
 }catch(error){if(request===dashboardRequest)$('#dashboard-content').textContent=error.message;}
}
$('#dashboard-refresh').onclick=async()=>{try{await refresh();await loadDashboard();}catch(error){notice(error.message,true);}};
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-dashboard-overdue')){$('#billing-filter-reset').click();$('#billing-filter-status').value='overdue';renderAdmin();window.location.hash='billing';switchView('billing');}if(button.hasAttribute('data-dashboard-calendar')){const form=$('#lesson-filters');form.elements.from.value=state.now.slice(0,10);form.elements.to.value=state.now.slice(0,10);form.elements.view.value='day';window.location.hash='calendar';switchView('calendar');}if(button.dataset.trainerProfile)openTrainerProfile(Number(button.dataset.trainerProfile),button.dataset.profileTab||'data');if(button.dataset.profileGroup){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();const group=state.groups.find(g=>g.id===Number(button.dataset.profileGroup));selectedGroupLocation=group.location_id;selectedAdminGroup=group.id;window.location.hash='groups';switchView('groups');renderCalendar();}});
let trainerProfileRequest=0;
async function openTrainerProfile(id,tab='data'){
 if(state?.user.role!=='admin')return;
 const trainer=state.trainers.find(t=>t.id===id);if(!trainer)return;
 const request=++trainerProfileRequest,container=$('#trainer-profile-content');container.dataset.trainerId=id;
 const month=container.dataset.month||state.now.slice(0,7);container.dataset.month=month;
 $('#trainer-profile-title').textContent=trainer.name;container.innerHTML='<p class="hint">Wczytywanie karty trenera…</p>';if(!$('#trainer-profile-dialog').open)openDialog('trainer-profile-dialog');
 try{const [data,wages]=await Promise.all([api('business'),api('business/wages?trainer_id='+id+'&month='+month)]);if(request!==trainerProfileRequest)return;
 businessData=data;$('#business-month').value=month;
 const groups=state.groups.filter(g=>state.group_trainers.some(t=>t.group_id===g.id&&t.trainer_id===id)),contract=data.contracts.find(c=>c.trainer_id===id),availability=data.availability.filter(a=>a.trainer_id===id);
 const action=(key,label,target,kind='')=>`<button class="secondary" data-business-action="${key}" data-profile-trainer="${id}" data-profile-tab="${target}" ${kind?`data-availability-kind="${kind}"`:''}>${label}</button>`;
 const tabs=[['data','Dane'],['groups','Grupy'],['availability','Dyspozycyjność'],['absence','Nieobecności'],['wages','Wynagrodzenia']];
 const availabilityRows=rows=>rows.map(a=>`<div class="entry"><strong>${escape(a.starts_at.replace('T',' '))} – ${escape(a.ends_at.replace('T',' '))}</strong><p>${escape(a.reason)}</p><span class="status-badge ${a.status==='approved'?'success':'neutral'}">${{pending:'Do zatwierdzenia',approved:'Zatwierdzona',rejected:'Odrzucona'}[a.status]}</span>${a.weekday!==null?`<small>Dzień tygodnia: ${['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'][a.weekday]}</small>`:''}${a.status==='pending'?`<div class="table-actions"><button class="secondary" data-availability-decision="${a.id}" data-return-tab="${a.kind==='unavailable'?'absence':'availability'}" data-status="approved">Zatwierdź</button><button class="secondary" data-availability-decision="${a.id}" data-return-tab="${a.kind==='unavailable'?'absence':'availability'}" data-status="rejected">Odrzuć</button></div>`:''}</div>`).join('')||'<p class="hint">Brak wpisów.</p>';
 container.innerHTML=`<div class="profile-summary"><span class="pill">${{active:'Aktywny',inactive:'Nieaktywny',archived:'Archiwalny'}[trainer.status]}</span><span>${groups.length} grup</span><span>${trainer.account_active?'Konto aktywowane':trainer.user_id?'Konto czeka na aktywację':'Brak konta logowania'}</span></div><div class="athlete-tabs" role="tablist" aria-label="Karta trenera">${tabs.map(([key,label])=>`<button role="tab" id="trainer-tab-${key}" aria-controls="trainer-panel-${key}" aria-selected="false" tabindex="-1" data-trainer-tab="${key}">${label}</button>`).join('')}</div>
 <section id="trainer-panel-data" role="tabpanel" aria-labelledby="trainer-tab-data"><dl class="athlete-fields"><div><dt>Imię i nazwisko</dt><dd>${escape(trainer.name)}</dd></div><div><dt>Email</dt><dd>${escape(trainer.email||'Nie podano')}</dd></div><div><dt>Telefon</dt><dd>${escape(trainer.phone||'Nie podano')}</dd></div></dl><div class="trainer-actions"><button class="secondary" data-edit-trainer="${id}">Edytuj dane</button>${!trainer.account_active&&trainer.status==='active'?`<button class="secondary" data-trainer-account="${id}">Utwórz link aktywacyjny</button>`:''}</div><h3>Warunki współpracy</h3>${contract?`<p>${{commission:'Zlecenie',b2b:'B2B',employment:'Umowa o pracę',other:'Inna'}[contract.kind]} · od ${escape(contract.starts_on)}${contract.ends_on?' do '+escape(contract.ends_on):''} · kwoty ${{gross:'brutto',net:'netto',invoice:'faktury'}[contract.presentation]}</p>`:'<p class="hint">Nie określono warunków współpracy.</p>'}${action('contract','Ustaw warunki współpracy','data')}</section>
 <section id="trainer-panel-groups" role="tabpanel" aria-labelledby="trainer-tab-groups" hidden>${groups.map(g=>`<div class="entry exclusion-entry"><div><strong>${escape(g.name)}</strong><small>${escape(g.location)} · ${escape(scheduleLabel(g))}</small><small>${g.member_count} / ${g.capacity} zapisanych</small></div><button class="secondary" data-profile-group="${g.id}">Otwórz grupę →</button></div>`).join('')||'<p class="hint">Brak przypisanych grup.</p>'}</section>
 <section id="trainer-panel-availability" role="tabpanel" aria-labelledby="trainer-tab-availability" hidden><div class="trainer-actions">${action('availability','Dodaj dyspozycyjność','availability','available')}</div>${availabilityRows(availability.filter(a=>a.kind!=='unavailable'))}</section>
 <section id="trainer-panel-absence" role="tabpanel" aria-labelledby="trainer-tab-absence" hidden><div class="trainer-actions">${action('availability','Dodaj nieobecność','absence','unavailable')}</div><p class="hint">Zatwierdzenie nieobecności nie odwołuje zajęć. Otwórz powiązany termin, aby wyznaczyć zastępstwo lub go odwołać.</p>${availabilityRows(availability.filter(a=>a.kind==='unavailable'))}<div id="trainer-absence-lessons"></div></section>
 <section id="trainer-panel-wages" role="tabpanel" aria-labelledby="trainer-tab-wages" hidden><div class="section-toolbar"><label>Miesiąc<input type="month" id="trainer-wages-month" value="${month}"></label><strong>${money(wages.amount)}</strong></div><p>${{draft:'Podgląd wynagrodzenia',approved:'Zatwierdzone zestawienie',paid:'Wypłacone'}[wages.status]}${wages.missing?' · Uzupełnij stawki lub czas zajęć':''}</p><div class="trainer-actions">${action('rate','Dodaj stawkę','wages')}${action('adjustment','Korekta wynagrodzenia','wages')}${wages.status==='draft'&&!wages.missing?`<button class="primary" data-settle-wages="${id}">Zatwierdź zestawienie</button>`:wages.status==='approved'?`<button class="primary" data-paid-wages="${wages.id}">Oznacz wypłatę</button>`:''}</div><h3>Pozycje zestawienia</h3>${wages.items.map(i=>`<div class="entry">${escape(i.date||i.reason||'Korekta')} · ${i.minutes?i.minutes+' min · ':''}${i.amount===null?'Brak stawki lub czasu':money(i.amount)}${i.session_id?`<button class="secondary" data-lesson="${i.session_id}">Dziennik</button>`:''}</div>`).join('')||'<p class="hint">Brak zrealizowanych zajęć i korekt w tym miesiącu.</p>'}<h3>Stawki</h3>${data.rates.filter(r=>r.trainer_id===id).map(r=>`<div class="entry">${money(r.amount)} / ${r.unit_minutes} minut<small>Od ${escape(r.starts_on)} · ${escape(state.locations.find(l=>l.id===r.location_id)?.name||'Wszystkie lokalizacje')}</small></div>`).join('')||'<p class="hint">Brak stawek.</p>'}</section>`;
 selectTrainerTab(tab);$('#trainer-wages-month').onchange=event=>{if(!event.target.value)return;container.dataset.month=event.target.value;openTrainerProfile(id,'wages');};
 const absences=availability.filter(a=>a.kind==='unavailable'&&a.status!=='rejected'&&a.ends_at>=state.now);
 if(absences.length){const from=absences.reduce((v,a)=>a.starts_at<v?a.starts_at:v,absences[0].starts_at).slice(0,10),to=absences.reduce((v,a)=>a.ends_at>v?a.ends_at:v,absences[0].ends_at).slice(0,10),calendar=await api(`calendar?from=${from}&to=${to}&trainer_id=${id}`);if(request!==trainerProfileRequest)return;const affected=calendar.items.filter(s=>!s.excluded&&s.starts_at>=state.now&&absences.some(a=>s.starts_at<a.ends_at&&(s.ends_at||s.starts_at)>=a.starts_at&&(a.weekday===null||new Date(s.starts_at.slice(0,10)+'T12:00:00Z').getUTCDay()===a.weekday)));$('#trainer-absence-lessons').innerHTML='<h3>Zajęcia wymagające sprawdzenia</h3>'+affected.map(s=>`<button class="attention-link" data-lesson="${s.id}">${escape(s.group_name)}<small>${escape(termLabel(s))} · ${escape(s.location)} →</small></button>`).join('')+(affected.length?'':'<p class="hint">Brak przyszłych zajęć pokrywających się ze zgłoszonymi nieobecnościami.</p>');}
 }catch(error){if(request===trainerProfileRequest)container.textContent=error.message;}
}
function selectTrainerTab(key,focus=false){for(const tab of document.querySelectorAll('#trainer-profile-content [role=tab]')){const active=tab.dataset.trainerTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;if(active&&focus)tab.focus();}}
$('#trainer-profile-content').addEventListener('click',event=>{const tab=event.target.closest('[data-trainer-tab]');if(tab)selectTrainerTab(tab.dataset.trainerTab);});
$('#trainer-profile-content').addEventListener('keydown',event=>{const tab=event.target.closest('[role=tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('#trainer-profile-content [role=tab]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTrainerTab(tabs[next].dataset.trainerTab,true);});
$('#trainer-profile-dialog').addEventListener('close',()=>{trainerProfileRequest++;$('#trainer-profile-content').replaceChildren();});
