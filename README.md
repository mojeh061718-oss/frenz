# frenz 💬

**Your private companion messenger.** Build virtual friends — or potential romances — who text like real people, adapt to how you treat them, and quietly form their own opinion of you.

frenz is a practice space and a companion: talk about anything, flirt, argue, vent, joke. Each friend has a hidden inner life — mood, comfort, closeness, attraction, and candid notes about you — that you never see, but that shapes every reply. Treat them well and they warm up. Push too hard and they pull back. Just like people.

## Features

- **Personas gallery** — five hand-tuned characters with real backstories, plus a blank editor for building someone from scratch. Sliders (closeness, flirtiness, warmth, confidence, curiosity, attraction) tune how she actually behaves
- **Real conversations** — replies arrive as natural multi-bubble texts with human pacing, powered by Grok
- **She texts first** — friends open conversations on their own schedule: a life event, a follow-up on something you said, or the thing left unresolved last night
- **Hidden inner state** — every exchange privately updates the friend's mood, comfort, closeness, attraction, and honest impressions of you. Saved, never shown. Relationship levels genuinely earned are floors that a quiet week can't undo
- **A life of her own** — life beats (concrete things that happen in her world), evening textures, good and bad weeks; her world keeps running between your messages
- **Long-term memory** — friends remember durable facts across conversations, keep scene records of older chapters, and notice when you've been gone for days
- **Photos** — friends can send candid, faceless phone photos of their moment (via xAI's grok-imagine; optional, off until an image model is configured). The composer command `testlook` previews her look through the same pipeline without touching the conversation
- **Analysis archive** — Settings can export a diagnostic archive of a conversation: worn phrases, mirroring, voice fidelity, delivery stats
- **Private by design** — everything lives in your browser (IndexedDB + localStorage). Messages go directly from your device to the provider using your own key. No server, no accounts, no tracking
- **Save state** — automatic persistence, plus JSON export/import backup (re-import is idempotent)
- **Installable PWA** — add to your home screen; the app shell works offline

## Setup

1. **Host the files** anywhere static (GitHub Pages, Netlify, or locally: `python3 -m http.server` in this folder). PWAs require HTTPS or `localhost`.
2. Open the app, tap **⚙️ Settings**, and paste a key into one of the two provider slots. The key is stored only on your device.
3. Pick someone from the gallery (or tap **Blank / custom**), and say hi.
4. On your phone, use the browser's **Add to Home Screen** to install it as an app.

## Provider

One model, two routes — whichever key you have:

| Route | Where to get a key |
|---|---|
| **Grok (xAI)** | [console.x.ai](https://console.x.ai) — the model list is fetched live once the key is in |
| **Grok (AWS Bedrock)** | Bedrock console → API keys → generate a long-term key. New AWS accounts get $200 in credits, and they work here |

There is deliberately no failover pool behind it: a provider that says plainly "Grok is unreachable" beats one that silently swaps in a weaker model and just starts writing worse. Photos always go through xAI's grok-imagine — a Bedrock chat setup can still send photos by adding an xAI key in the image field.

## Privacy notes

- Your API key, friends, conversations, and each friend's private state never leave your device except as direct calls to your chosen provider (`api.x.ai` or AWS Bedrock).
- Export a backup from Settings before clearing browser data — clearing site data erases everything.

## Tech

Vanilla HTML/CSS/JS, no build step. IndexedDB for storage, a service worker for the offline shell, and OpenAI-compatible chat completions with structured outputs (each reply carries both the visible chat bubbles and the friend's private state update in one call).
