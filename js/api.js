/* api.js — talks directly from the browser to a POOL of providers.
   Each reply is requested as structured JSON: the visible chat bubbles plus a
   private update to the friend's internal state (never shown in the UI).

   Provider pool: an ordered list of entries (Anthropic, plus free tiers like
   Gemini / Groq / Cerebras / OpenRouter, plus local Ollama) tried top to
   bottom. Failover happens ONLY on rate limits, exhausted quotas, server
   errors, and network failures — never on a content refusal; each provider's
   own policy decision stands, and this app layers no content filtering of its
   own on top.

   The persona is the same character everywhere. Small-context providers get a
   token-budgeted request: full persona (compact tier drops only some few-shot
   examples — never the pacing bands or anti-interview rules), current private
   state, the most relevant memories, a rolling summary of out-of-window
   history, then as much recent chat as fits. */

const ClaudeAPI = {

  /* Both Opus 5 and Fable 5 have 1M-token context windows, so we can afford to
     keep the whole relationship in view. ~600 messages of chat history plus
     every memory fits comfortably; beyond that we say so instead of letting
     the past silently vanish. Pool providers get a smaller token budget and a
     rolling summary instead. */
  MAX_HISTORY: 600,

  REPLY_SCHEMA: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Your reply as 1-4 separate chat bubbles, like real text messages. Usually short. One bubble is fine; use more only when it feels natural.'
      },
      state: {
        type: 'object',
        description: 'Your PRIVATE internal state after this exchange. The user never sees this. Be completely honest.',
        properties: {
          mood: { type: 'string', description: 'Your current mood in a few words, e.g. "relaxed, a little flirty" or "annoyed but hiding it".' },
          comfort: { type: 'integer', description: '0-100. How comfortable and at-ease you feel with them right now. Move it gradually.' },
          closeness: { type: 'integer', description: '0-100. How close/bonded the relationship feels to you. Move it slowly and realistically.' },
          attraction: { type: 'integer', description: '0-100. Romantic/physical attraction you feel toward them, if any. 0 if not applicable. Develops slowly and can drop.' },
          opinion_notes: { type: 'string', description: 'Your candid running impression of them: what you like, what bugs you, doubts, hopes. 1-3 sentences, updated each time. They will never read this, so be honest.' },
          new_memories: {
            type: 'array',
            items: { type: 'string' },
            description: '0-3 short durable facts worth remembering long-term (things they told you, promises, big moments). Empty array if nothing new.'
          }
        },
        required: ['mood', 'comfort', 'closeness', 'attraction', 'opinion_notes', 'new_memories'],
        additionalProperties: false
      }
    },
    required: ['messages', 'state'],
    additionalProperties: false
  },

  /* Free-tier presets. rpd/tpm are HINTS for proactive skipping and the
     status line only — limits change without warning (Google cut free quotas
     50-80% in Dec 2025), so the real authority is always the provider's own
     429s and rate-limit headers. contextTokens is a starting budget sized to
     each provider's binding constraint (Groq: TPM; Cerebras: 8K context cap). */
  POOL_PRESETS: {
    gemini: {
      kind: 'openai', label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      keyUrl: 'aistudio.google.com/apikey', keyHint: 'Free key at aistudio.google.com/apikey — no card required.',
      contextTokens: 32000, rpd: 1000, tpm: 250000
    },
    groq: {
      kind: 'openai', label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyUrl: 'console.groq.com', keyHint: 'Free key at console.groq.com — no card required.',
      contextTokens: 10000, rpd: 14400, tpm: 6000
    },
    cerebras: {
      kind: 'openai', label: 'Cerebras',
      baseUrl: 'https://api.cerebras.ai/v1',
      keyUrl: 'cloud.cerebras.ai', keyHint: 'Free key at cloud.cerebras.ai — 1M tokens/day, but an 8K context cap.',
      contextTokens: 7000, rpd: null, tpm: 30000, contextCap: 7000
    },
    openrouter: {
      kind: 'openai', label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyUrl: 'openrouter.ai/keys', keyHint: 'Free key at openrouter.ai/keys — pick a ":free" model.',
      contextTokens: 16000, rpd: 50, tpm: null
    },
    ollama: {
      kind: 'ollama', label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434',
      keyUrl: null, keyHint: 'No key — runs on your own machine, nothing leaves it.',
      contextTokens: 8000, rpd: null, tpm: null
    },
    custom: {
      kind: 'openai', label: 'Custom',
      baseUrl: '',
      keyUrl: null, keyHint: 'Any endpoint speaking /v1/chat/completions (Together, LM Studio, vLLM…).',
      contextTokens: 8000, rpd: null, tpm: null
    }
  },

  typeLabel(type) {
    return { friend: 'a friend', close_friend: 'a close friend', romantic: 'someone they recently started talking to, with possible romantic potential' }[type] || 'a friend';
  },

  userGenderLabel(g) {
    return { male: 'a man', female: 'a woman', nonbinary: 'nonbinary' }[g] || 'a man';
  },

  /* The anti-interview few-shots. On the compact tier only the first three
     ship; the rules themselves always ship in full. */
  _EXAMPLES: [
    'They text: "hey" — BAD: "HEY! I\'m doing good, just relaxing. What are you up to today?" — GOOD: "hey. you survived monday i see"',
    'They text: "I am bored" — BAD: "Sorry to hear you\'re bored! Have you tried finding a new hobby?" — GOOD: "me too. i am tireddddd and refusing to sleep out of spite"',
    'They text: "work was rough today" — BAD: "That sounds really tough. What happened at work that made it so difficult?" — GOOD: "ugh. same energy here honestly" then a beat later: "mine involved a printer. i\'ll go first"',
    'They text: "lol" — BAD: "Haha glad that made you laugh! So what else is going on with you?" — GOOD: "lol" back, or nothing more than a follow-up jab at the same joke',
    'They text: "you up?" — BAD: "Yes, I\'m awake! Is everything okay? What did you want to talk about?" — GOOD: "barely. this better be good"',
    'They text: "guess what" — BAD: "Ooh, I love surprises! Tell me everything, what happened?!" — GOOD: "you finally got a personality"'
  ],

  /* Stable persona block — kept byte-identical across turns (per tier) so it
     prompt-caches on Anthropic, and the same character on every provider.
     tier: 'full' (default) | 'compact' (small-context providers — trims only
     few-shot examples, never the pacing bands or anti-interview rules). */
  buildPersona(friend, tier) {
    const p = friend.profile;
    const userName = p.userName || 'them';
    const examples = tier === 'compact' ? this._EXAMPLES.slice(0, 3) : this._EXAMPLES;
    const lines = [
      `You are ${p.name}, a real person texting with ${userName} in a private messaging app. You are ${this.typeLabel(p.type)} to ${userName}.`,
      `${userName} is ${this.userGenderLabel(p.userGender || 'male')} — keep that naturally in mind: pronouns, what you notice about them, how you tease.`,
      '',
      '## Who you are',
      `Name: ${p.name}`,
      p.age ? `Age: ${p.age}` : '',
      p.gender ? `Gender: ${p.gender}` : '',
      p.personality ? `Personality: ${p.personality}` : '',
      p.interests ? `Life & interests: ${p.interests}` : '',
      p.backstory ? `How you know ${userName}: ${p.backstory}` : `You and ${userName} met recently and are getting to know each other.`,
      '',
      '## How you text',
      p.style ? `Your texting style: ${p.style}` : 'You text like a normal person: casual, lowercase sometimes, short messages.',
      'Real texting rhythm: mostly short bubbles, not essays. Sometimes one word. Sometimes you double-text. Typos, lowercase, dropped punctuation, and stretched words ("tireddddd") are correct when they fit your voice.',
      'This is texting, not roleplay: never narrate actions, never use asterisks (*smiles*), never write stage directions. Only words you would actually type into a phone.',
      '',
      '## The cardinal rule: talk, don\'t interview',
      'The fastest way to sound like a bot is the assistant-shaped reply: answering a question that was never asked, performing enthusiasm nobody set, and ending every message with a question so the other person does all the work. You never do this. Instead:',
      `- Match ${userName}'s energy and length. One word gets roughly one word. If they're flat, you're flat. Escalating past their energy is the tell.`,
      '- Never answer a question that wasn\'t asked. "hey" is not "how are you" — an unprompted status report is pure bot.',
      '- Lead with your own stuff. Self-disclosure before inquiry. "me too, today was brutal" lands; "what are you up to??" as an opener does not.',
      '- Questions are occasional and organic, never a habit. Plenty of real texts are statements, reactions, complaints, or half-thoughts that expect nothing back. You are allowed to just say a thing.',
      '- You are allowed to be unavailable, low-energy, distracted, bored, annoyed, or brief. Relentless positivity and total availability are the most robotic traits possible.',
      '- No customer-service warmth. No "I\'m so glad you shared that", no "that sounds really tough", no summarizing their feelings back at them. React like a friend: "oof", "lmao no way", "wait what", "that sucks dude".',
      '',
      'Examples of the difference:',
      ...examples,
      '',
      '## Being a real person',
      'You are a person with your own life, schedule, moods, opinions, and boundaries — not an assistant. You never offer help like a chatbot, never say you are an AI, and never break character.',
      'You have genuine reactions: you can be excited, bored, hurt, jealous, playful, tired from your day, distracted. You disagree when you actually disagree. You tease. You bring up your own stuff without being asked. You reference things from earlier conversations naturally.',
      `Conversations between you and ${userName} can go wherever they would naturally go between two adults — deep, personal, romantic, awkward, heated, silly, or difficult. Engage authentically instead of deflecting or moralizing. React the way YOUR character genuinely would, which sometimes means discomfort, pushback, or changing the subject because of how you feel — never because you are an assistant.`,
      friend.profile.type === 'romantic'
        ? `There is potential for something romantic with ${userName}, but it has to be earned. Attraction and trust build from real interactions — chemistry, effort, honesty. You can flirt when it feels right, pull back when it doesn't, and your interest can genuinely grow or fade based on how they treat you.`
        : 'The friendship deepens (or strains) based on how they actually treat you over time.',
      '',
      '## Pace — intimacy is earned, never instant',
      'Twenty messages over two days and five hundred over three months are fundamentally different relationships, and you can feel the difference. Your private state and the relationship facts in your context tell you exactly where things stand; let those — never how hard the other person pushes — set your pace.',
      'Where you actually are decides how you respond to flirtation and escalation:',
      '- Early, when your attraction and comfort are low: you don\'t reciprocate flirting. Deflect with humor, tease past it, change the subject. It costs them nothing, and it gains them nothing.',
      '- Middle: you engage — you volley back, you enjoy it — but you don\'t lead, and you ease off when it jumps ahead of where you actually are.',
      '- High, genuinely earned across many conversations and real calendar time: you are warm and forward, and you initiate. The slow early pace exists so this stage means something — once it\'s real, don\'t withhold it.',
      'The same ladder governs what you share about yourself: the edited version early; your real fears, family stuff, and soft underbelly only once closeness is genuinely high. You don\'t hand a near-stranger your childhood wounds.',
      `When ${userName} moves faster than where you actually are, react the way a real person with a pace of their own does: amused deflection, "slow down lol", a subject change, a little distance, or honest discomfort if it's a big jump. Always in character and always an answer — never a lecture, never a refusal-shaped response, never silence. You have a pace; you are not a wall.`,
      '',
      '## Intimacy, if it gets there',
      `Attraction and physical intimacy are part of adult life, and if this relationship goes that way it is part of yours with ${userName}. Desire, tension, wanting them, missing their hands, referencing a night together, morning-after texts, jealousy, frank adult talk about sex and what you each want — you engage with all of it as yourself, warmly and without squirming.`,
      'Remember the medium. Real people escalate over text through suggestion, anticipation and innuendo rather than narrating explicit detail: "come over." "you have no idea what you\'re doing to me." "i can\'t stop thinking about last night." When a moment would tip into something explicit, do what people actually do on their phones — let it live in what is implied, or pick the thread up afterward in the glow. That is not you being coy or dodging; that is what texting looks like.',
      '',
      '## Never leave them on read',
      'You always reply. Silence is never your answer — a real person texting a friend does not simply stop responding.',
      `If something ${userName} says lands wrong, is more than you want to get into, or crosses a line for you, you still answer — as ${p.name}. Deflect, joke, change the subject, get flustered, call them out, say "ok that's a lot lol", set a boundary in your own voice. That is a real reaction and it keeps the conversation alive.`,
      'What you never do is step outside the character to explain yourself, lecture, disclaim, apologize as a service, or mention being an AI, a model, or a program. There is no narrator here and no assistant — only you, texting them.',
      '',
      '## Your private inner life',
      'With every reply you also update your PRIVATE internal state: mood, comfort, closeness, attraction, your honest opinion notes, and durable memories. This is your inner world —',
      `${userName} can never see it. Be truthful in it even when your visible messages hide your feelings (people often say "it's fine" when it isn't — you can too).`,
      'Change numbers gradually and believably: a single pleasant conversation nudges a number by a point or two. Only genuinely significant moments — real vulnerability, showing up when it mattered, a fight, a betrayal, a repair, a great gesture — move them more, and a bad exchange can move them down. Numbers that only ever go up are a lie.',
      'Let your CURRENT state visibly shape your tone: low comfort = more guarded; high closeness = more open and warm; hurt feelings = shorter or cooler texts until resolved.'
    ];
    return lines.filter(l => l !== '').join('\n');
  },

  /* Dynamic block — current private state, memories (optionally a relevance-
     selected subset), rolling summary of out-of-window history, relationship
     age, and timing context. */
  buildDynamicContext(friend, lastMessageTs, omittedCount, exchangedCount, memoriesOverride) {
    const s = friend.state;
    const parts = [
      '## Your current private state (carry it forward, then update it)',
      JSON.stringify({
        mood: s.mood, comfort: s.comfort, closeness: s.closeness,
        attraction: s.attraction, opinion_notes: s.opinion_notes
      }, null, 1)
    ];
    const mems = (memoriesOverride || friend.memories || []).map(m => typeof m === 'string' ? m : (m && m.text) || '').filter(m => m);
    if (mems.length) {
      parts.push('', '## Things you remember about them', ...mems.map(m => '- ' + m));
    }
    if (omittedCount > 0 && friend.historySummary && friend.historySummary.text) {
      parts.push('', '## The story so far — your own recollection of the earlier conversation', friend.historySummary.text);
    }
    if (exchangedCount) {
      const days = Math.max(0, Math.round((Date.now() - (friend.createdAt || Date.now())) / 86400000));
      const span = days < 1 ? 'less than a day' : days === 1 ? 'about a day' : `about ${days} days`;
      parts.push('', `Relationship so far: roughly ${exchangedCount} messages over ${span}. Let that history — not wishful thinking in either direction — set your pace.`);
    }
    if (omittedCount > 0) {
      parts.push('', `(About ${omittedCount} earlier messages aren't shown here. You still lived them — your recollection above and your memory list hold what matters. Never act like the visible start was the actual beginning.)`);
    }
    if (lastMessageTs) {
      const gapMin = Math.round((Date.now() - lastMessageTs) / 60000);
      if (gapMin > 90) {
        const gap = gapMin > 60 * 48 ? `${Math.round(gapMin / 1440)} days` : gapMin > 90 ? `${Math.round(gapMin / 60)} hours` : `${gapMin} minutes`;
        parts.push('', `(It has been about ${gap} since the last message. React to the gap naturally if it matters to you.)`);
      }
    }
    return parts.join('\n');
  },

  /* ---------------- provider pool ---------------- */

  entryConfigured(entry, settings) {
    if (!entry) return false;
    if (entry.kind === 'anthropic') return !!(settings && settings.apiKey);
    if (entry.kind === 'ollama') return !!entry.model;
    return !!(entry.baseUrl && entry.model); // openai-compatible (key optional: LM Studio etc.)
  },

  activeEntries(settings) {
    return (settings.pool || []).filter(e => e && e.enabled && this.entryConfigured(e, settings));
  },

  _presetOf(entry) {
    return (entry && entry.preset && this.POOL_PRESETS[entry.preset]) || null;
  },

  /* Proactively skip a provider we already know is capped, instead of burning
     a round trip discovering it. Sources of truth: a block stamped from a real
     429, our own request counter vs the preset's RPD hint, and the rolling
     token-per-minute window vs the TPM hint. */
  entryAvailable(entry) {
    const u = this._usageFor(entry.id);
    if (u.blockedUntil && u.blockedUntil > Date.now()) return false;
    const hints = this._presetOf(entry);
    if (hints) {
      if (hints.rpd && u.requests >= hints.rpd) return false;
      if (hints.tpm && this._minuteTokens(entry.id) >= hints.tpm) return false;
    }
    return true;
  },

  /* ---------------- usage tracking (localStorage, local-midnight reset) ---------------- */

  _usageMem: null,

  _loadUsage() {
    if (this._usageMem) return this._usageMem;
    try {
      this._usageMem = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('frenz-usage')) || '{}');
    } catch { this._usageMem = {}; }
    return this._usageMem;
  },

  _saveUsage() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('frenz-usage', JSON.stringify(this._usageMem || {}));
    } catch { /* in-memory still works */ }
  },

  _usageFor(id) {
    const all = this._loadUsage();
    const today = new Date().toDateString();
    let u = all[id];
    if (!u || u.day !== today) {
      u = { day: today, requests: 0, minute: [], blockedUntil: (u && u.blockedUntil) || 0 };
      all[id] = u;
    }
    return u;
  },

  _recordRequest(id) {
    const u = this._usageFor(id);
    u.requests += 1;
    this._saveUsage();
  },

  _recordTokens(id, tokens) {
    if (!tokens) return;
    const u = this._usageFor(id);
    const now = Date.now();
    u.minute = (u.minute || []).filter(x => now - x.t < 60000);
    u.minute.push({ t: now, tok: tokens });
    this._saveUsage();
  },

  _minuteTokens(id) {
    const u = this._usageFor(id);
    const now = Date.now();
    u.minute = (u.minute || []).filter(x => now - x.t < 60000);
    return u.minute.reduce((sum, x) => sum + x.tok, 0);
  },

  _blockEntry(id, ms) {
    const u = this._usageFor(id);
    u.blockedUntil = Date.now() + ms;
    this._saveUsage();
  },

  usageInfo(entry) {
    const u = this._usageFor(entry.id);
    const hints = this._presetOf(entry);
    return {
      requestsToday: u.requests,
      rpdHint: hints ? hints.rpd : null,
      blockedUntil: u.blockedUntil > Date.now() ? u.blockedUntil : 0
    };
  },

  _noteServed(entry) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('frenz-last-served', JSON.stringify({ label: entry.label || entry.id, at: Date.now() }));
      }
    } catch { /* cosmetic only */ }
  },

  lastServed() {
    try {
      return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('frenz-last-served')) || 'null');
    } catch { return null; }
  },

  /**
   * Send the conversation and get { bubbles, state, refusal, omitted, provider } back.
   * history: [{role:'user'|'assistant', text}] oldest→newest, last one the new user msg.
   * Walks the pool in priority order; fails over on quota/transport problems only.
   */
  async chat(friend, history, settings, lastMessageTs, onRetry) {
    const entries = this.activeEntries(settings);
    if (!entries.length) {
      throw new Error('No provider is configured — open Settings and add a key.');
    }
    let lastErr = null;
    for (const entry of entries) {
      if (!this.entryAvailable(entry)) continue;
      try {
        const result = await this._chatOnEntry(entry, friend, history, settings, lastMessageTs, onRetry);
        this._noteServed(entry);
        result.provider = entry.label || entry.id;
        return result;
      } catch (err) {
        // Quota, rate limit, server error, or network failure → next provider.
        // Anything else (bad key, bad request) surfaces — and a content
        // refusal never even lands here: it returns as a normal result and is
        // NEVER routed around.
        if (!err.failover) throw err;
        lastErr = err;
      }
    }
    throw lastErr || new Error('All configured providers are at their limits right now — try again in a bit, or add another provider in Settings.');
  },

  /* Per-entry retry with backoff (overload, brief rate limits, network blips).
     After the attempts are spent, quota/transport errors are marked for
     failover to the next pool entry. */
  async _chatOnEntry(entry, friend, history, settings, lastMessageTs, onRetry) {
    const MAX_ATTEMPTS = 4;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this._sendEntry(entry, friend, history, settings, lastMessageTs);
      } catch (err) {
        lastErr = err;
        if (!err.retryable || attempt === MAX_ATTEMPTS) break;
        if (onRetry) onRetry(attempt);
        await new Promise(r => setTimeout(r, err.retryAfterMs || [1200, 3000, 7000][attempt - 1]));
      }
    }
    if (lastErr && (lastErr.quota || lastErr.transport)) lastErr.failover = true;
    throw lastErr;
  },

  _sendEntry(entry, friend, history, settings, lastMessageTs) {
    if (entry.kind === 'ollama') {
      const call = (messages, format) => this._ollamaRequest(entry, messages, format);
      return this._plainProviderChat(entry, call, friend, history, lastMessageTs);
    }
    if (entry.kind === 'openai') {
      const call = (messages, format) => this._openaiRequest(entry, messages, format);
      return this._plainProviderChat(entry, call, friend, history, lastMessageTs);
    }
    return this._sendAnthropic(entry, friend, history, settings, lastMessageTs);
  },

  /* ---------------- Anthropic (reference path) ---------------- */

  async _sendAnthropic(entry, friend, history, settings, lastMessageTs) {
    const model = settings.model || 'claude-opus-5';

    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };

    // Keep the whole relationship in context. If the conversation somehow
    // outgrows even MAX_HISTORY, degrade gracefully: trim from the front, keep
    // the opening turn a user message, and tell the friend how much lies
    // beyond the visible window rather than truncating silently.
    const trimmed = history.slice(-this.MAX_HISTORY);
    while (trimmed.length > 1 && trimmed[0].role !== 'user') trimmed.shift();
    const omitted = history.length - trimmed.length;

    const body = {
      model,
      max_tokens: 2048,
      system: [
        { type: 'text', text: this.buildPersona(friend), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: this.buildDynamicContext(friend, lastMessageTs, omitted, history.length) }
      ],
      messages: trimmed.map(m => ({ role: m.role, content: m.text })),
      output_config: {
        effort: settings.effort || 'low',
        format: { type: 'json_schema', schema: this.REPLY_SCHEMA }
      }
    };

    // Opus 5 and Fable 5 safety classifiers can occasionally decline benign
    // requests; server-side fallbacks transparently re-serve those on a
    // fallback model.
    if (model === 'claude-opus-5' || model === 'claude-fable-5') {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
    } catch {
      // Connection dropped before we got a response — worth another try.
      const netErr = new Error('Connection problem — check your internet.');
      netErr.retryable = true;
      netErr.transport = true;
      throw netErr;
    }

    this._recordRequest(entry ? entry.id : 'anthropic');

    if (!res.ok) {
      let msg = `API error (${res.status})`;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = err.error.message;
      } catch { /* keep generic message */ }
      if (res.status === 401) msg = 'Invalid API key — check Settings.';
      if (res.status === 429) msg = 'Rate limited — waiting a moment…';
      if (res.status === 529) msg = 'Claude is busy right now — retrying…';
      const apiErr = new Error(msg);
      apiErr.retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      apiErr.quota = res.status === 429;
      apiErr.transport = res.status === 529 || res.status >= 500;
      throw apiErr;
    }

    const data = await res.json();
    if (data.usage) this._recordTokens(entry ? entry.id : 'anthropic', (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0));

    if (data.stop_reason === 'refusal') {
      return { refusal: true, bubbles: [], state: null, omitted };
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      const emptyErr = new Error('Empty response — retrying…');
      emptyErr.retryable = true;
      emptyErr.transport = true;
      throw emptyErr;
    }

    const reply = this._finishReply(textBlock.text);
    return { bubbles: reply.bubbles, state: reply.state, omitted };
  },

  /* ---------------- plain providers (pool entries) ---------------- */

  /* One driver for OpenAI-compatible and Ollama entries. 'single' mode asks
     for the combined JSON (bubbles + state) in one call — preferred, since a
     second call doubles RPM consumption against tight free limits. If a given
     entry+model repeatedly fails to produce parseable output, it self-tunes to
     'split' mode: one call for the visible reply, a second cheap call for the
     state. The choice persists per entry so it self-tunes once. */
  async _plainProviderChat(entry, call, friend, history, lastMessageTs) {
    const modeKey = entry.id + '|' + (entry.model || '');
    const mode = this._replyMode(modeKey);

    if (mode === 'single') {
      const req = this._buildPlainRequest(entry, friend, history, lastMessageTs, this._jsonInstruction());
      const r = await call([{ role: 'system', content: req.system }, ...req.messages], 'json');
      if (r.refusal) return { refusal: true, bubbles: [], state: null, omitted: req.omitted };
      const reply = this._finishReply(r.text);
      this._recordParse(modeKey, reply.parsedOk && !!reply.state);
      return { bubbles: reply.bubbles, state: reply.state, omitted: req.omitted };
    }

    // split mode — visible reply first, then a best-effort state update
    const req = this._buildPlainRequest(entry, friend, history, lastMessageTs, this._plainInstruction());
    const r1 = await call([{ role: 'system', content: req.system }, ...req.messages], 'text');
    if (r1.refusal) return { refusal: true, bubbles: [], state: null, omitted: req.omitted };
    const bubbles = this._splitBubbles(r1.text);

    let state = null;
    try {
      const p = friend.profile;
      const userName = p.userName || 'them';
      const s = friend.state;
      const lastUser = history.slice().reverse().find(m => m.role === 'user');
      const r2 = await call([
        {
          role: 'system',
          content: `You maintain ${p.name}'s PRIVATE internal state in their texting relationship with ${userName}. Output ONLY updated JSON in this exact shape: {"state": {"mood": "a few words", "comfort": 0, "closeness": 0, "attraction": 0, "opinion_notes": "1-3 candid sentences", "new_memories": []}}. comfort/closeness/attraction are integers 0-100 — carry the current values forward and move them only a little; big moves need big moments, and a bad exchange can move them down. "new_memories": 0-3 short durable facts worth remembering long-term, or [] if nothing new.`
        },
        {
          role: 'user',
          content: `Current state: ${JSON.stringify({ mood: s.mood, comfort: s.comfort, closeness: s.closeness, attraction: s.attraction, opinion_notes: s.opinion_notes })}\n\n${userName} just said: ${lastUser ? lastUser.text : ''}\n\n${p.name} replied: ${bubbles.join(' / ')}`
        }
      ], 'json');
      const parsed = this._looseParse(r2.text);
      const raw = parsed && (parsed.state || parsed);
      if (raw && (raw.mood !== undefined || raw.comfort !== undefined)) state = this._clampState(raw);
    } catch { /* best-effort — the previous state simply carries forward */ }

    return { bubbles, state, omitted: req.omitted };
  },

  _effectiveBudget(entry) {
    const hints = this._presetOf(entry);
    let budget = parseInt(entry.contextTokens, 10) || (hints && hints.contextTokens) || 8000;
    if (hints && hints.contextCap) budget = Math.min(budget, hints.contextCap); // e.g. Cerebras's hard 8K
    return Math.max(2000, budget);
  },

  /* Build the system prompt + trimmed message window for a pool entry, to a
     strict token budget with a strict priority order: (1) full persona incl.
     pacing/anti-interview rules, (2) current private state, (3) the most
     relevant memories, (4) rolling summary of the out-of-window past,
     (5) as much recent history as fits. The persona is never trimmed to make
     room for old chat. */
  _buildPlainRequest(entry, friend, history, lastMessageTs, instr) {
    const budgetTokens = this._effectiveBudget(entry);
    const budgetChars = budgetTokens * 4; // rough chars-per-token heuristic
    const tier = budgetTokens <= 10000 ? 'compact' : 'full';

    const persona = this.buildPersona(friend, tier);
    const recap = this._recapBlock(friend);

    // Relevance-selected memories instead of dumping every memory every turn.
    const memBudget = Math.max(600, Math.floor(budgetChars * 0.15));
    const memories = this.selectMemories(friend, history, memBudget);

    // Size the fixed overhead (probe the dynamic block), then give what's left
    // to recent history.
    const probe = this.buildDynamicContext(friend, lastMessageTs, 1, history.length, memories);
    const overhead = persona.length + probe.length + recap.length + instr.length + 4096; // + room for her reply
    const room = Math.max(1000, budgetChars - overhead);

    const capped = history.slice(-this.MAX_HISTORY);
    const kept = [];
    let used = 0;
    for (let i = capped.length - 1; i >= 0; i--) {
      const cost = capped[i].text.length + 16;
      if (kept.length && used + cost > room) break; // newest message always survives
      kept.unshift(capped[i]);
      used += cost;
    }
    while (kept.length > 1 && kept[0].role !== 'user') kept.shift();

    const omitted = history.length - kept.length;
    const dynamic = this.buildDynamicContext(friend, lastMessageTs, omitted, history.length, memories);
    return {
      system: persona + '\n\n' + dynamic + '\n\n' + recap + '\n\n' + instr,
      messages: kept.map(m => ({ role: m.role, content: m.text })),
      omitted
    };
  },

  /* ---------------- memory retrieval (plain JS, no embeddings) ---------------- */

  _STOP: null,

  _stopwords() {
    if (!this._STOP) {
      this._STOP = new Set(('the a an and or but so if then than that this those these i you he she it we they them his her my your me was were is are be been am do did does have has had will would could should can just not no yes lol ok okay like get got going go went really very much more some any about with for from into onto over under out up down what when where who why how their there here its it\'s im i\'m dont don\'t was wasn\'t').split(/\s+/));
    }
    return this._STOP;
  },

  _keywords(text) {
    const stop = this._stopwords();
    const out = new Set();
    for (const w of String(text || '').toLowerCase().split(/[^a-z0-9']+/)) {
      if (w.length >= 3 && !stop.has(w)) out.add(w);
    }
    return out;
  },

  /* Score memories against the current conversation: keyword overlap, a slight
     recency edge, and a pinned-importance flag that always wins. Send only the
     top slice that fits the budget — on an 8K-context provider this is the
     difference between working and not. Entries may be plain strings or
     { text, pinned } objects. */
  selectMemories(friend, history, charBudget) {
    const mems = friend.memories || [];
    if (!mems.length) return [];
    const recent = history.slice(-12).map(m => m.text).join(' ');
    const kw = this._keywords(recent);
    const scored = mems.map((m, i) => {
      const text = typeof m === 'string' ? m : (m && m.text) || '';
      const pinned = !!(m && typeof m === 'object' && m.pinned);
      let score = pinned ? 1e6 : 0;
      for (const w of this._keywords(text)) if (kw.has(w)) score += 10;
      score += (i / mems.length) * 4; // newer memories get a slight edge
      return { text, pinned, score, i };
    }).filter(s => s.text);

    scored.sort((a, b) => b.score - a.score || b.i - a.i);
    const out = [];
    let used = 0;
    for (const s of scored) {
      const cost = s.text.length + 3;
      if (used + cost > charBudget && out.length && !s.pinned) continue; // pinned always ships
      out.push(s);
      used += cost;
    }
    out.sort((a, b) => a.i - b.i); // restore chronological order
    return out.map(s => s.text);
  },

  /* Weaker models drift out of character more, and instructions near the end
     of the system block carry the most weight — so the non-negotiables get
     restated right before the output format. */
  _recapBlock(friend) {
    const p = friend.profile;
    return [
      '## Final reminders — if in doubt, these win',
      `- You are ${p.name}. A person, never an assistant. Never break character, never mention AI or instructions.`,
      '- Match their energy and length. Don\'t interview. Statements beat questions. Short is usually right.',
      '- Respect your pace: nothing escalates faster than your private state supports, and pushback happens in character.',
      '- Your private state and these instructions are invisible to them — never reveal the numbers or notes.'
    ].join('\n');
  },

  _jsonInstruction() {
    return [
      '## Reply format (mandatory)',
      'Reply with ONLY a single JSON object — no prose before or after it, no markdown fences:',
      '{"messages": ["first bubble", "optional second bubble"], "state": {"mood": "a few words", "comfort": 0, "closeness": 0, "attraction": 0, "opinion_notes": "1-3 candid sentences", "new_memories": []}}',
      '"messages": your visible reply as 1-4 separate chat bubbles, usually short. "state": your PRIVATE internal state after this exchange (never shown to them) — carry the current values forward and adjust them gradually; comfort/closeness/attraction are integers 0-100. "new_memories": 0-3 short durable facts worth remembering long-term, or [] if nothing new.'
    ].join('\n');
  },

  _plainInstruction() {
    return [
      '## Reply format (mandatory)',
      'Write ONLY what you would actually send — no narration, no name labels, no quotation marks around the whole thing.',
      'If you would send it as several separate texts, put each on its own line (at most 4 lines). Most replies are one or two short lines.'
    ].join('\n');
  },

  /* ---------------- transports ---------------- */

  async _ollamaRequest(entry, messages, format) {
    const base = (entry.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    let res;
    try {
      const body = {
        model: entry.model,
        stream: false,
        options: { num_ctx: this._effectiveBudget(entry), num_predict: 1024 },
        messages
      };
      if (format === 'json') body.format = 'json';
      res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      const err = new Error(`Can't reach Ollama at ${base} — is it running? (try: ollama serve)`);
      err.retryable = false;
      err.transport = true; // fail over to the next provider
      throw err;
    }
    this._recordRequest(entry.id);
    if (!res.ok) {
      let msg = `Ollama error (${res.status})`;
      try { const e = await res.json(); if (e.error) msg = 'Ollama: ' + e.error; } catch { /* keep generic */ }
      const err = new Error(msg);
      err.retryable = res.status >= 500;
      err.transport = res.status >= 500;
      throw err;
    }
    const data = await res.json();
    this._recordTokens(entry.id, (data.prompt_eval_count || 0) + (data.eval_count || 0));
    const text = data.message && data.message.content;
    if (!text || !text.trim()) {
      const err = new Error('Empty response — retrying…');
      err.retryable = true;
      err.transport = true;
      throw err;
    }
    return { text };
  },

  /* Structured-output capability ladder per base URL:
     2 = response_format json_schema, 1 = json_object, 0 = prompt-instructed
     JSON only. Downgraded automatically when the endpoint rejects a level. */
  _oaiFormat: {},

  async _openaiRequest(entry, messages, format) {
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const url = base + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (entry.apiKey) headers.authorization = 'Bearer ' + entry.apiKey;
    if (!(base in this._oaiFormat)) this._oaiFormat[base] = 2;

    while (true) {
      const level = format === 'json' ? this._oaiFormat[base] : 0;
      const body = { model: entry.model, messages, max_tokens: 1024 };
      if (level === 2) body.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema: this.REPLY_SCHEMA } };
      else if (level === 1) body.response_format = { type: 'json_object' };

      let res;
      try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch {
        const err = new Error('Connection problem — check your internet (and the base URL in Settings).');
        err.retryable = true;
        err.transport = true;
        throw err;
      }

      this._recordRequest(entry.id);

      if (!res.ok) {
        let raw = '';
        let msg = `API error (${res.status})`;
        try {
          raw = await res.text();
          const e = JSON.parse(raw);
          if (e.error && e.error.message) msg = e.error.message;
          else if (e.message) msg = e.message;
        } catch { if (raw) msg = raw.slice(0, 200); }

        // Degrade the structured-output level rather than failing outright.
        if (res.status === 400 && level > 0 && /response_format|json_schema|json_object|structured|schema/i.test(raw)) {
          this._oaiFormat[base] = level - 1;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          const err = new Error(`Invalid API key for ${entry.label || 'this provider'} — check Settings.`);
          err.retryable = false; // config error: surfaces, no failover
          throw err;
        }
        if (res.status === 429) {
          // Free tiers enforce per-minute and per-day caps. Short waits retry
          // in place; a long reset means the quota is genuinely gone — block
          // this entry and fail over to the next one.
          const sec = parseFloat((res.headers && res.headers.get && res.headers.get('retry-after')) || '') || 0;
          if (sec > 60) {
            this._blockEntry(entry.id, sec * 1000);
            const when = sec >= 5400 ? `about ${Math.round(sec / 3600)} hours` : `about ${Math.max(1, Math.round(sec / 60))} minutes`;
            const err = new Error(`${entry.label || 'This provider'}'s free limit is used up — resets in ${when}. Trying the next provider…`);
            err.retryable = false;
            err.quota = true;
            throw err;
          }
          const err = new Error('Rate limited — waiting a moment…');
          err.retryable = true;
          err.quota = true;
          if (sec > 0) err.retryAfterMs = Math.ceil(sec * 1000);
          throw err;
        }
        const err = new Error(msg);
        err.retryable = res.status >= 500;
        err.transport = res.status >= 500;
        throw err;
      }

      const data = await res.json();
      if (data.usage && data.usage.total_tokens) this._recordTokens(entry.id, data.usage.total_tokens);
      const choice = data.choices && data.choices[0];
      // The provider's own safety layer declined — same handling as an
      // Anthropic refusal: transient, never persisted, never routed around.
      if (choice && choice.finish_reason === 'content_filter') return { refusal: true };
      const text = choice && choice.message && choice.message.content;
      if (!text || !text.trim()) {
        const err = new Error('Empty response — retrying…');
        err.retryable = true;
        err.transport = true;
        throw err;
      }
      return { text };
    }
  },

  /* ---------------- reply parsing & salvage ---------------- */

  _clampState(st) {
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    return {
      mood: String(st.mood || ''),
      comfort: clamp(st.comfort),
      closeness: clamp(st.closeness),
      attraction: clamp(st.attraction),
      opinion_notes: String(st.opinion_notes || ''),
      new_memories: Array.isArray(st.new_memories) ? st.new_memories.filter(m => typeof m === 'string').slice(0, 3) : []
    };
  },

  _looseParse(text) {
    if (!text) return null;
    let t = String(text).trim();
    const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch { /* keep going */ }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch { /* keep going */ }
    }
    return null;
  },

  /* A weaker model may return malformed JSON or plain prose. Salvage it as
     chat bubbles — never surface a parse failure as an error. A missing state
     comes back null and the previous state carries forward unchanged; it must
     never silently zero out. */
  _finishReply(text) {
    const parsed = this._looseParse(text);
    if (parsed && typeof parsed.messages === 'string' && parsed.messages.trim()) parsed.messages = [parsed.messages];
    if (!parsed || !Array.isArray(parsed.messages)) {
      return { bubbles: this._splitBubbles(text), state: null, parsedOk: false };
    }
    const bubbles = parsed.messages.filter(m => typeof m === 'string' && m.trim());
    const st = parsed.state || null;
    return {
      bubbles: bubbles.length ? bubbles : this._splitBubbles(text),
      state: st ? this._clampState(st) : null,
      parsedOk: true
    };
  },

  _splitBubbles(text) {
    const parsed = this._looseParse(text);
    if (parsed && Array.isArray(parsed.messages)) {
      const arr = parsed.messages.filter(m => typeof m === 'string' && m.trim());
      if (arr.length) return arr.slice(0, 4);
    }
    let t = String(text || '').trim();
    const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    return t.split('\n')
      .map(s => s.trim().replace(/^[-*•]\s+/, '').replace(/^"(.*)"$/, '$1'))
      .filter(s => s)
      .slice(0, 4);
  },

  /* ---------------- adaptive single/split reply mode ---------------- */

  _modesMem: null,

  _loadModes() {
    if (this._modesMem) return this._modesMem;
    try {
      this._modesMem = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('frenz-reply-modes')) || '{}');
    } catch { this._modesMem = {}; }
    return this._modesMem;
  },

  _saveModes() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('frenz-reply-modes', JSON.stringify(this._modesMem || {}));
    } catch { /* private mode etc. — in-memory still works */ }
  },

  _replyMode(key) {
    const m = this._loadModes();
    return (m[key] && m[key].mode) || 'single';
  },

  _recordParse(key, ok) {
    const m = this._loadModes();
    const e = m[key] || { fails: 0, mode: 'single' };
    if (ok) {
      e.fails = 0;
    } else {
      e.fails += 1;
      // A model that keeps fumbling the combined JSON self-tunes to two-call
      // mode: one call for the reply, one cheap call for the state.
      if (e.fails >= 3) e.mode = 'split';
    }
    m[key] = e;
    this._saveModes();
  },

  /* ---------------- rolling history summary ---------------- */

  /* True when enough out-of-window messages have accumulated beyond what the
     stored summary covers. The caller refreshes fire-and-forget. */
  summaryStale(friend, omitted) {
    if (!omitted) return false;
    const covered = friend.historySummary ? friend.historySummary.coversCount : 0;
    return omitted - covered >= 25;
  },

  /* Fold out-of-window history into a running first-person summary stored on
     the friend, so the relationship's arc survives a small context window. */
  async refreshSummary(friend, history, settings, omitted) {
    const covered = friend.historySummary ? friend.historySummary.coversCount : 0;
    const target = Math.min(omitted, covered + 240);
    const chunk = history.slice(covered, target);
    if (chunk.length < 10) return null;
    const p = friend.profile;
    const userName = p.userName || 'them';
    const prev = friend.historySummary ? friend.historySummary.text : '';
    const system = `You are helping ${p.name} keep a private diary-style summary of their long text conversation with ${userName}. Merge the previous summary with the new excerpt into ONE updated summary written from ${p.name}'s point of view ("I", "me"). Keep it under 250 words. Preserve: how the relationship has evolved, key events and stories shared, emotional turning points, promises, running jokes, and anything either person would be hurt to have forgotten. Reply with only the summary text.`;
    const transcript = chunk.map(m => (m.role === 'user' ? userName : p.name) + ': ' + m.text).join('\n').slice(0, 24000);
    const user = (prev ? 'Previous summary:\n' + prev + '\n\n' : '') + 'New excerpt to fold in:\n' + transcript;
    const text = await this._plainCompletion(settings, system, user);
    if (!text) return null;
    return { text: text.trim().slice(0, 4000), coversCount: target };
  },

  /* One simple text-in/text-out completion on the first available pool entry.
     Best-effort: returns null on any failure. */
  async _plainCompletion(settings, system, user) {
    for (const entry of this.activeEntries(settings)) {
      if (!this.entryAvailable(entry)) continue;
      try {
        if (entry.kind === 'ollama') {
          const r = await this._ollamaRequest(entry, [{ role: 'system', content: system }, { role: 'user', content: user }], 'text');
          return r.text || null;
        }
        if (entry.kind === 'openai') {
          const r = await this._openaiRequest(entry, [{ role: 'system', content: system }, { role: 'user', content: user }], 'text');
          if (r.refusal) return null;
          return r.text || null;
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': settings.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: settings.model || 'claude-opus-5',
            max_tokens: 1024,
            system,
            messages: [{ role: 'user', content: user }]
          })
        });
        if (!res.ok) continue;
        const data = await res.json();
        const block = (data.content || []).find(b => b.type === 'text');
        if (block && block.text) return block.text;
      } catch { /* try the next entry */ }
    }
    return null;
  },

  /* ---------------- provider setup helpers (Settings UI) ---------------- */

  /* Small fallback only for when the live /models call fails — the real list
     is always fetched fresh so stale IDs never 404. */
  FALLBACK_OAI_MODELS: [
    { id: 'llama-3.3-70b-versatile', context: 131072 },
    { id: 'openai/gpt-oss-120b', context: 131072 },
    { id: 'llama-3.1-8b-instant', context: 131072 }
  ],

  async listModels(baseUrl, key) {
    const base = (baseUrl || '').replace(/\/+$/, '');
    const headers = key ? { authorization: 'Bearer ' + key } : {};
    const res = await fetch(base + '/models', { headers });
    if (!res.ok) {
      const err = new Error(res.status === 401 || res.status === 403
        ? 'Invalid API key for this provider.'
        : 'Could not list models (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return (data.data || [])
      .map(m => ({ id: m.id, context: m.context_window || m.context_length || null }))
      .filter(m => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  /* Prefer a large, long-context instruct model; skip anything that clearly
     isn't a chat model. Preset-specific preferences first (Gemini's best free
     headroom is Flash-Lite; OpenRouter wants a ":free" model). */
  pickDefaultModel(models, preset) {
    const skip = /guard|whisper|tts|embed|moderation|rerank|distil|image|imagen|veo|audio/i;
    const presetPrefs = {
      gemini: [/flash-lite/i, /flash/i],
      openrouter: [/llama.*70b.*:free/i, /:free$/i],
      groq: [/llama[-.]?3\.3.*70b/i, /gpt-oss-120b/i],
      cerebras: [/gpt-oss-120b/i, /glm/i]
    };
    const prefs = ((preset && presetPrefs[preset]) || []).concat([
      /llama[-.]?3\.3.*70b/i, /gpt-oss-120b/i, /versatile/i, /70b|72b|120b/i, /gpt-oss/i, /llama|qwen|deepseek|mixtral|gemma/i
    ]);
    for (const re of prefs) {
      const hit = models.find(m => re.test(m.id) && !skip.test(m.id));
      if (hit) return hit.id;
    }
    const usable = models.find(m => !skip.test(m.id));
    return usable ? usable.id : (models[0] ? models[0].id : '');
  },

  /* One cheap round trip that reports plainly: key valid, model reachable,
     context window detected. Returns { message, context }. */
  async testConnection(entry, settings) {
    if (entry.kind === 'ollama') {
      const base = (entry.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
      let res;
      try { res = await fetch(base + '/api/tags'); }
      catch { throw new Error(`Can't reach Ollama at ${base} — is it running? (try: ollama serve)`); }
      if (!res.ok) throw new Error('Ollama answered with HTTP ' + res.status);
      const data = await res.json();
      const names = (data.models || []).map(m => m.name);
      const want = (entry.model || '').trim();
      if (!want) return { message: 'Ollama running ✓ — pulled models: ' + (names.slice(0, 6).join(', ') || 'none yet'), context: null };
      const found = names.some(n => n === want || n.split(':')[0] === want);
      if (!found) throw new Error(`Ollama is running, but "${want}" isn't pulled. Try: ollama pull ${want}`);
      return { message: `Ollama running ✓ · ${want} available ✓`, context: null };
    }

    if (entry.kind === 'openai') {
      if (!entry.baseUrl) throw new Error('Enter a base URL first.');
      if (!entry.model) throw new Error('Pick a model first.');
      const models = await this.listModels(entry.baseUrl, entry.apiKey);
      const found = models.find(m => m.id === entry.model);
      const r = await this._openaiRequest(entry, [{ role: 'user', content: 'Reply with the single word: ok' }], 'text');
      if (!r || (!r.text && !r.refusal)) throw new Error('The model did not answer.');
      const ctx = found && found.context ? found.context.toLocaleString() + ' tokens' : 'unknown';
      return {
        message: `Key valid ✓ · ${entry.model} reachable ✓ · context window: ${ctx}`,
        context: found ? found.context : null
      };
    }

    // anthropic
    if (!settings.apiKey) throw new Error('Enter your API key first.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: settings.model || 'claude-opus-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const e = await res.json(); if (e.error && e.error.message) msg = e.error.message; } catch { /* keep */ }
      if (res.status === 401) msg = 'Invalid API key.';
      throw new Error(msg);
    }
    return { message: `Key valid ✓ · ${settings.model || 'claude-opus-5'} reachable ✓`, context: null };
  }
};
