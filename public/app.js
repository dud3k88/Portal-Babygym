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
const viewNames = { auth: 'Logowanie', athletes: 'Zawodnicy', groups: 'Grupy', locations: 'Lokalizacje', 'days-off': 'Dni wolne', trainers: 'Trenerzy', billing: 'Rozliczenia', settings: 'Wygląd', parent: 'Zapisy na zajęcia', children: 'Moje dzieci' };
let toastTimer;

async function api(path, body) {
  const response = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/')) { authInfo.user = null; state = null; showAuth(); }
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
  else if (authInfo.user.role === 'parent' && !['parent','children'].includes(view)) view = 'parent';
  else if (!viewNames[view] || view === 'auth') view = 'groups';
  $('nav').hidden = !authInfo.user;
  $('#logout').hidden = !authInfo.user;
  $('#public-registration-link').hidden = authInfo.user?.role !== 'admin';
  $('#account-name').textContent = authInfo.user?.name || '';
  for (const button of document.querySelectorAll('nav [data-view]')) button.hidden = authInfo.user?.role === 'parent' && !['parent','children'].includes(button.dataset.view);
  for (const label of document.querySelectorAll('nav .nav-label')) label.hidden = authInfo.user?.role === 'parent' && !label.classList.contains('second');
  for (const section of document.querySelectorAll('main > .page')) section.hidden = section.id !== view;
  for (const button of document.querySelectorAll('nav [data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = viewNames[view];
  $('nav [data-view="parent"]').innerHTML = '<svg><use href="#i-arrow"/></svg>' + 'Zapisy na zajęcia';
  $('.workspace-label').innerHTML = '<span class="workspace-dot"></span> ' + (!authInfo.user ? 'Evolution Academy' : authInfo.user.role === 'parent' ? 'Panel rodzica' : 'Panel administratora');
  $('#notice').hidden = true;
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
  return state.trainers.map(trainer => `<label class="check"><input type="checkbox" value="${trainer.id}" ${ids.includes(trainer.id) ? 'checked' : ''}>${escape(trainer.name)}</label>`).join('');
}

function updateLocationSelect() {
  const select = $('#group-location');
  const previous = select.value;
  select.innerHTML = '<option value="">Wybierz lokalizację</option>' + state.locations.map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
  select.value = previous;
  $('#group-location-help').innerHTML = state.locations.length
    ? 'Wybierz zapisaną lokalizację. Nowe przedszkola dodasz w dziale „Lokalizacje”.'
    : 'Najpierw dodaj przedszkole w dziale „Lokalizacje”. <button type="button" class="tertiary" data-view="locations">Przejdź do lokalizacji →</button>';
}

function renderLocations() {
  $('#location-list').innerHTML = state.locations.map(location => {
    const groups = state.groups.filter(group => group.location_id === location.id);
    return `<div class="entry exclusion-entry"><div><strong>${escape(location.name)}</strong><small>Liczba grup: ${groups.length}${groups.length ? '<br>' + groups.map(group => escape(group.name)).join(', ') : ' · Możesz już przypisać grupy i zaplanować dni wolne.'}</small></div><button type="button" class="secondary" data-edit-location="${location.id}">Zmień nazwę</button></div>`;
  }).join('') || emptyState('location', 'Dodaj pierwszą lokalizację', 'Zapisz nazwę przedszkola, a następnie wybierz je przy tworzeniu grupy.', '<button type="button" class="secondary" data-new-location>Dodaj lokalizację</button>');
}

function openLocation(id = null) {
  const form = $('#save-location');
  form.reset();
  form.elements.id.value = id || '';
  form.elements.name.value = id ? state.locations.find(location => location.id === id).name : '';
  $('#location-dialog-title').textContent = id ? 'Zmień nazwę lokalizacji' : 'Nowa lokalizacja';
  openDialog('location-dialog');
}

function enrollmentBody() {
  const body = Object.fromEntries(new FormData($('#enroll')));
  return { ...body, athlete_id: Number(body.athlete_id), group_id: Number(body.group_id), trial_id: body.trial_id ? Number(body.trial_id) : null };
}

async function refresh() {
  state = await api('state');
  authInfo.user = state.user;
  const selectedLocation = $('#location').value;
  $('#location').innerHTML = '<option value="">Wybierz lokalizację</option>' + state.locations.filter(location => state.groups.some(group => group.location_id === location.id)).map(location => `<option value="${location.id}">${escape(location.name)}</option>`).join('');
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

function renderAdmin() {
  $('#enrollments').innerHTML = state.enrollments.length ? state.enrollments.map(e => `<div class="entry"><strong>${escape(e.child)}</strong> · ${money(e.balance)}<small>${escape(e.parent)} · ${escape(e.email)}<br>${escape(e.location)} / ${escape(e.group_name)} · ${escape(e.month)}${e.trial_id ? ' · próba' : ''}</small><button class="secondary" data-adjust="${e.id}">Korekta należności</button></div>`).join('') : emptyState('wallet', 'Brak należności', 'Zapisy rodziców i ich należności pojawią się tutaj.');
  $('#history').innerHTML = state.adjustments.map(a => `<div class="entry"><strong>${money(a.amount)}</strong> · zapis #${a.enrollment_id}<br>${escape(a.reason)}<small>${escape(a.created_at.replace('T', ' '))} · administrator testowy</small></div>`).join('') || '<p class="hint">Nie wprowadzono jeszcze żadnych korekt.</p>';
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
    const next=state.sessions.find(session=>session.group_id===group.id&&!session.excluded&&session.starts_at>=state.now);
    const ownMember=state.memberships.some(member=>member.group_id===group.id&&state.athletes.some(athlete=>athlete.id===member.athlete_id));
    const eligible=Boolean(next)&&(free>0||ownMember);
    return `<div class="registration-group"><div class="registration-group-main"><h2>${escape(group.name)}</h2><p>${escape(scheduleLabel(group))}</p><p>Trener: ${escape(trainersFor(group.id).map(trainer=>trainer.name).join(', ')||'Nie przypisano')}</p>${next?`<p class="hint">Najbliższe zajęcia: ${escape(termLabel(next))}</p>`:''}<p>${money(group.price)} / zajęcia</p></div><div class="registration-group-action"><span class="availability ${free===0?'full':''}">Wolne miejsca: ${free} / ${group.capacity}</span><button class="primary" data-register-group="${group.id}" ${eligible?'':'disabled'}>${!next?'Zapisy zakończone':free===0&&!ownMember?'Brak miejsc':'Zapisz dziecko'}</button></div></div>`;
  }).join('')||'<p class="hint">W tej lokalizacji nie ma jeszcze grup.</p>';
}

function openEnrollment(groupId) {
  const group=state.groups.find(entry=>entry.id===groupId);
  $('#group').value=groupId;
  const future=state.sessions.filter(session=>session.group_id===groupId&&!session.excluded&&session.starts_at>=state.now);
  const month=$('[name="month"]').value;
  if(!future.some(session=>session.starts_at.startsWith(month))) $('[name="month"]').value=future[0]?.starts_at.slice(0,7)||state.now.slice(0,7);
  updateTrials();
  openDialog('enrollment-dialog');
}

function renderTrainers() {
  $('#trainer-list').innerHTML = state.trainers.map(trainer => {
    const groups = state.groups.filter(g => state.group_trainers.some(a => a.group_id === g.id && a.trainer_id === trainer.id));
    const initials = trainer.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('');
    return `<article class="trainer-card"><div class="avatar">${escape(initials)}</div><h2>${escape(trainer.name)}</h2><div class="trainer-contact">${trainer.email ? escape(trainer.email) : 'Nie podano adresu email'}<br>${trainer.phone ? escape(trainer.phone) : 'Nie podano telefonu'}</div><div class="trainer-groups"><p>PRZYPISANE GRUPY · ${groups.length}</p>${groups.map(g => `<button class="trainer-group" data-assign="${g.id}">${escape(g.location)} / ${escape(g.name)}</button>`).join('') || '<p class="hint">Przypisz trenera z karty grupy w dziale „Grupy”.</p>'}</div></article>`;
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
  if (button.dataset.open) button.dataset.open === 'group-dialog' ? openGroup() : openDialog(button.dataset.open);
  if (button.dataset.editGroup) openGroup(Number(button.dataset.editGroup));
  if (button.dataset.locationGroups) { selectedGroupLocation=Number(button.dataset.locationGroups); selectedAdminGroup=null; window.location.hash='groups'; renderCalendar(); }
  if (button.hasAttribute('data-back-locations')) {selectedGroupLocation=null;selectedAdminGroup=null;renderCalendar();}
  if(button.hasAttribute('data-back-groups')){selectedAdminGroup=null;renderCalendar();}
  if(button.dataset.enterGroup){selectedAdminGroup=Number(button.dataset.enterGroup);renderCalendar();}
  if(button.dataset.registerGroup)openEnrollment(Number(button.dataset.registerGroup));
  if (button.dataset.roster) openRoster(Number(button.dataset.roster));
  if (button.dataset.athlete) openAthleteDetail(Number(button.dataset.athlete));
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
window.addEventListener('hashchange', () => authInfo.user ? switchView(window.location.hash.slice(1)) : showAuth(authMode));
switchView(window.location.hash.slice(1));

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
    const result = await api(body.id ? 'locations/update' : 'locations', { name: body.name, ...(body.id ? { id: Number(body.id) } : {}) });
    $('#location-dialog').close();
    await refresh();
    $('#group-location').value = result.id;
    notice(body.id ? 'Nazwa lokalizacji została zaktualizowana w całym systemie.' : 'Lokalizacja dodana. Możesz teraz wybrać ją przy tworzeniu grupy.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
};

$('#create-group').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const body = Object.fromEntries(new FormData(form));
  try {
    const result = await api(body.id ? 'groups/update' : 'groups', { ...body, id: body.id ? Number(body.id) : undefined, location_id: Number(body.location_id), price: Math.round(Number(body.price) * 100), trial_price: Math.round(Number(body.trial_price) * 100), capacity: Number(body.capacity), trials: body.trials === 'on', weekday: Number(body.weekday), trainer_ids: selectedIds('#new-group-trainers') });
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
    await api('trainers', Object.fromEntries(new FormData(form)));
    form.reset();
    $('#trainer-dialog').close();
    await refresh();
    notice('Trener dodany. Możesz teraz przypisać go do grup.');
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
  const search = $('#athlete-search').value.trim().toLocaleLowerCase('pl');
  const matches = state.athletes.filter(athlete => {
    const parent = state.parents.find(entry => entry.id === athlete.parent_id);
    return [athlete.name, parent?.name, parent?.email].join(' ').toLocaleLowerCase('pl').includes(search);
  });
  const locations = state.locations.map(location => {
    const groups = state.groups.filter(group => group.location_id === location.id).map(group => {
      const athletes = matches.filter(athlete => state.memberships.some(member => member.group_id === group.id && member.athlete_id === athlete.id));
      return athletes.length ? `<details class="roster-branch" open><summary>${escape(group.name)} <span class="pill">${athletes.length} / ${group.capacity}</span></summary>${athletes.map(rosterRow).join('')}</details>` : '';
    }).join('');
    return groups ? `<details class="location-branch" open><summary>${escape(location.name)}</summary>${groups}</details>` : '';
  }).join('');
  const unassigned = matches.filter(athlete => !state.memberships.some(member => member.athlete_id === athlete.id));
  $('#athlete-list').innerHTML = locations + (unassigned.length ? `<div class="location-branch"><h3>Bez przypisanej grupy</h3>${unassigned.map(rosterRow).join('')}</div>` : '') || emptyState('users','Brak zawodników','Rodzic może założyć konto i dodać dziecko. Możesz też dodać rodzica i zawodnika ręcznie.');
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
  const athlete = state.athletes.find(entry => entry.id === id), parent = state.parents.find(entry => entry.id === athlete.parent_id);
  const memberships = state.memberships.filter(member => member.athlete_id === id);
  const charges = state.enrollments.filter(enrollment => enrollment.athlete_id === id);
  $('#athlete-detail-title').textContent = athlete.name;
  $('#athlete-detail').innerHTML = `<div class="profile-data"><p><b>Data urodzenia</b><br>${escape(athlete.birth_date || 'Nie podano')}</p><p><b>Rodzic</b><br>${escape(parent?.name || '')}<br>${escape(parent?.email || '')}<br>${escape(parent?.phone || '')}</p>${state.user.role === 'admin' ? `<p><b>Notatka administracyjna</b><br>${escape(athlete.notes || 'Brak')}</p>` : ''}</div><button class="secondary" data-edit-athlete="${id}">Edytuj kartotekę</button><button class="secondary" data-enroll-athlete="${id}">Zapisz do grupy</button>${state.user.role === 'admin' && !parent?.active ? `<button class="secondary" data-invite="${athlete.parent_id}">Link aktywacyjny rodzica</button>` : ''}<h3>Przypisane grupy</h3>${memberships.map(member => {
    const group=state.groups.find(entry=>entry.id===member.group_id);
    return `<div class="entry"><strong>${escape(group.location)} / ${escape(group.name)}</strong><small>${member.status==='trial'?'Zapis próbny':'Zapis stały'} · od ${escape(member.joined_at.slice(0,10))}</small></div>`;
  }).join('') || '<p>Nie przypisano do grupy.</p>'}<h3>Historia rozliczeń</h3>${charges.map(charge=>`<div class="entry">${escape(charge.month)} · ${escape(charge.group_name)}<strong> · ${money(charge.balance)}</strong>${state.adjustments.filter(adjustment=>adjustment.enrollment_id===charge.id).map(adjustment=>`<small>${money(adjustment.amount)} · ${escape(adjustment.reason)}</small>`).join('')}</div>`).join('')||'<p>Brak naliczeń.</p>'}`;
  openDialog('athlete-detail-dialog');
}

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
    $('#invitation-link').value = window.location.origin + '/#activate/' + result.token;
    openDialog('invitation-dialog');
  } catch(error) { notice(error.message,true); }
}

$('#athlete-search').oninput = renderAthletes;
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
  authMode = authInfo.needs_setup ? 'setup' : window.location.hash.startsWith('#activate/') ? 'activate' : mode;
  const details={login:['Zaloguj się.','Wejdź do panelu rodzica lub administratora.','Zaloguj się'],register:['Konto rodzica.','Po rejestracji dodasz dziecko i wybierzesz grupę.','Utwórz konto rodzica'],setup:['Pierwsze uruchomienie.','Utwórz konto administratora tej lokalnej instalacji. Rodzice będą rejestrować osobne konta.','Utwórz konto administratora'],activate:['Aktywuj konto.','Ustaw własne hasło do konta przygotowanego przez administratora.','Aktywuj konto']};
  const [title,description,submit]=details[authMode];
  $('#auth-title').textContent=title;
  $('#auth-description').textContent=description;
  $('#auth-submit').textContent=submit;
  for(const id of ['auth-name-label','auth-phone-label']) document.getElementById(id).hidden=!['register','setup'].includes(authMode);
  $('#auth-form [name=name]').required=['register','setup'].includes(authMode);
  const email=$('#auth-form [name=email]');email.closest('label').hidden=authMode==='activate';email.required=authMode!=='activate';
  $('#auth-form [name=password]').autocomplete=authMode==='login'?'current-password':'new-password';
  $('#auth-toggle').hidden=['setup','activate'].includes(authMode);
  $('#auth-toggle').textContent=authMode==='login'?'Nie masz konta? Zarejestruj się jako rodzic':'Masz konto? Zaloguj się';
  $('#auth-error').hidden=true;
  switchView('auth');
}

async function initialize() {
  authInfo=await api('auth/status');
  if(!authInfo.user){showAuth();return;}
  await refresh();
  switchView(window.location.hash.slice(1));
}
$('#auth-toggle').onclick=()=>showAuth(authMode==='login'?'register':'login');
$('#auth-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=$('#auth-submit');button.disabled=true;
  try {
    const body=Object.fromEntries(new FormData(form));
    if(authMode==='activate') body.token=window.location.hash.slice('#activate/'.length);
    await api('auth/'+authMode,body);
    form.reset();authInfo=await api('auth/status');
    await refresh();window.location.hash=authInfo.user.role==='admin'?'groups':'parent';switchView(window.location.hash.slice(1));
  }catch(error){$('#auth-error').textContent=error.message;$('#auth-error').hidden=false;}finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{
  try{await api('auth/logout',{});authInfo.user=null;state=null;for(const id of ['my-children','athlete-list','athlete-detail','group-roster','enrollments','history']) document.getElementById(id).replaceChildren();window.location.hash='auth';showAuth();}catch(error){notice(error.message,true);}
};
