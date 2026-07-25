/* db.js — local-first storage. Friends, messages, and each friend's private
   internal state live in IndexedDB on this device only. */

const DB_NAME = 'frenz';
const DB_VERSION = 2;

const DB = {
  _db: null,

  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('friends')) {
          db.createObjectStore('friends', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
          ms.createIndex('byFriend', 'friendId', { unique: false });
        }
        if (!db.objectStoreNames.contains('events')) {
          // state-delta ledger: every applied delta + reason, for debugging,
          // later rollups, and recomputing state if curves are retuned
          const ev = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          ev.createIndex('byFriend', 'friendId', { unique: false });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async _tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result._value !== undefined ? result._value : result.result);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ---- friends ----
  saveFriend(friend) { return this._tx('friends', 'readwrite', s => s.put(friend)); },
  getFriend(id) { return this._tx('friends', 'readonly', s => s.get(id)); },
  listFriends() { return this._tx('friends', 'readonly', s => s.getAll()); },
  async deleteFriend(id) {
    await this._tx('friends', 'readwrite', s => s.delete(id));
    await this.deleteMessages(id);
  },

  // ---- messages ----
  addMessage(msg) { return this._tx('messages', 'readwrite', s => s.add(msg)); },
  getMessages(friendId) {
    return this._tx('messages', 'readonly', s => s.index('byFriend').getAll(friendId));
  },
  async deleteMessages(friendId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      const idx = tx.objectStore('messages').index('byFriend');
      const cursorReq = idx.openCursor(IDBKeyRange.only(friendId));
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ---- state-delta event ledger ----
  addEvent(ev) { return this._tx('events', 'readwrite', s => s.add(ev)); },
  getEvents(friendId) {
    return this._tx('events', 'readonly', s => s.index('byFriend').getAll(friendId));
  },

  // ---- backup ----
  async exportAll() {
    const friends = await this.listFriends();
    const db = await this.open();
    const messages = await new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readonly');
      const req = tx.objectStore('messages').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return { app: 'frenz', version: 1, exportedAt: new Date().toISOString(), friends, messages };
  },

  async importAll(data) {
    if (!data || data.app !== 'frenz' || !Array.isArray(data.friends)) {
      throw new Error('Not a valid frenz backup file');
    }
    for (const f of data.friends) await this.saveFriend(f);
    for (const m of (data.messages || [])) {
      const { id, ...rest } = m; // let autoIncrement assign new ids
      await this.addMessage(rest);
    }
  },

  async wipe() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['friends', 'messages', 'events'], 'readwrite');
      tx.objectStore('friends').clear();
      tx.objectStore('messages').clear();
      tx.objectStore('events').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

/* settings live in localStorage.

   Providers are a POOL, not a picker: an ordered list of entries tried top to
   bottom, with automatic failover on rate limits / daily caps / outages (never
   on a content refusal — that's the provider's call and it stands). The
   Anthropic entry's credentials live in the top-level apiKey/model/effort
   fields; free-pool entries carry their own config. */
const DEFAULT_SETTINGS = {
  apiKey: '', model: 'claude-opus-5', effort: 'low',
  pool: [
    { id: 'anthropic', kind: 'anthropic', label: 'Anthropic (Claude)', enabled: true }
  ]
};

const Settings = {
  get() {
    let stored;
    try { stored = JSON.parse(localStorage.getItem('frenz-settings') || '{}'); } catch { stored = {}; }
    const s = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (!Array.isArray(s.pool) || !s.pool.length) {
      s.pool = DEFAULT_SETTINGS.pool.map(e => Object.assign({}, e));
    }
    if (!s.pool.some(e => e.kind === 'anthropic')) {
      s.pool.unshift({ id: 'anthropic', kind: 'anthropic', label: 'Anthropic (Claude)', enabled: true });
    }
    return s;
  },
  set(s) { localStorage.setItem('frenz-settings', JSON.stringify(s)); }
};
