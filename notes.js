const STORAGE_KEY = 'clientDashboardClients';
const NOTES_STORE_NAME = 'notes';
const selectedClientStorageKey = 'selectedClientId';

// NOTE: the IndexedDB connection is opened once, in client-state.js, via
// global.openSharedDatabase(). Do not open a separate connection at a
// separate version number here — see the comment in client-state.js for
// why that caused a VersionError that silently broke client switching.

// NOTE: APP_STATE_STORAGE_KEY, loadAppState(), and saveAppState() are
// defined once in client-state.js (loaded before this file) and shared
// via the global scope. Do not redeclare them here — plain <script> tags
// share one global scope, and a duplicate `const` is a fatal SyntaxError
// that silently prevents this entire file from parsing.

let activeClientId = null;
let notesCache = {};
let notesViewVersion = 0;

function getNotesStorageKey(clientId) {
  return `client-notes:${clientId}`;
}

function readClientAppValue(clientId, key, fallback = '') {
  const state = loadAppState();
  const clientState = state[clientId] || {};
  if (clientState[key] !== undefined) {
    return clientState[key];
  }

  const legacyValue = localStorage.getItem(getNotesStorageKey(clientId));
  if (legacyValue !== null) {
    clientState[key] = legacyValue;
    state[clientId] = clientState;
    saveAppState(state);
    return legacyValue;
  }

  return fallback;
}

function writeClientAppValue(clientId, key, value) {
  const state = loadAppState();
  const clientState = state[clientId] || {};
  clientState[key] = value;
  state[clientId] = clientState;
  saveAppState(state);
}

function loadClientsFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Unable to parse saved clients for notes view.', error);
    return [];
  }
}

function getClientNoteRecord(clientId) {
  return new Promise((resolve, reject) => {
    openSharedDatabase().then((db) => {
      const transaction = db.transaction(NOTES_STORE_NAME, 'readonly');
      const request = transaction.objectStore(NOTES_STORE_NAME).get(clientId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
}

function saveClientNoteRecord(clientId, value) {
  return new Promise((resolve, reject) => {
    openSharedDatabase().then((db) => {
      const transaction = db.transaction(NOTES_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(NOTES_STORE_NAME);
      const request = store.put({ clientId, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
}

async function loadClientNotes(clientId) {
  if (!clientId) return '';

  if (notesCache[clientId] !== undefined) {
    return notesCache[clientId];
  }

  const appValue = readClientAppValue(clientId, 'notes', '');
  if (typeof appValue === 'string') {
    notesCache[clientId] = appValue;
    return appValue;
  }

  // A DB read failure here must never propagate up and abort the rest of
  // updateSelectedClientView() — that's what previously caused clicking a
  // client to silently do nothing. Fall back to an empty note instead.
  let value = '';
  try {
    const record = await getClientNoteRecord(clientId);
    value = record && typeof record.value === 'string' ? record.value : '';
  } catch (error) {
    console.warn('Unable to load notes from IndexedDB; falling back to empty.', error);
  }

  notesCache[clientId] = value;
  writeClientAppValue(clientId, 'notes', value);
  return value;
}

async function saveClientNotes(clientId, value) {
  if (!clientId) return;
  notesCache[clientId] = value;
  writeClientAppValue(clientId, 'notes', value); // localStorage copy always succeeds even if IndexedDB is down
  try {
    await saveClientNoteRecord(clientId, value);
  } catch (error) {
    console.warn('Unable to persist notes to IndexedDB (non-fatal, localStorage copy still saved).', error);
  }
}

async function persistCurrentClientNotes(notesInput = document.getElementById('notes-input')) {
  if (!notesInput) return;
  const clientId = notesInput.dataset.clientId || activeClientId;
  if (clientId) {
    await saveClientNotes(clientId, notesInput.value);
  }
}

function renderClientSidebar(clients, selectedClientId) {
  const list = document.getElementById('client-sidebar-list');
  const count = document.getElementById('client-count');

  if (count) {
    count.textContent = clients.length;
  }

  if (!list) return;

  if (!clients.length) {
    list.innerHTML = '<p class="empty-state">No clients yet.</p>';
    return;
  }

  list.innerHTML = '';

  clients.forEach((client) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `client-sidebar-item${client.id === selectedClientId ? ' active' : ''}`;
    button.textContent = client.name;
    button.addEventListener('click', async () => {
      try {
        await persistCurrentClientNotes();
        localStorage.setItem(selectedClientStorageKey, client.id);
        renderClientSidebar(clients, client.id);
        const selectionVersion = await updateSelectedClientView(client, clients);
        if (window.renderChecklistForClient) {
          window.renderChecklistForClient(client.id, selectionVersion);
        }
      } catch (error) {
        // Last line of defense: a failure anywhere in the switch should
        // never leave the click looking like it did nothing. Unlock the
        // textarea so the UI isn't stuck disabled, and surface the error.
        const notesInput = document.getElementById('notes-input');
        if (notesInput) notesInput.disabled = false;
        console.error('Failed to switch client view.', error);
      }
    });
    list.appendChild(button);
  });
}

async function updateSelectedClientView(client, clients) {
  const title = document.getElementById('active-client-title');
  const subtitle = document.getElementById('active-client-subtitle');
  const checklistTitle = document.getElementById('checklist-title');
  const notesTitle = document.getElementById('notes-title');
  const notesInput = document.getElementById('notes-input');

  const selectionVersion = window.clientSelectionGuard ? window.clientSelectionGuard.activate(client ? client.id : null) : 0;
  notesViewVersion += 1;
  const currentViewVersion = notesViewVersion;

  const previousClientId = notesInput?.dataset.clientId || activeClientId || null;
  if (previousClientId && previousClientId !== (client ? client.id : null)) {
    await persistCurrentClientNotes(notesInput);
  }
  activeClientId = client ? client.id : null;

  // Lock the textarea the instant we commit to a new client so no keystroke
  // or blur that fires during the async load below can be saved against
  // the wrong client. It's re-enabled once the correct notes are painted in.
  if (notesInput) {
    notesInput.disabled = true;
  }

  if (title) {
    title.textContent = client ? `${client.name}` : 'Checklist';
  }

  if (subtitle) {
    subtitle.textContent = client
      ? `Review onboarding progress for ${client.name}.`
      : 'Review onboarding progress for the selected client.';
  }

  if (checklistTitle) {
    checklistTitle.textContent = client ? `Client onboarding checklist — ${client.name}` : 'Client onboarding checklist';
  }

  if (notesTitle) {
    notesTitle.textContent = client ? `Notes — ${client.name}` : 'Notes';
  }

  if (notesInput) {
    const loadedNotes = client ? await loadClientNotes(client.id) : '';

    // If a newer switch happened while we were awaiting the load, bail
    // without touching the DOM — the newer call owns the textarea now.
    if (currentViewVersion !== notesViewVersion || activeClientId !== (client ? client.id : null)) {
      return selectionVersion;
    }

    notesInput.dataset.clientId = client ? client.id : '';
    notesInput.value = loadedNotes;
    notesInput.placeholder = client ? `Write your notes for ${client.name}...` : 'Write your notes here...';
    notesInput.disabled = false;
  }

  if (clients.length && client && !clients.some((item) => item.id === client.id)) {
    localStorage.removeItem(selectedClientStorageKey);
  }

  return selectionVersion;
}

async function initializeNotesView() {
  const notesInput = document.getElementById('notes-input');
  const clients = loadClientsFromStorage();
  const storedSelection = localStorage.getItem(selectedClientStorageKey);
  const selectedClient = clients.find((client) => client.id === storedSelection) || clients[0] || null;

  if (selectedClient) {
    localStorage.setItem(selectedClientStorageKey, selectedClient.id);
  }

  renderClientSidebar(clients, selectedClient ? selectedClient.id : null);
  const selectionVersion = await updateSelectedClientView(selectedClient, clients);
  if (selectedClient && window.renderChecklistForClient) {
    window.renderChecklistForClient(selectedClient.id, selectionVersion);
  }

  if (notesInput && notesInput.dataset.bound !== 'true') {
    notesInput.addEventListener('input', async () => {
      // Ignore keystrokes that land while the box is locked mid-switch —
      // they belong to whatever client is about to be painted in, not
      // to dataset.clientId's current stale value.
      if (notesInput.disabled) return;
      const clientId = notesInput.dataset.clientId || activeClientId;
      if (clientId) {
        await saveClientNotes(clientId, notesInput.value);
      }
    });
    notesInput.addEventListener('blur', async () => {
      if (notesInput.disabled) return;
      await persistCurrentClientNotes(notesInput);
    });
    notesInput.dataset.bound = 'true';
  }
}

document.addEventListener('DOMContentLoaded', initializeNotesView);
window.addEventListener('pageshow', initializeNotesView);