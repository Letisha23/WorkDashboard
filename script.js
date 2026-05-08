const STORAGE_KEY = 'clientDashboardClients';
const defaultClients = [];

function loadClients() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultClients;

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Unable to parse saved clients, using defaults.', error);
    return defaultClients;
  }
}

function saveClients() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
}

let clients = loadClients();

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

function deleteClient(index) {
  clients.splice(index, 1);
  saveClients();
  renderClients();
}

function renderClients() {
  clientGrid.innerHTML = '';
  clientCount.textContent = clients.length;
  clientStatus.textContent = `${clients.length} clients loaded`;

  clients.forEach((client, index) => {
    const card = document.createElement('article');
    card.className = 'client-card';

    card.innerHTML = `
      <div class="card-top">
        <div>
          <h4 class="client-name">${client.name}</h4>
          <p class="account-id">Account ID: ${client.accountId}</p>
        </div>
      </div>
      <div class="card-footer">
        <a class="link-btn" href="${buildAccessLink(client.accountId)}" target="_blank" rel="noopener noreferrer">Open access</a>
        <button type="button" class="delete-btn">Delete</button>
      </div>
    `;

    card.addEventListener('click', (event) => {
      const isLink = event.target.closest('a');
      const isDeleteButton = event.target.closest('.delete-btn');
      if (isLink) return;
      if (isDeleteButton) {
        event.stopPropagation();
        deleteClient(index);
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

clientForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const nameInput = document.getElementById('client-name');
  const accountInput = document.getElementById('account-id');

  const newClient = {
    name: nameInput.value.trim(),
    accountId: accountInput.value.trim(),
  };

  if (!newClient.name || !newClient.accountId) return;

  clients.push(newClient);
  saveClients();
  renderClients();
  closeModal();
});

renderClients();
