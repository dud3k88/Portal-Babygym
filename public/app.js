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
const viewNames = { coach: 'Mój grafik i grupy', audit: 'Dziennik zmian', auth: 'Logowanie', athletes: 'Zawodnicy', groups: 'Grupy', locations: 'Lokalizacje', 'days-off': 'Dni wolne', trainers: 'Trenerzy', billing: 'Rozliczenia', settings: 'Wygląd', parent: 'Zapisy na zajęcia', children: 'Moje dzieci' };
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
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

function switchView(view) {
  if (!authInfo.user) view = 'auth';
  else if (authInfo.user.role === 'trainer') view = 'coach';
  else if (authInfo.user.role === 'parent' && !['parent','children'].includes(view)) view = 'parent';
  else if (!viewNames[view] || view === 'auth' || view === 'coach') view = 'groups';
  $('nav').hidden = !authInfo.user;
  $('#logout').hidden = !authInfo.user;
  $('#public-registration-link').hidden = authInfo.user?.role !== 'admin';
  $('#account-name').textContent = authInfo.user?.name || '';
  for (const button of document.querySelectorAll('nav [data-view]')) button.hidden = authInfo.user?.role === 'trainer' ? button.dataset.view !== 'coach' : button.dataset.view === 'coach' || (authInfo.user?.role === 'parent' && !['parent','children'].includes(button.dataset.view));
  for (const label of document.querySelectorAll('nav .nav-label')) label.hidden = authInfo.user?.role === 'trainer' || (authInfo.user?.role === 'parent' && !label.classList.contains('second'));
  for (const section of document.querySelectorAll('main > .page')) section.hidden = section.id !== view;
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
  if(view==='audit') loadAudit();
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
    const count=new Set(state.memberships.filter(member=>groupIds.has(member.group_id)).map(member=>member.athlete_id)).size;
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
    const entities={trainer_notes:'Notatka trenera',locations:'Placówka',users:'Konto',athletes:'Zawodnik',groups:'Grupa',sessions:'Termin',memberships:'Uczestnictwo',enrollments:'Należność',enrollment_sessions:'Pozycja należności',adjustments:'Korekta',exclusions:'Dni wolne',trainers:'Trener',group_trainers:'Przypisanie trenera',access:'Dostęp'};
    const actions={insert:'Dodano',update:'Zmieniono',delete:'Usunięto','session.started':'Rozpoczęto sesję','session.ended':'Wylogowano','account.activated':'Aktywowano konto','invitation.created':'Utworzono zaproszenie'};
    const fields={body:'Treść',updated_at:'Data zmiany',user_id:'Konto ID',id:'ID',name:'Nazwa',email:'Email',phone:'Telefon',role:'Rola',access_status:'Dostęp',address:'Adres',city:'Miejscowość',contact_name:'Osoba kontaktowa',notes:'Notatki',status:'Status',parent_id:'Rodzic ID',birth_date:'Data urodzenia',location_id:'Placówka ID',capacity:'Limit miejsc',price:'Cena (gr)',trial_price:'Cena próby (gr)',trials:'Próby',start_date:'Od dnia',end_date:'Do dnia',start_time:'Od godziny',end_time:'Do godziny',weekday:'Dzień tygodnia',group_id:'Grupa ID',starts_at:'Początek',ends_at:'Koniec',cancelled:'Odwołano',athlete_id:'Zawodnik ID',joined_at:'Data zapisu',trial_id:'Próba ID',month:'Miesiąc',amount:'Kwota (gr)',enrollment_id:'Należność ID',session_id:'Termin ID',reason:'Powód',scope:'Zakres',trainer_id:'Trener ID'};
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
  return { ...body, athlete_id: Number(body.athlete_id), group_id: Number(body.group_id), trial_id: body.trial_id ? Number(body.trial_id) : null };
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
  $('#location').innerHTML = '<option value="">Wybierz lokalizację</option>' + state.locations.filter(location => location.status==='active' && state.groups.some(group => group.location_id === location.id)).map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
  $('#location').value = selectedLocation;
  updateGroups();
  renderAdmin();
  renderCalendar();
  updateExclusionTargets();
  renderExclusions();
  renderTrainers();
  renderLocations();
  updateLocationSelect();
  renderAthletes();
  renderMyChildren();
  updateAthleteSelects();
  const selected = selectedIds('#new-group-trainers');
  $('#new-group-trainers').innerHTML = trainerCheckboxes(selected) || '<p class="hint">Nie dodano jeszcze trenerów. Grupę możesz na razie utworzyć bez prowadzącego.</p>';
  $('#brand-logo').hidden = !state.logo;
  $('#brand-fallback').hidden = Boolean(state.logo);
  if (state.logo) $('#brand-logo').src = state.logo;
}

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
  $('#trial-label').hidden = !group?.trials;
  $('#group-info').innerHTML = group ? `<strong>${escape(group.name)}</strong><span>${escape(group.location)}</span><span>${escape(scheduleLabel(group))}</span><span>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ') || 'Nie przypisano')}</span>` : '';
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
    if (version === quoteVersion) { submit.disabled=false; $('#quote').textContent = `${quote.count} ${$('#trial').value ? 'zajęcia próbne' : 'zajęcia'} · ${money(quote.amount)}`; }
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
  const locationSelect = $(`#${prefix}-filter-location`);
  const groupSelect = $(`#${prefix}-filter-group`);
  const locationId = locationSelect.value, groupId = groupSelect.value;
  locationSelect.innerHTML = '<option value="">Wszystkie lokalizacje</option>' + state.locations.map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
  locationSelect.value = locationId;
  const groups = state.groups.filter(group => !locationSelect.value || String(group.location_id) === locationSelect.value);
  groupSelect.innerHTML = '<option value="">Wszystkie grupy</option>' + groups.map(group => `<option value="${group.id}">${escape(group.name)} · ${escape(group.location)}</option>`).join('');
  groupSelect.value = groupId;
}

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
  const matches = state.enrollments.filter(entry => {
    const assignedGroup = state.groups.find(item => item.id === entry.group_id);
    return [entry.child,entry.parent,entry.email].join(' ').toLocaleLowerCase('pl').includes(search)
      && (!location || String(entry.location_id ?? assignedGroup?.location_id) === location)
      && (!group || String(entry.group_id) === group)
      && (!month || entry.month === month)
      && (!status || (status === 'due' ? entry.balance > 0 : status === 'credit' ? entry.balance < 0 : entry.balance === 0));
  });
  const visible = directorySlice('billing', matches);
  const total = matches.reduce((sum,entry)=>sum+entry.balance,0);
  $('#billing-count').textContent = `Należności: ${matches.length} z ${state.enrollments.length} · Łączne saldo wyników: ${money(total)}`;
  $('#enrollments').innerHTML = visible.length ? visible.map(e => `<div class="entry"><strong>${escape(e.child)}</strong> · ${money(e.balance)}<small>${escape(e.parent)} · ${escape(e.email)}<br>${escape(e.location)} / ${escape(e.group_name)} · ${escape(e.month)}${e.trial_id ? ' · próba' : ''}</small><button class="secondary" data-adjust="${e.id}">Korekta należności</button></div>`).join('') : emptyState('wallet', 'Brak należności', 'Brak należności pasujących do wybranych filtrów.');
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
      const groups=state.groups.filter(candidate=>candidate.location_id===entry.id);
      return `<button class="admin-list-row" data-location-groups="${entry.id}"><span class="list-row-title">${escape(entry.name)}<small>${groups.length} grup</small></span><span class="list-enter">Zobacz grupy →</span></button>`;
    }).join('')||emptyState('location','Brak lokalizacji','','<button class="secondary" data-view="locations">Dodaj lokalizację</button>');
    return;
  }
  if(!group) {
    $('#calendar').innerHTML=state.groups.filter(entry=>entry.location_id===location.id).map(entry=>{
      const trainer=trainersFor(entry.id).map(person=>person.name).join(', ')||'Nie przypisano trenera';
      return `<button class="admin-list-row" data-enter-group="${entry.id}"><span class="list-row-title">${escape(entry.name)}<small>${escape(scheduleLabel(entry))}</small><small>Trener: ${escape(trainer)}</small></span><span class="list-occupancy"><strong>${entry.member_count} / ${entry.capacity}</strong><small>zapisanych zawodników</small></span><span class="list-enter">Wejdź →</span></button>`;
    }).join('')||emptyState('groups','Brak grup','','<button class="secondary" data-open="group-dialog">Dodaj grupę</button>');
    return;
  }
  const sessions=state.sessions.filter(session=>session.group_id===group.id&&session.starts_at.startsWith(month)&&!session.cancelled);
  const active=sessions.filter(session=>!session.excluded);
  const members=state.memberships.filter(member=>member.group_id===group.id);
  $('#calendar').innerHTML=`<div class="admin-group-detail"><div class="group-detail-heading"><div><h2>${escape(group.name)}</h2><p>${escape(scheduleLabel(group))}</p><p>Trener: ${escape(trainersFor(group.id).map(person=>person.name).join(', ')||'Nie przypisano')}</p></div><button class="secondary" data-edit-group="${group.id}">Edytuj ustawienia</button></div><div class="detail-facts"><span><strong>${group.member_count} / ${group.capacity}</strong> zapisanych</span><span><strong>${money(group.price)}</strong> / zajęcia</span><span><strong>${active.length}</strong> zajęć w miesiącu</span><span><strong>${money(active.reduce((sum,session)=>sum+session.price,0))}</strong> za pełny miesiąc</span></div><h3>Zawodnicy</h3><div class="detail-roster">${members.map(member=>rosterRow(state.athletes.find(athlete=>athlete.id===member.athlete_id))).join('')||'<p class="hint">Brak zapisanych zawodników.</p>'}</div><h3>Terminy zajęć</h3><div>${sessions.map(session=>termMarkup(session)).join('')||'<p class="hint">Brak terminów w tym miesiącu.</p>'}</div></div>`;
}

function renderRegistrationGroups() {
  const locationId=Number($('#location').value);
  if(!locationId){$('#available-groups').innerHTML='';return;}
  const groups=state.groups.filter(group=>group.location_id===locationId);
  $('#available-groups').innerHTML=groups.map(group=>{
    const free=Math.max(0,group.capacity-group.member_count);
    const next=state.sessions.find(session=>session.group_id===group.id&&!session.excluded&&session.starts_at>=state.now&&session.starts_at.startsWith(state.now.slice(0,7)));
    const ownMember=state.memberships.some(member=>member.group_id===group.id&&state.athletes.some(athlete=>athlete.id===member.athlete_id));
    const eligible=Boolean(next)&&(free>0||ownMember);
    return `<div class="registration-group"><div class="registration-group-main"><h2>${escape(group.name)}</h2><p>${escape(scheduleLabel(group))}</p><p>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ')||'Nie przypisano')}</p>${next?`<p class="hint">Najbliższe zajęcia: ${escape(termLabel(next))}</p>`:''}<p>${money(group.price)} / zajęcia</p></div><div class="registration-group-action"><span class="availability ${free===0?'full':''}">Wolne miejsca: ${free} / ${group.capacity}</span><button class="primary" data-register-group="${group.id}" ${eligible?'':'disabled'}>${!next?'Brak zajęć w tym miesiącu':free===0&&!ownMember?'Brak miejsc':'Zapisz dziecko'}</button></div></div>`;
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
    return `<article class="trainer-card"><div class="avatar">${escape(initials)}</div><h2>${escape(trainer.name)}</h2><span class="pill">${{active:'Aktywny',inactive:'Nieaktywny',archived:'Archiwalny'}[trainer.status]}</span><div class="trainer-contact">${trainer.email ? escape(trainer.email) : 'Nie podano adresu email'}<br>${trainer.phone ? escape(trainer.phone) : 'Nie podano telefonu'}</div><div class="trainer-groups"><p>PRZYPISANE GRUPY · ${groups.length}</p>${groups.map(g => `<button class="trainer-group" data-assign="${g.id}">${escape(g.location)} / ${escape(g.name)}</button>`).join('') || '<p class="hint">Przypisz trenera z karty grupy w dziale „Grupy”.</p>'}</div><div class="trainer-actions"><button class="secondary" data-edit-trainer="${trainer.id}">Edytuj</button>${trainer.status==='active'&&!trainer.account_active?`<button class="secondary" data-trainer-account="${trainer.id}">${trainer.user_id?'Nowy link aktywacyjny':'Utwórz konto'}</button>`:''}</div><p class="hint">${trainer.user_id?(trainer.account_active?'Konto aktywowane':'Konto czeka na aktywację'):'Brak konta logowania'}</p></article>`;
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
    const result = await api(body.id ? 'groups/update' : 'groups', { ...body, id: body.id ? Number(body.id) : undefined, location_id: Number($('#group-location').value), price: Math.round(Number(body.price) * 100), trial_price: Math.round(Number(body.trial_price) * 100), capacity: Number(body.capacity), trials: body.trials === 'on', weekday: Number(body.weekday), trainer_ids: selectedIds('#new-group-trainers') });
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
    notice(`Zapis potwierdzony. Należność: ${money(result.amount)}.`);
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
    for (const key of ['name','location_id','capacity','price','trial_price','start_date','end_date','start_time','end_time','weekday']) {
      if (group[key] !== null) form.elements[key].value = ['price','trial_price'].includes(key) ? group[key] / 100 : group[key];
    }
    form.elements.trials.checked = Boolean(group.trials);
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

function openRoster(groupId) {
  const group = state.groups.find(entry => entry.id === groupId);
  const members = state.memberships.filter(member => member.group_id === groupId);
  $('#roster-title').textContent = `${group.name} · ${members.length} / ${group.capacity}`;
  $('#group-roster').innerHTML = `<p class="hint">${escape(group.location)}</p>` + (members.map(member => {
    const athlete = state.athletes.find(entry => entry.id === member.athlete_id);
    return rosterRow(athlete) + (member.status === 'trial' ? '<span class="pill">Zapis próbny</span>' : '');
  }).join('') || '<p>W tej grupie nie ma jeszcze zapisanych zawodników.</p>');
  openDialog('roster-dialog');
}

function renderAthletes() {
  updateDirectoryFilters('athlete');
  const search = $('#athlete-search').value.trim().toLocaleLowerCase('pl');
  const location = $('#athlete-filter-location').value, group = $('#athlete-filter-group').value;
  const status = $('#athlete-filter-status').value;
  const matches = state.athletes.filter(athlete => {
    const parent = state.parents.find(entry => entry.id === athlete.parent_id);
    const memberships = state.memberships.filter(member => member.athlete_id === athlete.id);
    const membershipMatches = memberships.some(member => {
      const assignedGroup = state.groups.find(entry=>entry.id===member.group_id);
      return (!location || String(assignedGroup?.location_id) === location)
        && (!group || String(member.group_id) === group)
        && (!status || member.status === status);
    });
    return [athlete.name, parent?.name, parent?.email,...parentsFor(athlete.id).flatMap(parent=>[parent.name,parent.email,parent.phone])].join(' ').toLocaleLowerCase('pl').includes(search)
      && (status === 'none' ? memberships.length === 0 && !location && !group : (!location && !group && !status) || membershipMatches);
  }).sort((a,b)=>a.name.localeCompare(b.name,'pl') || a.id-b.id);
  const visible = directorySlice('athlete',matches);
  $('#athlete-list').innerHTML = `<p class="athlete-count">Liczba zawodników: ${matches.length} z ${state.athletes.length}</p>` + (visible.length
    ? `<div class="athlete-directory">${visible.map(rosterRow).join('')}</div>`
    : emptyState('users','Brak zawodników','Brak zawodników pasujących do wybranych filtrów.'));
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
  const balance = charges.reduce((total,charge)=>total+charge.balance,0);
  const outstanding = Math.max(0,balance);
  const credit = Math.max(0,-balance);
  const olderCharges = charges.filter(charge=>charge.month<state.now.slice(0,7)).reduce((total,charge)=>total+charge.balance,0);
  const previousDue = Math.max(0,Math.min(outstanding,olderCharges));
  const tabs = [['data','Dane'],['groups','Grupy'],['parent','Opiekunowie'],['finances','Rozliczenia']];
  $('#athlete-detail-title').textContent = athlete.name;
  $('#athlete-detail').innerHTML = `
    <div class="athlete-tabs" role="tablist" aria-label="Kartoteka zawodnika">${tabs.map(([key,label],index)=>`<button type="button" role="tab" id="athlete-tab-${key}" aria-controls="athlete-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}" data-athlete-tab="${key}">${label}</button>`).join('')}</div>
    <section role="tabpanel" id="athlete-panel-data" aria-labelledby="athlete-tab-data" tabindex="0">
      <dl class="athlete-fields"><div><dt>Imię i nazwisko</dt><dd>${escape(athlete.name)}</dd></div><div><dt>Data urodzenia</dt><dd>${escape(athlete.birth_date||'Nie podano')}</dd></div>${admin?`<div class="athlete-note"><dt>Notatka administracyjna</dt><dd>${escape(athlete.notes||'Brak notatki')}</dd></div>`:''}</dl>
      <button class="secondary" data-edit-athlete="${id}">Edytuj dane</button>
      ${admin?(state.trainer_notes||[]).filter(note=>note.athlete_id===id).map(note=>`<div class="profile-group"><h3>Notatka trenera · ${escape(state.trainers.find(trainer=>trainer.id===note.trainer_id)?.name||'Trener')}</h3><p class="coach-note-body">${escape(note.body||'Brak notatki')}</p></div>`).join(''):''}
    </section>
    <section role="tabpanel" id="athlete-panel-groups" aria-labelledby="athlete-tab-groups" tabindex="0" hidden>
      <div class="profile-section-heading"><h3>Przypisane grupy</h3><button class="secondary" data-enroll-athlete="${id}">Zapisz do grupy</button></div>
      ${memberships.map(member=>{
        const group=state.groups.find(entry=>entry.id===member.group_id);
        return `<div class="profile-group"><h3>${escape(group.name)}</h3><p>${escape(group.location)}</p><p>${escape(scheduleLabel(group))}</p><p>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ')||'Nie przypisano')}</p><span class="pill">${member.status==='trial'?'Zapis próbny':'Zapis stały'}</span><small>Od ${escape(member.joined_at.slice(0,10))}</small></div>`;
      }).join('')||'<p class="hint">Zawodnik nie jest jeszcze przypisany do grupy.</p>'}
    </section>
    <section role="tabpanel" id="athlete-panel-parent" aria-labelledby="athlete-tab-parent" tabindex="0" hidden>
      <dl class="athlete-fields"><div><dt>Rodzic</dt><dd>${escape(parent?.name||'Nie podano')}</dd></div><div><dt>Email</dt><dd>${escape(parent?.email||'Nie podano')}</dd></div><div><dt>Telefon</dt><dd>${escape(parent?.phone||'Nie podano')}</dd></div><div><dt>Konto rodzica</dt><dd>${parent?.access_status==='blocked'?'Zablokowane':parentActive?'Aktywne':'Oczekuje na aktywację'}</dd></div></dl>
      ${admin&&parent?.access_status!=='blocked'&&!parentActive?`<button class="secondary" data-invite="${athlete.parent_id}">Utwórz link aktywacyjny</button>`:''}
      ${admin?`<button class="secondary" data-parent-access="${athlete.parent_id}" data-access-status="${parent?.access_status==='blocked'?'active':'blocked'}" data-profile="${id}">${parent?.access_status==='blocked'?'Odblokuj konto rodzica':'Zablokuj konto rodzica'}</button>`:''}
      ${(state.guardian_links||[]).filter(link=>link.athlete_id===id&&!link.primary_guardian).map(link=>{
        const guardian=state.parents.find(parent=>parent.id===link.user_id);
        return `<div class="entry"><strong>${escape(guardian?.name||'Opiekun')}</strong><small>${escape(guardian?.email||'')} · ${escape(guardian?.phone||'Brak telefonu')} · ${guardian?.access_status==='blocked'?'Zablokowane':'Dostęp potwierdzony'}</small>${admin||athlete.parent_id===state.user.id||link.user_id===state.user.id?`<button class="secondary" data-revoke-guardian="${link.user_id}" data-child="${id}">Cofnij dostęp do dziecka</button>`:''}${admin?`<button class="secondary" data-parent-access="${link.user_id}" data-access-status="${guardian?.access_status==='blocked'?'active':'blocked'}" data-profile="${id}">${guardian?.access_status==='blocked'?'Odblokuj konto rodzica':'Zablokuj konto rodzica'}</button>`:''}</div>`;
      }).join('')}
      ${(state.guardian_invitations||[]).filter(invitation=>invitation.athlete_id===id).map(invitation=>`<div class="entry"><strong>${escape(invitation.email)}</strong><small>Oczekuje na przyjęcie zaproszenia</small>${admin||athlete.parent_id===state.user.id||invitation.invited_by===state.user.id?`<button class="secondary" data-cancel-guardian="${invitation.id}" data-child="${id}">Cofnij zaproszenie</button>`:''}</div>`).join('')}
      <div class="trainer-actions"><button class="secondary" data-invite-guardian="${id}">Zaproś kolejnego opiekuna</button></div>
    </section>
    <section role="tabpanel" id="athlete-panel-finances" aria-labelledby="athlete-tab-finances" tabindex="0" hidden>
      <div class="athlete-finance-summary"><div><span>Do zapłaty</span><strong>${money(outstanding)}</strong></div><div><span>Nadpłata</span><strong>${money(credit)}</strong></div><div><span>Z poprzednich miesięcy</span><strong>${money(previousDue)}</strong></div></div>
      <p class="hint">Saldo naliczeń: ${money(balance)}. Kwota dodatnia oznacza należność, ujemna — nadpłatę. Płatności online nie są jeszcze podłączone.</p>
      <h3 class="profile-ledger-title">Historia rozliczeń</h3>
      ${charges.map(charge=>`<div class="entry"><div class="profile-charge-heading"><strong>${escape(charge.month)} · ${escape(charge.group_name)}</strong><strong>${money(charge.balance)}</strong></div><small>${escape(charge.location)} · naliczono ${money(charge.amount)}</small>${state.adjustments.filter(adjustment=>adjustment.enrollment_id===charge.id).map(adjustment=>`<small>${escape(adjustment.created_at.slice(0,10))} · ${money(adjustment.amount)} · ${escape(adjustment.reason)}</small>`).join('')}</div>`).join('')||'<p class="hint">Brak naliczeń.</p>'}
    </section>`;
  openDialog('athlete-detail-dialog');
}

function selectAthleteTab(key,focus=false) {
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
    const balance = state.enrollments.filter(enrollment => enrollment.athlete_id === athlete.id).reduce((sum,enrollment)=>sum+enrollment.balance,0);
    return `<article class="section-card child-card"><h2>${escape(athlete.name)}</h2><p class="hint">Należności: ${money(balance)} · płatności online w późniejszym etapie</p>${memberships.map(member=>{
      const group=state.groups.find(entry=>entry.id===member.group_id);
      const terms=state.sessions.filter(session=>session.group_id===group.id&&session.starts_at>=state.now&&(!session.cancelled||member.trial_id===session.id)&&(!member.trial_id||session.id===member.trial_id)).slice(0,6);
      return `<div class="child-group"><h3>${escape(group.location)} / ${escape(group.name)}</h3><p class="hint">${member.status==='trial'?'Zajęcia próbne':'Zapis stały'}${group.start_time?' · '+escape(group.start_time)+'–'+escape(group.end_time):''}</p><p class="hint">Najbliższe terminy:</p>${terms.map(session=>termMarkup(session)).join('')||'<p class="hint">Brak przyszłych terminów.</p>'}</div>`;
    }).join('')||'<p>Dziecko nie jest jeszcze przypisane do grupy. Wybierz zajęcia w zakładce „Zapisy na zajęcia”.</p>'}<button class="secondary" data-athlete="${athlete.id}">Kartoteka i rozliczenia</button></article>`;
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
    if (event.target.id === `${prefix}-filter-location`) $(`#${prefix}-filter-group`).value = '';
    if (prefix === 'athlete' && event.target.value === 'none') {
      $('#athlete-filter-location').value = ''; $('#athlete-filter-group').value = '';
    } else if (prefix === 'athlete' && ['athlete-filter-location','athlete-filter-group'].includes(event.target.id) && $('#athlete-filter-status').value === 'none') $('#athlete-filter-status').value = '';
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
  window.location.hash=authInfo.user.role==='admin'?'groups':authInfo.user.role==='trainer'?'coach':'children';
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
