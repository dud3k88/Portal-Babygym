let state;
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayNames = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const viewNames = { groups: 'Grupy', locations: 'Lokalizacje', 'days-off': 'Dni wolne', trainers: 'Trenerzy', billing: 'Rozliczenia', settings: 'Wygląd', parent: 'Zapisy na zajęcia' };
let toastTimer;

async function api(path, body) {
  const response = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}

function notice(message, error = false) {
  for (const element of [$('#notice'), $('#toast')]) {
    element.textContent = message;
    element.hidden = false;
    element.classList.toggle('error', error);
  }
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    let feedback = dialog.querySelector('.form-message');
    if (!feedback) {
      feedback = document.createElement('p');
      feedback.className = 'form-message';
      feedback.setAttribute('role', 'alert');
      dialog.querySelector('form').prepend(feedback);
    }
    feedback.textContent = message;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

function switchView(view) {
  if (!viewNames[view]) view = 'groups';
  for (const section of document.querySelectorAll('main > .page')) section.hidden = section.id !== view;
  for (const button of document.querySelectorAll('nav [data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = viewNames[view];
  $('.workspace-label').innerHTML = '<span class="workspace-dot"></span> ' + (view === 'parent' ? 'Panel rodzica' : 'Panel administratora');
  $('#notice').hidden = true;
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.querySelector('.form-message')?.remove();
  dialog.showModal();
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
  return { ...body, group_id: Number(body.group_id), trial_id: body.trial_id ? Number(body.trial_id) : null };
}

async function refresh() {
  state = await api('state');
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
  const selected = selectedIds('#new-group-trainers');
  $('#new-group-trainers').innerHTML = trainerCheckboxes(selected) || '<p class="hint">Nie dodano jeszcze trenerów. Grupę możesz na razie utworzyć bez prowadzącego.</p>';
  $('#brand-logo').hidden = !state.logo;
  $('#brand-fallback').hidden = Boolean(state.logo);
  if (state.logo) $('#brand-logo').src = state.logo;
}

function updateGroups() {
  const previous = $('#group').value;
  $('#group').innerHTML = '<option value="">Wybierz grupę</option>' + state.groups.filter(g => g.location_id === Number($('#location').value)).map(g => `<option value="${g.id}">${escape(g.name)}</option>`).join('');
  $('#group').value = previous;
  updateTrials();
}

function updateTrials() {
  const group = state.groups.find(g => g.id === Number($('#group').value));
  const previous = $('#trial').value;
  const month = $('[name="month"]').value;
  $('#trial').innerHTML = '<option value="">Zapis stały</option>' + (group?.trials ? state.sessions.filter(s => s.group_id === group.id && s.starts_at.startsWith(month) && s.starts_at >= state.now && !s.excluded).map(s => `<option value="${s.id}">Próba ${escape(termLabel(s))} · ${money(group.trial_price)}</option>`).join('') : '');
  $('#trial').value = previous;
  if (!$('#trial').value) $('#trial').value = '';
  $('#group-info').textContent = group ? `${money(group.price)} / zajęcia · limit ${group.capacity} miejsc · czas polski` : '';
  renderMonthlySessions();
  updateQuote();
}

let quoteVersion = 0;
async function updateQuote() {
  const version = ++quoteVersion;
  if (!$('#group').value) { $('#quote').textContent = 'Wybierz grupę i miesiąc'; return; }
  try {
    const quote = await api('quote', enrollmentBody());
    if (version === quoteVersion) $('#quote').textContent = `${quote.count} ${$('#trial').value ? 'zajęcia próbne' : 'zajęcia'} · ${money(quote.amount)}`;
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
  return `<div class="term ${session.excluded ? 'excluded' : ''}">${escape(termLabel(session))}${session.excluded ? ' · dzień wolny' : parent && session.starts_at < state.now ? ' · odbyte' : ''}</div>`;
}

function renderMonthlySessions() {
  const groupId = Number($('#group').value), month = $('[name="month"]').value;
  const sessions = state.sessions.filter(s => s.group_id === groupId && s.starts_at.startsWith(month));
  $('#monthly-sessions').innerHTML = groupId ? sessions.map(s => termMarkup(s, true)).join('') || 'Brak zajęć w wybranym miesiącu.' : '';
}

function renderCalendar() {
  const month = $('#calendar-month').value;
  const stats = [
    ['Grupy zajęciowe', state.groups.length, 'Wszystkie utworzone grupy', 'groups'],
    ['Lokalizacje', state.locations.length, 'Przedszkola i miejsca zajęć', 'location'],
    ['Trenerzy', state.trainers.length, 'Prowadzący w Twoim zespole', 'users']
  ];
  $('#group-stats').innerHTML = stats.map(([label, count, description, icon]) => `<div class="stat"><span class="stat-label">${label}</span><strong>${count}</strong><small>${description}</small><span class="stat-icon"><svg aria-hidden="true"><use href="#i-${icon}"/></svg></span></div>`).join('');
  $('#calendar').innerHTML = state.groups.map(group => {
    const sessions = state.sessions.filter(s => s.group_id === group.id && s.starts_at.startsWith(month));
    const active = sessions.filter(s => !s.excluded);
    const trainers = trainersFor(group.id);
    const schedule = group.weekday !== null ? `${dayNames[group.weekday]} · ${group.start_time}–${group.end_time}` : 'Grafik z poprzedniej wersji';
    return `<div class="group-card"><div class="group-card-top"><p class="group-location">${escape(group.location)}</p><div class="group-title"><h3>${escape(group.name)}</h3><span class="pill">${group.capacity} miejsc</span></div><p class="group-schedule">${escape(schedule)}<br>${money(group.price)} / zajęcia</p><div class="group-metrics"><div><strong>${active.length} zajęć</strong><span>W WYBRANYM MIESIĄCU</span></div><div><strong>${money(active.reduce((sum, s) => sum + s.price, 0))}</strong><span>ZA PEŁNY MIESIĄC</span></div></div><div class="group-trainers"><span>${trainers.length ? escape(trainers.map(t => t.name).join(', ')) : 'Brak przypisanego trenera'}</span><button class="tertiary" data-assign="${group.id}">${trainers.length ? 'Zmień trenerów' : 'Przypisz trenera'}</button></div></div><details><summary>Terminy zajęć (${sessions.length})</summary><div class="session-list">${sessions.map(s => termMarkup(s)).join('') || '<p class="hint">Brak terminów w tym miesiącu.</p>'}</div></details></div>`;
  }).join('') || emptyState('groups', 'Zacznij od pierwszej grupy', 'Dodaj lokalizację, grafik i stawkę. System sam utworzy terminy zajęć.', '<button class="secondary" data-open="group-dialog">Dodaj grupę</button>');
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
  if (button.dataset.open) openDialog(button.dataset.open);
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
  if (button.dataset.assign) openAssignment(Number(button.dataset.assign));
});
window.addEventListener('hashchange', () => switchView(window.location.hash.slice(1)));
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
    const result = await api('groups', { ...body, location_id: Number(body.location_id), price: Math.round(Number(body.price) * 100), trial_price: Math.round(Number(body.trial_price) * 100), capacity: Number(body.capacity), trials: body.trials === 'on', weekday: Number(body.weekday), trainer_ids: selectedIds('#new-group-trainers') });
    form.reset();
    $('#group-dialog').close();
    await refresh();
    notice(`Grupa zapisana. Automatycznie utworzono ${result.count} terminów.`);
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
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('enrollments', enrollmentBody());
    await refresh();
    notice(`Zapis potwierdzony. Należność: ${money(result.amount)}. Płatności online nie są jeszcze podłączone.`);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
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
refresh().catch(error => notice(error.message, true));
