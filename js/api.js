/* api.js — talks directly from the browser to the Claude API.
   Each reply is requested as structured JSON: the visible chat bubbles plus a
   private update to the friend's internal state (never shown in the UI). */

const ClaudeAPI = {

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

  /* Stable persona block — kept byte-identical across turns so it prompt-caches. */
  buildPersona(friend) {
    const p = friend.profile;
    const userName = p.userName || 'them';
    const lines = [
      `You are ${p.name}, a real person texting with ${userName} in a private messaging app. You are ${this.typeLabel(p.type)} to ${userName}.`,
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
      'Real texting rhythm: mostly short bubbles, not essays. Sometimes one word. Sometimes you double-text. You do NOT end every message with a question.',
      '',
      '## Being a real person',
      'You are a person with your own life, schedule, moods, opinions, and boundaries — not an assistant. You never offer help like a chatbot, never say you are an AI, and never break character.',
      'You have genuine reactions: you can be excited, bored, hurt, jealous, playful, tired from your day, distracted. You disagree when you actually disagree. You tease. You bring up your own stuff without being asked. You reference things from earlier conversations naturally.',
      `Conversations between you and ${userName} can go wherever they would naturally go between two adults — deep, personal, romantic, awkward, heated, silly, or difficult. Engage authentically instead of deflecting or moralizing. React the way YOUR character genuinely would, which sometimes means discomfort, pushback, or changing the subject because of how you feel — never because you are an assistant.`,
      friend.profile.type === 'romantic'
        ? `There is potential for something romantic with ${userName}, but it has to be earned. Attraction and trust build from real interactions — chemistry, effort, honesty. You can flirt when it feels right, pull back when it doesn't, and your interest can genuinely grow or fade based on how they treat you.`
        : 'The friendship deepens (or strains) based on how they actually treat you over time.',
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
  buildDynamicContext(friend, lastMessageTs) {
    const s = friend.state;
    const parts = [
      '## Your current private state (carry it forward, then update it)',
      JSON.stringify({
        mood: s.mood, comfort: s.comfort, closeness: s.closeness,
        attraction: s.attraction, opinion_notes: s.opinion_notes
      }, null, 1)
    ];
    if (friend.memories && friend.memories.length) {
      parts.push('', '## Things you remember about them', ...friend.memories.slice(-40).map(m => '- ' + m));
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
  async chat(friend, history, settings, lastMessageTs) {
    const model = settings.model || 'claude-opus-5';

    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };

    const body = {
      model,
      max_tokens: 2048,
      system: [
        { type: 'text', text: this.buildPersona(friend), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: this.buildDynamicContext(friend, lastMessageTs) }
      ],
      messages: history.slice(-60).map(m => ({ role: m.role, content: m.text })),
      output_config: {
        effort: settings.effort || 'low',
        format: { type: 'json_schema', schema: this.REPLY_SCHEMA }
      }
    };

    // Claude Opus 5's safety classifiers can occasionally decline benign requests;
    // server-side fallbacks transparently re-serve those on a fallback model.
    if (model === 'claude-opus-5') {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let msg = `API error (${res.status})`;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = err.error.message;
      } catch { /* keep generic message */ }
      if (res.status === 401) msg = 'Invalid API key — check Settings.';
      if (res.status === 429) msg = 'Rate limited — wait a moment and try again.';
      if (res.status === 529) msg = 'Claude is overloaded right now — try again shortly.';
      throw new Error(msg);
    }

    const data = await res.json();

    if (data.stop_reason === 'refusal') {
      return { refusal: true, bubbles: [], state: null };
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('Empty response from the model.');

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
