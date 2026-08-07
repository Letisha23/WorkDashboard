(function (global) {
  const APP_STATE_STORAGE_KEY = 'clientDashboardAppState';

  // Single shared IndexedDB connection for the whole app. Previously
  // script.js, checklist.js, and notes.js each opened 'clientDashboardDB'
  // independently at their own version numbers (1, 2, 2). IndexedDB only
  // has one real version per database name across the whole origin —
  // whichever page loaded first "won" and set the actual on-disk version,
  // and any other script requesting a lower version afterward gets a
  // hard VersionError on open. That error was going unhandled deep in an
  // async chain in notes.js, silently killing the client-switch flow.
  //
  // Bump DB_VERSION here (in ONE place) whenever a store needs to change.
  // Every store any part of the app needs is created here, once.
  const DB_NAME = 'clientDashboardDB';
  const DB_VERSION = 3;

  let dbPromise = null;

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
        if (!database.objectStoreNames.contains('clients')) {
          const store = database.createObjectStore('clients', { keyPath: 'id' });
          store.createIndex('by-accountId', 'accountId', { unique: true });
        }
        if (!database.objectStoreNames.contains('notes')) {
          database.createObjectStore('notes', { keyPath: 'clientId' });
        }
        if (!database.objectStoreNames.contains('checklists')) {
          database.createObjectStore('checklists', { keyPath: 'clientId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null; // allow a retry on a later call instead of caching a dead promise
        reject(request.error);
      };
    });

    return dbPromise;
  }

  global.DB_NAME = DB_NAME;
  global.DB_VERSION = DB_VERSION;
  global.openSharedDatabase = openDatabase;

  // Shared read/write helpers for the per-client app state blob
  // (notes + checklist state). Both notes.js and checklist.js rely on
  // these being defined here — do not redeclare them in those files,
  // since plain <script> tags share one global scope and a duplicate
  // `const` declaration is a fatal SyntaxError that silently kills the
  // whole file that contains it.
  function loadAppState() {
    const saved = localStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!saved) return {};

    try {
      return JSON.parse(saved);
    } catch (error) {
      console.warn('Unable to parse client app state.', error);
      return {};
    }
  }

  function saveAppState(state) {
    try {
      localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to save client app state.', error);
    }
  }

  global.APP_STATE_STORAGE_KEY = APP_STATE_STORAGE_KEY;
  global.loadAppState = loadAppState;
  global.saveAppState = saveAppState;

  function createSelectionGuard() {
    let currentClientId = null;
    let currentVersion = 0;

    function activate(clientId) {
      const normalizedClientId = clientId || null;
      if (currentClientId !== normalizedClientId) {
        currentClientId = normalizedClientId;
        currentVersion += 1;
      }
      return currentVersion;
    }

    function getActiveClientId() {
      return currentClientId;
    }

    function getCurrentVersion() {
      return currentVersion;
    }

    function isCurrent(clientId, version) {
      return currentClientId === (clientId || null) && currentVersion === version;
    }

    return {
      activate,
      getActiveClientId,
      getCurrentVersion,
      isCurrent,
    };
  }

  global.createSelectionGuard = createSelectionGuard;
  global.clientSelectionGuard = global.clientSelectionGuard || createSelectionGuard();
})(window);