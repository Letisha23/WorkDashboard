const CHECKLIST_STORE_NAME = 'checklists';
const CHECKLIST_STORAGE_PREFIX = 'clientChecklist:';

// NOTE: the IndexedDB connection is opened once, in client-state.js, via
// global.openSharedDatabase(). Do not open a separate connection at a
// separate version number here — see the comment in client-state.js for
// why that caused a VersionError that silently broke client switching.
const CHECKLIST_ITEMS = [
  {
    title: 'Review project brief',
    description: 'Confirm goals, timeline, and deliverables with the client.',
  },
  {
    title: 'Collect brand assets',
    description: 'Gather logos, color palettes, fonts, and imagery from the client.',
  },
  {
    title: 'Schedule kickoff meeting',
    description: 'Align on roles, workflows, and key milestones before work begins.',
  },
  {
    title: 'Confirm launch timeline',
    description: 'Lock the milestone dates and share them with the delivery team.',
  },
];

// NOTE: APP_STATE_STORAGE_KEY, loadAppState(), and saveAppState() are
// defined once in client-state.js (loaded before this file) and shared
// via the global scope. Do not redeclare them here — plain <script> tags
// share one global scope, and a duplicate `const` is a fatal SyntaxError
// that silently prevents this entire file from parsing.

class ChecklistItem {
  constructor({ id, title, description, checked = false }) {
    this.id = id || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.title = title;
    this.description = description;
    this.checked = checked;
  }

  toggle() {
    this.checked = !this.checked;
  }
}

const checklistStateCache = window.checklistStateCache || (window.checklistStateCache = {});

function getChecklistStorageKey(clientId) {
  return `client-checklist:${clientId}`;
}

function readClientChecklistState(clientId) {
  const state = loadAppState();
  const clientState = state[clientId] || {};
  if (Array.isArray(clientState.checklist)) {
    return clientState.checklist;
  }

  const legacyValue = localStorage.getItem(getChecklistStorageKey(clientId));
  if (legacyValue) {
    try {
      const parsed = JSON.parse(legacyValue);
      if (Array.isArray(parsed)) {
        clientState.checklist = parsed;
        state[clientId] = clientState;
        saveAppState(state);
        return parsed;
      }
    } catch (error) {
      console.warn('Unable to parse legacy checklist state.', error);
    }
  }

  return null;
}

function writeClientChecklistState(clientId, checklistState) {
  const state = loadAppState();
  const clientState = state[clientId] || {};
  clientState.checklist = checklistState;
  state[clientId] = clientState;
  saveAppState(state);
}

class ChecklistManager {
  constructor(containerId, items = [], clientId = null) {
    this.container = document.getElementById(containerId);
    this.clientId = clientId;
    this.items = items.map((item) => new ChecklistItem(item));
    this.selectionVersion = window.clientSelectionGuard ? window.clientSelectionGuard.getCurrentVersion() : 0;
    this.loadState();
  }

  // A manager instance is only allowed to touch the DOM / caches if no
  // newer client selection has happened since it was created. This is
  // checked against the shared selection guard's version counter, and
  // as a second line of defense, against the container's own
  // dataset.clientId (in case the guard isn't present on a page).
  isStillCurrent() {
    const guardCurrent = window.clientSelectionGuard
      ? window.clientSelectionGuard.getCurrentVersion() === this.selectionVersion
      : true;
    const containerCurrent = !this.container || this.container.dataset.clientId === (this.clientId || '');
    return guardCurrent && containerCurrent;
  }

  getStorageKey() {
    return `${CHECKLIST_STORAGE_PREFIX}${this.clientId || 'default'}`;
  }

  async loadState() {
    if (!this.clientId) {
      if (this.isStillCurrent()) this.render();
      return;
    }

    const applyState = (stateItems) => {
      if (!Array.isArray(stateItems)) return;
      stateItems.forEach((savedItem, index) => {
        if (this.items[index]) {
          this.items[index].checked = Boolean(savedItem.checked);
        }
      });
    };

    const cachedState = checklistStateCache[this.clientId];
    if (Array.isArray(cachedState)) {
      applyState(cachedState);
      if (this.isStillCurrent()) this.render();
    }

    try {
      const appState = readClientChecklistState(this.clientId);
      if (Array.isArray(appState)) {
        checklistStateCache[this.clientId] = appState;
        applyState(appState);
        if (this.isStillCurrent()) this.render();
        return;
      }

      const db = await openSharedDatabase();
      if (!this.isStillCurrent()) return; // a newer client took over while we awaited
      const state = await this.getRecord(db, this.clientId);
      if (!this.isStillCurrent()) return; // superseded while awaiting the DB read
      if (state && Array.isArray(state.items)) {
        checklistStateCache[this.clientId] = state.items;
        writeClientChecklistState(this.clientId, state.items);
        applyState(state.items);
      }
      this.render();
    } catch (error) {
      // Never let a DB failure here abort silently — always fall back to
      // rendering with whatever checked-state we have (even all-unchecked
      // defaults), so the checklist panel never just goes blank/frozen.
      console.warn('Unable to load checklist state.', error);
      if (this.isStillCurrent()) this.render();
    }
  }

  async saveState() {
    if (!this.clientId) return;

    const state = this.items.map((item) => ({ id: item.id, checked: item.checked }));
    checklistStateCache[this.clientId] = state;
    writeClientChecklistState(this.clientId, state);
    try {
      localStorage.setItem(getChecklistStorageKey(this.clientId), JSON.stringify(state));
      const db = await openSharedDatabase();
      await this.putRecord(db, this.clientId, state);
    } catch (error) {
      console.warn('Unable to save checklist state to IndexedDB.', error);
    }
  }

  getRecord(db, clientId) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHECKLIST_STORE_NAME, 'readonly');
      const request = transaction.objectStore(CHECKLIST_STORE_NAME).get(clientId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  putRecord(db, clientId, items) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHECKLIST_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CHECKLIST_STORE_NAME);
      const request = store.put({ clientId, items });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  completedCount() {
    return this.items.filter((item) => item.checked).length;
  }

  updateSummary(summaryElement) {
    if (!summaryElement) return;

    const completed = this.completedCount();
    const total = this.items.length;
    summaryElement.innerHTML = `<strong>${completed} of ${total} tasks completed</strong>`;
  }

  render() {
    if (!this.container) return;
    // Final guard right before paint — cheap insurance against any
    // ordering issue not already caught upstream in loadState().
    if (!this.isStillCurrent()) return;

    this.container.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'checklist-summary';

    const list = document.createElement('div');
    list.className = 'checklist';

    this.items.forEach((item) => {
      const task = document.createElement('div');
      task.className = 'task';

      const inputId = `${item.id}-checkbox`;
      task.innerHTML = `
        <input type="checkbox" id="${inputId}" ${item.checked ? 'checked' : ''} />
        <label for="${inputId}">
          <span class="task-title">${item.title}</span>
          <span class="description">${item.description}</span>
        </label>
      `;

      const checkbox = task.querySelector('input');
      checkbox.addEventListener('change', async () => {
        // Refuse to persist a toggle from a manager that's been
        // superseded by a newer client selection — a stale instance's
        // checkbox should never be able to write to storage.
        if (!this.isStillCurrent()) {
          checkbox.checked = item.checked;
          return;
        }
        item.toggle();
        await this.saveState();
        this.updateSummary(summary);
      });

      list.appendChild(task);
    });

    this.container.appendChild(summary);
    this.container.appendChild(list);
    this.updateSummary(summary);
  }
}

function renderChecklistForClient(clientId, selectionVersion = null) {
  const container = document.getElementById('checklist-container');
  if (!container) return;

  const versionToUse = selectionVersion ?? (window.clientSelectionGuard ? window.clientSelectionGuard.activate(clientId) : 0);
  container.dataset.clientId = clientId || '';
  container.innerHTML = '';
  new ChecklistManager('checklist-container', CHECKLIST_ITEMS, clientId);
  return versionToUse;
}

window.renderChecklistForClient = renderChecklistForClient;

function initializeChecklist() {
  const container = document.getElementById('checklist-container');
  if (!container) return;

  const selectedClientId = localStorage.getItem('selectedClientId');
  renderChecklistForClient(selectedClientId);
}

document.addEventListener('DOMContentLoaded', initializeChecklist);
window.addEventListener('pageshow', initializeChecklist);

window.addEventListener('storage', (event) => {
  if (event.key === 'selectedClientId') {
    initializeChecklist();
  }
});