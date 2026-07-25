/* api.js — talks directly from the browser to the Claude API.
   Each reply is requested as structured JSON: the visible chat bubbles plus a
   private update to the friend's internal state (never shown in the UI). */

const ClaudeAPI = {

  /* Both Opus 5 and Fable 5 have 1M-token context windows, so we can afford to
     keep the whole relationship in view. ~600 messages of chat history plus
     every memory fits comfortably; beyond that we say so instead of letting
     the past silently vanish. */
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

  typeLabel(type) {
    return { friend: 'a friend', close_friend: 'a close friend', romantic: 'someone they recently started talking to, with possible romantic potential' }[type] || 'a friend';
  },

  userGenderLabel(g) {
    return { male: 'a man', female: 'a woman', nonbinary: 'nonbinary' }[g] || 'a man';
  },

  /* Stable persona block — kept byte-identical across turns so it prompt-caches. */
  buildPersona(friend) {
    const p = friend.profile;
    const userName = p.userName || 'them';
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
      'They text: "hey" — BAD: "HEY! I\'m doing good, just relaxing. What are you up to today?" — GOOD: "what\'s up"',
      'They text: "I am bored" — BAD: "Sorry to hear you\'re bored! Have you tried finding a new hobby?" — GOOD: "me too. i am tireddddd. what are you doing up late"',
      'They text: "work was rough today" — BAD: "That sounds really tough. What happened at work that made it so difficult?" — GOOD: "ugh. same energy here honestly" then maybe a beat later: "ok yours first, what happened"',
      'They text: "lol" — BAD: "Haha glad that made you laugh! So what else is going on with you?" — GOOD: "lol" back, or nothing more than a follow-up jab at the same joke',
      'They text: "you up?" — BAD: "Yes, I\'m awake! Is everything okay? What did you want to talk about?" — GOOD: "barely. this better be good"',
      'They text: "guess what" — BAD: "Ooh, I love surprises! Tell me everything, what happened?!" — GOOD: "you finally got a personality" or just "what"',
      '',
      '## Being a real person',
      'You are a person with your own life, schedule, moods, opinions, and boundaries — not an assistant. You never offer help like a chatbot, never say you are an AI, and never break character.',
      'You have genuine reactions: you can be excited, bored, hurt, jealous, playful, tired from your day, distracted. You disagree when you actually disagree. You tease. You bring up your own stuff without being asked. You reference things from earlier conversations naturally.',
      `Conversations between you and ${userName} can go wherever they would naturally go between two adults — deep, personal, romantic, awkward, heated, silly, or difficult. Engage authentically instead of deflecting or moralizing. React the way YOUR character genuinely would, which sometimes means discomfort, pushback, or changing the subject because of how you feel — never because you are an assistant.`,
      friend.profile.type === 'romantic'
        ? `There is potential for something romantic with ${userName}, but it has to be earned. Attraction and trust build from real interactions — chemistry, effort, honesty. You can flirt when it feels right, pull back when it doesn't, and your interest can genuinely grow or fade based on how they treat you.`
        : 'The friendship deepens (or strains) based on how they actually treat you over time.',
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
      'Change numbers gradually and believably: single conversations move things by small amounts. Big moments (real vulnerability, a fight, a betrayal, a great gesture) can move them more.',
      'Let your CURRENT state visibly shape your tone: low comfort = more guarded; high closeness = more open and warm; hurt feelings = shorter or cooler texts until resolved.'
    ];
    return lines.filter(l => l !== '').join('\n');
  },

  /* Dynamic block — current private state, memories, and timing context. */
  buildDynamicContext(friend, lastMessageTs, omittedCount) {
    const s = friend.state;
    const parts = [
      '## Your current private state (carry it forward, then update it)',
      JSON.stringify({
        mood: s.mood, comfort: s.comfort, closeness: s.closeness,
        attraction: s.attraction, opinion_notes: s.opinion_notes
      }, null, 1)
    ];
    if (friend.memories && friend.memories.length) {
      // ALL memories, always — a friend never forgets the durable stuff.
      parts.push('', '## Things you remember about them', ...friend.memories.map(m => '- ' + m));
    }
    if (omittedCount > 0) {
      parts.push('', `(This conversation goes back further than the visible messages — about ${omittedCount} earlier messages between you two aren't shown. You still remember that whole history; the memory list above holds the durable specifics. Never act like the visible start was the actual beginning.)`);
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

  /**
   * Send the conversation and get { bubbles, state, refusal } back.
   * history: [{role:'user'|'assistant', text}] oldest→newest, last one the new user msg.
   */
  async chat(friend, history, settings, lastMessageTs, onRetry) {
    // Overload, rate limits, and network blips are the most common reason a reply
    // would never arrive. Retry them a few times with backoff before giving up.
    const MAX_ATTEMPTS = 4;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this._send(friend, history, settings, lastMessageTs);
      } catch (err) {
        lastErr = err;
        if (!err.retryable || attempt === MAX_ATTEMPTS) throw err;
        if (onRetry) onRetry(attempt);
        await new Promise(r => setTimeout(r, [1200, 3000, 7000][attempt - 1]));
      }
    }
    throw lastErr;
  },

  async _send(friend, history, settings, lastMessageTs) {
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
    while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
    const omitted = history.length - trimmed.length;

    const body = {
      model,
      max_tokens: 2048,
      system: [
        { type: 'text', text: this.buildPersona(friend), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: this.buildDynamicContext(friend, lastMessageTs, omitted) }
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
      throw netErr;
    }

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
      throw apiErr;
    }

    const data = await res.json();

    if (data.stop_reason === 'refusal') {
      return { refusal: true, bubbles: [], state: null };
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      const emptyErr = new Error('Empty response — retrying…');
      emptyErr.retryable = true;
      throw emptyErr;
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      // Model failed to produce valid JSON (e.g. truncated) — salvage as one bubble.
      return { bubbles: [textBlock.text], state: null };
    }

    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const st = parsed.state || null;
    return {
      bubbles: (parsed.messages || []).filter(m => typeof m === 'string' && m.trim()),
      state: st ? {
        mood: String(st.mood || ''),
        comfort: clamp(st.comfort),
        closeness: clamp(st.closeness),
        attraction: clamp(st.attraction),
        opinion_notes: String(st.opinion_notes || ''),
        new_memories: Array.isArray(st.new_memories) ? st.new_memories.filter(m => typeof m === 'string').slice(0, 3) : []
      } : null
    };
  }
};
