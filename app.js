'use strict';

/* ============================================================
   Parsiras – Hüttenreservation  |  app.js
   ============================================================ */

const CONFIG_KEY   = 'parsiras_config';
const ERFASSER_KEY = 'parsiras_erfasser';

// ── Global State ──────────────────────────────────────────────
const state = {
  config:         null,
  data:           { bookings: [], notes: [] },
  dataSha:        null,
  year:           new Date().getFullYear(),
  month:          new Date().getMonth(),
  editBooking:    null,
  editNote:       null,
};

// ── GitHub API ────────────────────────────────────────────────
const GitHub = {
  async request(method, path, body = null) {
    const { token, owner, repo } = state.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    };
    const opts = { method, headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let msg = `GitHub-Fehler ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  },

  decode(content) {
    return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, '')))));
  },

  encode(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
  },

  async readData() {
    const r = await this.request('GET', 'data/data.json');
    if (!r) return null;
    state.dataSha = r.sha;
    return this.decode(r.content);
  },

  async writeData(data) {
    const body = {
      message: `Parsiras: Update ${new Date().toISOString().slice(0, 10)}`,
      content:  this.encode(data),
    };
    if (state.dataSha) body.sha = state.dataSha;
    const r = await this.request('PUT', 'data/data.json', body);
    state.dataSha  = r.content.sha;
    state.data     = data;
  },

  async load() {
    const data = await this.readData();
    if (data) {
      state.data = data;
      return;
    }
    // First run: create the data file in the repo
    await this.writeData({ bookings: [], notes: [] });
  },

  async testConnection() {
    const { token, owner, repo } = state.config;
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw new Error(`Repository nicht gefunden oder kein Zugriff (${res.status})`);
  },
};

// ── Helpers ───────────────────────────────────────────────────
function fmtIso(date)    { return date.toISOString().slice(0, 10); }
function todayStr()      { return fmtIso(new Date()); }
function getErfasser()   { return localStorage.getItem(ERFASSER_KEY) || ''; }

function fmtDisplay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bookingOnDate(iso) {
  return state.data.bookings.find(b => iso >= b.dateFrom && iso <= b.dateTo) || null;
}

function hasConflict(from, to, excludeId = null) {
  return state.data.bookings.some(b => {
    if (excludeId && b.id === excludeId) return false;
    return !(to < b.dateFrom || from > b.dateTo);
  });
}

// ── Loading / Toast ───────────────────────────────────────────
function setLoading(on, text = 'Bitte warten…') {
  const el = document.getElementById('loading');
  el.classList.toggle('hidden', !on);
  if (on) el.querySelector('.loading-text').textContent = text;
}

let toastTimer;
function toast(msg, type = 'info') {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  el.textContent  = msg;
  el.className    = `toast show ${type}`;
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

async function withLoading(fn, text) {
  setLoading(true, text);
  try {
    await fn();
  } catch (e) {
    if (e.message.includes('409') || e.message.toLowerCase().includes('conflict')) {
      toast('Datei wurde parallel geändert – bitte Daten neu laden.', 'error');
    } else {
      toast('Fehler: ' + e.message, 'error');
    }
    throw e;
  } finally {
    setLoading(false);
  }
}

// ── Calendar ──────────────────────────────────────────────────
const MONTHS = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];
const DOW    = ['Mo','Di','Mi','Do','Fr','Sa','So'];

function renderCalendar() {
  const { year, month } = state;
  document.getElementById('cal-header').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  DOW.forEach(d => {
    const el = document.createElement('div');
    el.className   = 'cal-header-cell';
    el.textContent = d;
    grid.appendChild(el);
  });

  const first  = new Date(year, month, 1);
  const offset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell empty';
    grid.appendChild(el);
  }

  const days  = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  for (let d = 1; d <= days; d++) {
    const iso     = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const booking = bookingOnDate(iso);
    const isToday = iso === today;
    const isPast  = iso < today;

    const cell    = document.createElement('div');
    cell.className = ['cal-cell',
      isToday  ? 'today'  : '',
      isPast   ? 'past'   : '',
      booking  ? 'booked' : '',
    ].filter(Boolean).join(' ');

    cell.innerHTML = `<span class="cal-num">${d}</span>`;
    if (booking) {
      const label = booking.beleger.split(' ')[0];
      cell.innerHTML += `<span class="cal-booking-label">${esc(label)}</span>`;
    }

    if (!isPast || booking) {
      cell.addEventListener('click', () => {
        if (booking) openBookingModal(booking);
        else if (!isPast) openBookingModal(null, iso);
      });
    }
    grid.appendChild(cell);
  }
}

// ── Notes ─────────────────────────────────────────────────────
const CAT_ICONS  = { arbeiten: '🔧', einkauf: '🛒', sonstiges: '📝' };
const CAT_LABELS = { arbeiten: 'Arbeiten', einkauf: 'Einkauf', sonstiges: 'Sonstiges' };
const PRI_ORDER  = { hoch: 0, normal: 1, niedrig: 2 };

function renderNotes() {
  const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'alle';
  const list   = document.getElementById('notes-list');
  list.innerHTML = '';

  let notes = state.data.notes || [];
  if (filter !== 'alle') notes = notes.filter(n => n.status === filter);

  const open = [...notes].filter(n => n.status === 'offen')
    .sort((a, b) => (PRI_ORDER[a.prioritaet] || 1) - (PRI_ORDER[b.prioritaet] || 1));
  const done = notes.filter(n => n.status === 'erledigt');

  if (open.length === 0 && done.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>Keine Einträge</p>
      <small>Tippe auf + um einen neuen Eintrag zu erstellen</small>
    </div>`;
    return;
  }

  if (open.length) {
    if (filter === 'alle' && done.length) {
      const sep = document.createElement('div');
      sep.className   = 'notes-group-label';
      sep.textContent = 'Offen';
      list.appendChild(sep);
    }
    open.forEach(n => list.appendChild(buildNoteCard(n)));
  }

  if (done.length) {
    const sep = document.createElement('div');
    sep.className   = 'notes-group-label done-label';
    sep.textContent = 'Erledigt';
    list.appendChild(sep);
    done.forEach(n => list.appendChild(buildNoteCard(n)));
  }
}

function buildNoteCard(note) {
  const el = document.createElement('div');
  el.className = `note-card ${note.kategorie} ${note.status === 'erledigt' ? 'done' : ''}`;

  el.innerHTML = `
    <div class="note-left">
      <button class="note-check ${note.status === 'erledigt' ? 'checked' : ''}"
        data-id="${note.id}" aria-label="Status wechseln">
        ${note.status === 'erledigt' ? '✓' : ''}
      </button>
    </div>
    <div class="note-body" data-id="${note.id}">
      <div class="note-title">
        ${esc(note.titel)}
        ${note.prioritaet === 'hoch' ? '<span class="priority-badge">!</span>' : ''}
      </div>
      ${note.beschreibung
        ? `<div class="note-desc">${esc(note.beschreibung)}</div>` : ''}
      <div class="note-footer">
        <span class="cat-badge cat-${note.kategorie}">
          ${CAT_ICONS[note.kategorie]} ${CAT_LABELS[note.kategorie]}
        </span>
        <span class="note-meta-text">${esc(note.erfasser)}</span>
      </div>
    </div>
  `;

  el.querySelector('.note-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNote(note.id);
  });
  el.querySelector('.note-body').addEventListener('click', () => openNoteModal(note));
  return el;
}

async function toggleNote(id) {
  const note = state.data.notes.find(n => n.id === id);
  if (!note) return;
  note.status = note.status === 'offen' ? 'erledigt' : 'offen';
  note.geaendertAm = new Date().toISOString();
  try {
    await withLoading(() => GitHub.writeData(state.data), 'Speichern…');
    renderNotes();
    toast(note.status === 'erledigt' ? 'Erledigt ✓' : 'Wieder geöffnet', 'success');
  } catch (_) {
    note.status = note.status === 'erledigt' ? 'offen' : 'erledigt'; // rollback
  }
}

// ── Booking Modal ─────────────────────────────────────────────
function openBookingModal(booking = null, defaultDate = null) {
  state.editBooking = booking;
  const today = defaultDate || todayStr();

  document.getElementById('bm-title').textContent   = booking ? 'Reservation bearbeiten' : 'Neue Reservation';
  document.getElementById('bm-date-from').value     = booking?.dateFrom || today;
  document.getElementById('bm-date-to').value       = booking?.dateTo   || today;
  document.getElementById('bm-beleger').value       = booking?.beleger  || '';
  document.getElementById('bm-erfasser').value      = booking?.erfasser || getErfasser();
  document.getElementById('bm-bemerkung').value     = booking?.bemerkung || '';
  document.getElementById('bm-delete').classList.toggle('hidden', !booking);

  document.getElementById('booking-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('bm-beleger').focus(), 100);
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  state.editBooking = null;
}

async function submitBooking(e) {
  e.preventDefault();
  const dateFrom  = document.getElementById('bm-date-from').value;
  const dateTo    = document.getElementById('bm-date-to').value;
  const beleger   = document.getElementById('bm-beleger').value.trim();
  const erfasser  = document.getElementById('bm-erfasser').value.trim();
  const bemerkung = document.getElementById('bm-bemerkung').value.trim();

  if (!dateFrom || !dateTo || !beleger || !erfasser) {
    toast('Bitte alle Pflichtfelder ausfüllen', 'error'); return;
  }
  if (dateTo < dateFrom) {
    toast('Enddatum muss nach dem Startdatum liegen', 'error'); return;
  }
  if (hasConflict(dateFrom, dateTo, state.editBooking?.id)) {
    toast('Diese Daten überschneiden sich mit einer bestehenden Reservation!', 'error'); return;
  }

  const booking = {
    id:          state.editBooking?.id || uid('bk_'),
    dateFrom,
    dateTo,
    beleger,
    erfasser,
    bemerkung,
    erfasstAm:   state.editBooking?.erfasstAm   || new Date().toISOString(),
    geaendertAm: new Date().toISOString(),
  };

  try {
    await withLoading(async () => {
      const data = structuredClone(state.data);
      const idx  = data.bookings.findIndex(b => b.id === booking.id);
      if (idx >= 0) data.bookings[idx] = booking;
      else          data.bookings.push(booking);
      await GitHub.writeData(data);
    }, 'Speichern…');
    closeBookingModal();
    renderCalendar();
    toast('Reservation gespeichert', 'success');
  } catch (_) {}
}

async function deleteBooking() {
  if (!state.editBooking) return;
  if (!confirm(`Reservation von ${state.editBooking.beleger} wirklich löschen?`)) return;
  try {
    await withLoading(async () => {
      const data = structuredClone(state.data);
      data.bookings = data.bookings.filter(b => b.id !== state.editBooking.id);
      await GitHub.writeData(data);
    }, 'Löschen…');
    closeBookingModal();
    renderCalendar();
    toast('Reservation gelöscht', 'success');
  } catch (_) {}
}

// ── Note Modal ────────────────────────────────────────────────
function openNoteModal(note = null) {
  state.editNote = note;

  document.getElementById('nm-title').textContent   = note ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  document.getElementById('nm-titel').value         = note?.titel       || '';
  document.getElementById('nm-beschreibung').value  = note?.beschreibung || '';
  document.getElementById('nm-erfasser').value      = note?.erfasser    || getErfasser();
  document.getElementById('nm-delete').classList.toggle('hidden', !note);

  // Segment controls
  ['arbeiten','einkauf','sonstiges'].forEach(v => {
    document.getElementById(`nm-kat-${v}`).checked = (note?.kategorie || 'arbeiten') === v;
  });
  ['hoch','normal','niedrig'].forEach(v => {
    document.getElementById(`nm-pri-${v}`).checked = (note?.prioritaet || 'normal') === v;
  });

  document.getElementById('note-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('nm-titel').focus(), 100);
}

function closeNoteModal() {
  document.getElementById('note-modal').classList.add('hidden');
  state.editNote = null;
}

async function submitNote(e) {
  e.preventDefault();
  const titel        = document.getElementById('nm-titel').value.trim();
  const beschreibung = document.getElementById('nm-beschreibung').value.trim();
  const erfasser     = document.getElementById('nm-erfasser').value.trim();
  const kategorie    = document.querySelector('input[name="nm-kat"]:checked')?.value   || 'arbeiten';
  const prioritaet   = document.querySelector('input[name="nm-pri"]:checked')?.value  || 'normal';

  if (!titel || !erfasser) { toast('Bitte Titel und Erfasser ausfüllen', 'error'); return; }

  const note = {
    id:          state.editNote?.id || uid('nt_'),
    titel,
    beschreibung,
    kategorie,
    prioritaet,
    erfasser,
    status:      state.editNote?.status || 'offen',
    erfasstAm:   state.editNote?.erfasstAm   || new Date().toISOString(),
    geaendertAm: new Date().toISOString(),
  };

  try {
    await withLoading(async () => {
      const data = structuredClone(state.data);
      const idx  = data.notes.findIndex(n => n.id === note.id);
      if (idx >= 0) data.notes[idx] = note;
      else          data.notes.push(note);
      await GitHub.writeData(data);
    }, 'Speichern…');
    closeNoteModal();
    renderNotes();
    toast('Eintrag gespeichert', 'success');
  } catch (_) {}
}

async function deleteNote() {
  if (!state.editNote) return;
  if (!confirm(`Eintrag "${state.editNote.titel}" wirklich löschen?`)) return;
  try {
    await withLoading(async () => {
      const data = structuredClone(state.data);
      data.notes = data.notes.filter(n => n.id !== state.editNote.id);
      await GitHub.writeData(data);
    }, 'Löschen…');
    closeNoteModal();
    renderNotes();
    toast('Eintrag gelöscht', 'success');
  } catch (_) {}
}

// ── Settings ──────────────────────────────────────────────────
function renderSettings() {
  const cfg = state.config;
  document.getElementById('s-owner').textContent    = cfg?.owner   || '–';
  document.getElementById('s-repo').textContent     = cfg?.repo    || '–';
  document.getElementById('s-erfasser').textContent = getErfasser() || '–';

  // Upcoming bookings list
  renderUpcoming();
}

function renderUpcoming() {
  const list  = document.getElementById('upcoming-list');
  const today = todayStr();
  const upcoming = (state.data.bookings || [])
    .filter(b => b.dateTo >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
    .slice(0, 8);

  list.innerHTML = '';
  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px 0"><p>Keine bevorstehenden Reservationen</p></div>';
    return;
  }
  upcoming.forEach(b => {
    const el = document.createElement('div');
    el.className  = 'booking-item';
    el.innerHTML  = `
      <div class="booking-item-dates">${fmtDisplay(b.dateFrom)} – ${fmtDisplay(b.dateTo)}</div>
      <div class="booking-item-name">${esc(b.beleger)}</div>
      ${b.bemerkung ? `<div class="booking-item-meta">${esc(b.bemerkung)}</div>` : ''}
      <div class="booking-item-meta">Erfasst von ${esc(b.erfasser)}</div>
    `;
    el.addEventListener('click', () => {
      switchTab('calendar');
      state.year  = parseInt(b.dateFrom.slice(0,4));
      state.month = parseInt(b.dateFrom.slice(5,7)) - 1;
      renderCalendar();
    });
    list.appendChild(el);
  });
}

// ── Tab navigation ────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');

  document.getElementById('fab-booking').classList.toggle('hidden', tab !== 'calendar');
  document.getElementById('fab-note').classList.toggle('hidden',    tab !== 'notes');

  if (tab === 'calendar') renderCalendar();
  if (tab === 'notes')    renderNotes();
  if (tab === 'settings') renderSettings();
}

// ── Setup ─────────────────────────────────────────────────────
async function handleSetup(e) {
  e.preventDefault();
  const owner    = document.getElementById('setup-owner').value.trim();
  const repo     = document.getElementById('setup-repo').value.trim();
  const token    = document.getElementById('setup-token').value.trim();
  const erfasser = document.getElementById('setup-erfasser').value.trim();

  if (!owner || !repo || !token || !erfasser) {
    toast('Bitte alle Felder ausfüllen', 'error'); return;
  }

  state.config = { owner, repo, token };

  try {
    await withLoading(async () => {
      await GitHub.testConnection();
    }, 'Verbindung prüfen…');
  } catch (_) {
    state.config = null; return;
  }

  localStorage.setItem(CONFIG_KEY,   JSON.stringify(state.config));
  localStorage.setItem(ERFASSER_KEY, erfasser);

  startApp();
}

// ── Silent refresh on focus ───────────────────────────────────
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && state.config) {
    try {
      await GitHub.load();
      const active = document.querySelector('.nav-btn.active')?.dataset.tab;
      if (active === 'calendar') renderCalendar();
      if (active === 'notes')    renderNotes();
      if (active === 'settings') renderSettings();
    } catch (_) {}
  }
});

// ── Start ─────────────────────────────────────────────────────
async function startApp() {
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  try {
    await withLoading(() => GitHub.load(), 'Daten laden…');
  } catch (_) {}

  switchTab('calendar');
}

// ── Wire everything up ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Setup
  document.getElementById('setup-form').addEventListener('submit', handleSetup);

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Calendar
  document.getElementById('cal-prev').addEventListener('click', () => {
    if (state.month === 0) { state.month = 11; state.year--; }
    else state.month--;
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    if (state.month === 11) { state.month = 0; state.year++; }
    else state.month++;
    renderCalendar();
  });

  // Booking modal
  document.getElementById('fab-booking').addEventListener('click', () => openBookingModal(null, todayStr()));
  document.getElementById('booking-form').addEventListener('submit', submitBooking);
  document.getElementById('bm-delete').addEventListener('click', deleteBooking);
  document.getElementById('bm-close').addEventListener('click',  closeBookingModal);
  document.getElementById('booking-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('booking-modal')) closeBookingModal();
  });

  // Note modal
  document.getElementById('fab-note').addEventListener('click', () => openNoteModal());
  document.getElementById('note-form').addEventListener('submit', submitNote);
  document.getElementById('nm-delete').addEventListener('click', deleteNote);
  document.getElementById('nm-close').addEventListener('click',  closeNoteModal);
  document.getElementById('note-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('note-modal')) closeNoteModal();
  });

  // Note filters
  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNotes();
    }));

  // Settings actions
  document.getElementById('btn-change-erfasser').addEventListener('click', () => {
    const input = document.getElementById('input-erfasser');
    const name  = input.value.trim();
    if (!name) { toast('Bitte einen Namen eingeben', 'error'); return; }
    localStorage.setItem(ERFASSER_KEY, name);
    input.value = '';
    renderSettings();
    toast('Name gespeichert', 'success');
  });

  document.getElementById('btn-header-refresh').addEventListener('click', async () => {
    try {
      await withLoading(() => GitHub.load(), 'Daten laden…');
      const active = document.querySelector('.nav-btn.active')?.dataset.tab;
      if (active === 'calendar') renderCalendar();
      if (active === 'notes')    renderNotes();
      if (active === 'settings') renderSettings();
      toast('Daten aktualisiert', 'success');
    } catch (_) {}
  });

  document.getElementById('btn-reload').addEventListener('click', async () => {
    try {
      await withLoading(() => GitHub.load(), 'Daten laden…');
      const active = document.querySelector('.nav-btn.active')?.dataset.tab;
      if (active === 'calendar') renderCalendar();
      if (active === 'notes')    renderNotes();
      if (active === 'settings') renderSettings();
      toast('Daten aktualisiert', 'success');
    } catch (_) {}
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Konfiguration zurücksetzen? Du musst die App danach neu einrichten.')) return;
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(ERFASSER_KEY);
    location.reload();
  });

  // Init
  const savedConfig    = localStorage.getItem(CONFIG_KEY);
  const savedErfasser  = localStorage.getItem(ERFASSER_KEY);

  if (savedConfig && savedErfasser) {
    state.config = JSON.parse(savedConfig);
    startApp();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
