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
  deleteMessage(id) { return this._tx('messages', 'readwrite', s => s.delete(id)); },
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

   One provider: Grok, by whichever route your key takes — xAI direct, or Grok
   hosted on AWS Bedrock. There is no failover pool behind it any more. A pool
   silently swapped in a weaker model whenever the good one hiccuped, and the
   only symptom was that she suddenly wrote badly; one provider that says "I
   couldn't reach Grok" is worth more than three that quietly write worse. */
const DEFAULT_SETTINGS = {
  apiKey: '', model: 'claude-opus-5', effort: 'low',
  // Both routes ship disabled-until-keyed: Grok has no keyless tier, so a
  // fresh install genuinely cannot talk until a key is in. The entries exist
  // so Settings shows two labelled slots to paste into rather than a blank.
  pool: [
    { id: 'grok', kind: 'openai', preset: 'grok', label: 'Grok (xAI)', baseUrl: 'https://api.x.ai/v1', apiKey: '', model: 'grok-4.3', imageModel: 'grok-imagine-image', contextTokens: 1000000, enabled: true },
    { id: 'bedrock', kind: 'bedrock', preset: 'bedrock', label: 'Grok (AWS Bedrock)', apiKey: '', model: 'xai.grok-4.3', region: 'us-east-1', contextTokens: 1000000, enabled: true }
  ]
};

const Settings = {
  get() {
    let stored;
    try { stored = JSON.parse(localStorage.getItem('frenz-settings') || '{}'); } catch { stored = {}; }
    const s = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (!Array.isArray(s.pool)) s.pool = [];
    // Retired providers are dropped rather than left dangling: their preset
    // no longer exists, so they'd have no budget, no key hint, and no model
    // list behind them. A Bedrock entry the user already keyed SURVIVES —
    // that's the route their AWS credits are on, whatever model it names.
    const RETIRED = ['llm7', 'pollinations', 'zen', 'gemini', 'groq', 'cerebras', 'openrouter', 'ollama', 'custom'];
    s.pool = s.pool.filter(e => e && e.kind !== 'anthropic' && RETIRED.indexOf(e.preset) < 0);
    // Both Grok slots always exist so Settings has somewhere to paste a key.
    for (const def of DEFAULT_SETTINGS.pool) {
      if (!s.pool.some(e => e.preset === def.preset || e.id === def.id)) {
        s.pool.push(Object.assign({}, def));
      }
    }
    // A budget saved under an old provider's ceiling (or hand-set low, like
    // 25k) keeps squeezing the prompt for no reason: Grok's window is 1M.
    // Anything below 100k is an artifact of the old pool, not a choice that
    // makes sense against this model, so it is raised once on load.
    for (const e of s.pool) {
      if (!(parseInt(e.contextTokens, 10) > 0) || parseInt(e.contextTokens, 10) < 100000) e.contextTokens = 1000000;
      // Photos on the xAI route arrived in v7.5: entries saved before then
      // have no imageModel property at all, and photos should just work.
      // `undefined` ONLY — a user who blanked the field ('') chose no
      // photos, and the heal must never override a choice.
      if (e.preset === 'grok' && e.imageModel === undefined) e.imageModel = 'grok-imagine-image';
    }
    return s;
  },
  set(s) { localStorage.setItem('frenz-settings', JSON.stringify(s)); }
};
