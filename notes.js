const STORAGE_KEY = 'clientNotesData';
const notesForm = document.getElementById('notes-form');
const notesListAU = document.getElementById('notes-list-au');
const notesListSEA = document.getElementById('notes-list-sea');
const notesCount = document.getElementById('notes-count');
const savedCount = document.getElementById('notes-saved-count');
const noteDateInput = document.getElementById('note-date');
const addNoteBtn = document.getElementById('add-note-btn');
const noteModal = document.getElementById('note-modal');
const noteModalClose = document.getElementById('note-modal-close');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadNotes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Unable to parse stored notes', e);
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function formatDate(value) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderNotes() {
  const notes = loadNotes();
  const total = notes.length;

  notesCount.textContent = `${total} ${total === 1 ? 'note' : 'notes'}`;
  savedCount.textContent = total;

  const auNotes = notes.filter((n) => (n.region || '').toUpperCase() === 'AU');
  const seaNotes = notes.filter((n) => (n.region || '').toUpperCase() === 'SEA');
  const otherNotes = notes.filter((n) => {
    const r = (n.region || '').toUpperCase();
    return r !== 'AU' && r !== 'SEA';
  });

  function compareByCsmThenDate(a, b) {
    const ca = (a.csm || '').toLowerCase();
    const cb = (b.csm || '').toLowerCase();
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return db - da;
  }

  const renderList = (list, container) => {
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">No notes</div>';
      return;
    }
    container.innerHTML = list.slice().sort(compareByCsmThenDate).map((note) => `
      <article class="note-card">
        <div class="note-header">
          <div>
            <h4>${escapeHtml(note.clientName)}</h4>
            <p>${escapeHtml(note.csm || 'CSM unassigned')} | ${escapeHtml(note.region || 'Region unassigned')}</p>
          </div>
        </div>
        <p class="note-body">${escapeHtml(note.content)}</p>
        <div class="note-footer">
          <span>${escapeHtml(formatDate(note.date))}</span>
          <button type="button" class="delete-btn" data-note-id="${note.id}">Delete</button>
        </div>
      </article>
    `).join('');
  };

  renderList(auNotes, notesListAU);
  renderList(seaNotes.concat(otherNotes), notesListSEA);
}

function openNoteModal() {
  noteModal.classList.remove('hidden');
}

function closeNoteModal() {
  noteModal.classList.add('hidden');
  notesForm.reset();
  noteDateInput.value = new Date().toISOString().slice(0, 10);
}

addNoteBtn.addEventListener('click', openNoteModal);
noteModalClose.addEventListener('click', closeNoteModal);
noteModal.addEventListener('click', (event) => {
  if (event.target === noteModal) closeNoteModal();
});

notesForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const note = {
    id: crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`,
    clientName: document.getElementById('client-name').value.trim(),
    csm: document.getElementById('note-csm').value.trim(),
    region: document.getElementById('note-region').value.trim(),
    content: document.getElementById('note-content').value.trim(),
    date: noteDateInput.value || new Date().toISOString().slice(0, 10)
  };

  if (!note.clientName || !note.csm || !note.region || !note.content) return;

  const notes = loadNotes();
  const existingNoteIndex = notes.findIndex((existingNote) =>
    existingNote.clientName.trim().toLowerCase() === note.clientName.toLowerCase()
  );

  if (existingNoteIndex >= 0) {
    const existingNote = notes[existingNoteIndex];
    const existingDate = existingNote.date ? new Date(existingNote.date) : new Date(0);
    const incomingDate = new Date(note.date);

    if (!Number.isNaN(incomingDate.getTime()) && !Number.isNaN(existingDate.getTime()) && incomingDate >= existingDate) {
      notes[existingNoteIndex] = { ...note, id: existingNote.id };
    } else {
      notes.push(note);
    }
  } else {
    notes.push(note);
  }

  saveNotes(notes);
  closeNoteModal();
  renderNotes();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const notes = loadNotes().filter((note) => note.id !== button.dataset.noteId);
  saveNotes(notes);
  renderNotes();
});

noteDateInput.value = new Date().toISOString().slice(0, 10);
renderNotes();
