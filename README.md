# frenz 💬

**Your private companion messenger.** Build virtual friends — or potential romances — who text like real people, adapt to how you treat them, and quietly form their own opinion of you.

frenz is a practice space and a companion: talk about anything, flirt, argue, vent, joke. Each friend has a hidden inner life — mood, comfort, closeness, attraction, and candid notes about you — that you never see, but that shapes every reply. Treat them well and they warm up. Push too hard and they pull back. Just like people.

## Features

- **Friend builder** — name, age, personality, interests, texting style, backstory, and relationship type (friend / close friend / potential romance)
- **Real conversations** — replies arrive as natural multi-bubble texts with human pacing, powered by Claude
- **Hidden inner state** — every exchange privately updates the friend's mood, comfort, closeness, attraction, and honest impressions of you. Saved, never shown
- **Long-term memory** — friends remember durable facts about you across conversations, and notice when you've been gone for days
- **Private by design** — everything lives in your browser (IndexedDB + localStorage). Messages go directly from your device to the Claude API using your own key. No server, no accounts, no tracking
- **Save state** — automatic persistence, plus JSON export/import backup
- **Installable PWA** — add to your home screen; the app shell works offline

## Setup

1. **Host the files** anywhere static (GitHub Pages, Netlify, or locally: `python3 -m http.server` in this folder). PWAs require HTTPS or `localhost`.
2. Open the app, tap **⚙️ Settings**, and paste your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com)). The key is stored only on your device.
3. Tap **+**, build your first friend, and say hi.
4. On your phone, use the browser's **Add to Home Screen** to install it as an app.

## Model options

| Model | Best for |
|---|---|
| Claude Opus 5 (default) | Most lifelike, emotionally nuanced conversation |
| Claude Sonnet 5 | Fast and cheaper, still excellent |
| Claude Haiku 4.5 | Fastest and most affordable |

"Reply depth" controls how much the model thinks before answering — **Snappy** is recommended for natural chat latency.

## Privacy notes

- Your API key, friends, conversations, and each friend's private state never leave your device except as direct calls to `api.anthropic.com`.
- Export a backup from Settings before clearing browser data — clearing site data erases everything.

## Tech

Vanilla HTML/CSS/JS, no build step. IndexedDB for storage, a service worker for the offline shell, and the Claude Messages API with structured outputs (each reply carries both the visible chat bubbles and the friend's private state update in one call).
