const STORAGE_KEY = 'clientDashboardClients';
const STORE_NAME = 'clients';

// NOTE: the IndexedDB connection is opened once, in client-state.js, via
// global.openSharedDatabase(). Do not open a separate connection at a
// separate version number here. This file previously opened
// 'clientDashboardDB' at version 1 while checklist.js/notes.js opened it
// at version 2 — since IndexedDB has one real on-disk version per
// database name across the whole origin, whichever page loaded first won,
// and every other script requesting a different (often lower) version
// got a hard VersionError on open. Make sure client-state.js is loaded on
// this page before this script, the same way progress.html does it.

const defaultClients = [];
let clients = [];

const clientGrid = document.getElementById('client-grid');
const clientCount = document.getElementById('client-count');
const clientStatus = document.getElementById('client-status');
const addClientBtn = document.getElementById('add-client-btn');
const modal = document.getElementById('modal');
const modalClose = document.getElementById('modal-close');
const clientForm = document.getElementById('client-form');

function buildAccessLink(accountId) {
  const baseUrl = 'https://app.impact.com/secure/grantTempSupportAccess.ihtml';
  const params = new URLSearchParams({ clientId: accountId });
  return `${baseUrl}?${params}`;
}

function createClientRecord({ name, accountId, region }) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim(),
    accountId: accountId.trim(),
    region: region.trim(),
    createdAt: new Date().toISOString(),
  };
}

function loadFallbackClients() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultClients;

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Unable to parse saved clients, using defaults.', error);
    return defaultClients;
  }
}

async function loadClientsFromDatabase() {
  try {
    const db = await openSharedDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB unavailable, falling back to localStorage.', error);
    return loadFallbackClients();
  }
}

async function persistClientsToDatabase(items) {
  // Always save to localStorage first so the UI sees persisted data immediately.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn('Unable to write to localStorage', e);
  }

  // Attempt to persist to IndexedDB; do not fail the operation if this errors.
  try {
    const db = await openSharedDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      store.clear();
      items.forEach((item) => store.put(item));

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('Unable to persist to IndexedDB (non-fatal)', error);
  }
}

async function addClient(clientData) {
  const newClient = createClientRecord(clientData);
  clients = [...clients, newClient];
  await persistClientsToDatabase(clients);
  renderClients();
}

async function deleteClient(clientId) {
  clients = clients.filter((client) => client.id !== clientId);
  await persistClientsToDatabase(clients);
  renderClients();
}

function renderClients() {
  if (!clientGrid || !clientCount || !clientStatus) return;

  clientGrid.innerHTML = '';
  clientCount.textContent = clients.length;
  clientStatus.textContent = `${clients.length} clients loaded`;

  clients.forEach((client) => {
    const card = document.createElement('article');
    card.className = 'client-card';

    card.innerHTML = `
      <div class="card-top">
        <div>
          <h4 class="client-name">${client.name}</h4>
          <p class="account-id">Account ID: ${client.accountId}</p>
        </div>
        ${client.region ? `<span class="badge">${client.region}</span>` : ''}
      </div>
      <div class="card-footer">
        <a class="link-btn" href="${buildAccessLink(client.accountId)}" target="_blank" rel="noopener noreferrer">Open access</a>
        <button type="button" class="delete-btn" data-client-id="${client.id}">Delete</button>
      </div>
    `;

    card.addEventListener('click', (event) => {
      const isLink = event.target.closest('a');
      const isDeleteButton = event.target.closest('.delete-btn');
      if (isLink) return;
      if (isDeleteButton) {
        event.stopPropagation();
        deleteClient(isDeleteButton.dataset.clientId);
        return;
      }
      window.open(buildAccessLink(client.accountId), '_blank');
    });

    clientGrid.appendChild(card);
  });
}

function openModal() {
  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
  clientForm.reset();
}

if (addClientBtn) addClientBtn.addEventListener('click', openModal);
if (modalClose) modalClose.addEventListener('click', closeModal);
if (modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
}

if (clientForm) {
  clientForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nameInput = document.getElementById('client-name');
    const accountInput = document.getElementById('account-id');

    const newClient = {
      name: nameInput.value,
      accountId: accountInput.value,
      region: '',
    };

    if (!newClient.name.trim() || !newClient.accountId.trim()) return;

    await addClient(newClient);
    closeModal();
  });
}

async function initializeApp() {
  if (!clientGrid || !clientCount || !clientStatus) return;

  clientStatus.textContent = 'Loading clients…';
  clients = await loadClientsFromDatabase();
  renderClients();
}

document.addEventListener('DOMContentLoaded', initializeApp);
window.addEventListener('pageshow', initializeApp);