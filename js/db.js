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
    await this._deleteByFriend('messages', id);
    await this._deleteByFriend('events', id); // her ledger goes with her
  },

  // ---- messages ----
  addMessage(msg) { return this._tx('messages', 'readwrite', s => s.add(msg)); },
  getMessages(friendId) {
    return this._tx('messages', 'readonly', s => s.index('byFriend').getAll(friendId));
  },
  deleteMessages(friendId) { return this._deleteByFriend('messages', friendId); },
  async _deleteByFriend(store, friendId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const idx = tx.objectStore(store).index('byFriend');
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
  async _getAll(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async exportAll() {
    const friends = await this.listFriends();
    const messages = await this._getAll('messages');
    // The event ledger is part of the relationship's history — a backup that
    // drops it restores friends with amnesia about how they got here.
    const events = await this._getAll('events');
    return { app: 'frenz', version: 2, exportedAt: new Date().toISOString(), friends, messages, events };
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
    for (const ev of (data.events || [])) {
      const { id, ...rest } = ev;
      await this.addEvent(rest);
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
  // Fresh install: keyless providers preconfigured and enabled at the top —
  // the app holds a real conversation with ZERO setup. LLM7 and OpenCode Zen
  // verified keyless; Pollinations' anonymous tier is documented keyless.
  // The Anthropic entry rides along unconfigured and is skipped until a key
  // is added (at which point it's promoted to the front — see saveSettings).
  pool: [
    { id: 'llm7', kind: 'openai', preset: 'llm7', label: 'LLM7 (no key)', baseUrl: 'https://api.llm7.io/v1', apiKey: '', model: 'gpt-oss:20b', contextTokens: 16000, enabled: true },
    { id: 'pollinations', kind: 'openai', preset: 'pollinations', label: 'Pollinations (no key)', baseUrl: 'https://text.pollinations.ai/openai', apiKey: '', model: 'openai-fast', contextTokens: 12000, enabled: true },
    { id: 'zen', kind: 'openai', preset: 'zen', label: 'OpenCode Zen (no key)', baseUrl: 'https://opencode.ai/zen/v1', apiKey: '', model: 'big-pickle', contextTokens: 12000, enabled: true },
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
    // Existing installs gain any missing keyless entries at the BOTTOM —
    // they only serve when everything the user configured is unavailable,
    // so an existing setup is never silently demoted.
    for (const def of DEFAULT_SETTINGS.pool) {
      if (def.preset && !s.pool.some(e => e.preset === def.preset || e.id === def.id)) {
        s.pool.push(Object.assign({}, def));
      }
    }
    return s;
  },
  set(s) { localStorage.setItem('frenz-settings', JSON.stringify(s)); }
};
