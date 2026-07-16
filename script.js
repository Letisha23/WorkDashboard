const STORAGE_KEY = 'clientDashboardClients';
const DB_NAME = 'clientDashboardDB';
const DB_VERSION = 1;
const STORE_NAME = 'clients';

const defaultClients = [];
let clients = [];
let dbPromise = null;

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

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by-accountId', 'accountId', { unique: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
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
    const db = await openDatabase();
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
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      store.clear();
      items.forEach((item) => store.put(item));

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('Unable to persist to IndexedDB. Saving locally instead.', error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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

addClientBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

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

async function initializeApp() {
  clientStatus.textContent = 'Loading clients…';
  clients = await loadClientsFromDatabase();
  renderClients();
}

initializeApp();
