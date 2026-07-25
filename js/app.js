/* app.js — views, chat flow, and friend lifecycle. */

const AVATAR_COLORS = ['#7c6cff', '#4dc6a8', '#ff8fb3', '#ffb454', '#5aa9ff', '#ff5d73', '#9b59b6', '#2ecc71'];

const $ = (sel) => document.querySelector(sel);
const views = ['view-friends', 'view-editor', 'view-chat', 'view-settings'];

let currentFriend = null;   // friend object while chatting/editing
let editingId = null;       // friend id being edited, null = creating
let sending = false;

/* ---------------- helpers ---------------- */

function showView(id) {
  views.forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function initials(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function fmtTime(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return today ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

/* ---------------- friends list ---------------- */

async function renderFriendsList() {
  const friends = await DB.listFriends();
  friends.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  const list = $('#friends-list');
  list.innerHTML = '';
  $('#friends-empty').classList.toggle('hidden', friends.length > 0);

  for (const f of friends) {
    const item = document.createElement('div');
    item.className = 'friend-item';
    const badge = f.profile.type === 'romantic'
      ? '<span class="friend-badge romantic">romance</span>'
      : (f.profile.type === 'close_friend' ? '<span class="friend-badge">close</span>' : '');
    item.innerHTML = `
      <div class="avatar" style="background:${f.profile.color}">${initials(f.profile.name)}</div>
      <div class="friend-meta">
        <div class="friend-name">${escapeHtml(f.profile.name)}${badge}</div>
        <div class="friend-preview">${escapeHtml(f.lastPreview || 'Say hi 👋')}</div>
      </div>`;
    item.addEventListener('click', () => openChat(f.id));
    list.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- friend editor ---------------- */

function renderColorPicker(selected) {
  const wrap = $('#f-colors');
  wrap.innerHTML = '';
  AVATAR_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (c === selected ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      wrap.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
      dot.dataset.selected = 'true';
      wrap.dataset.color = c;
    });
    wrap.appendChild(dot);
  });
  wrap.dataset.color = selected;
}

function openEditor(friend) {
  editingId = friend ? friend.id : null;
  $('#editor-title').textContent = friend ? 'Edit friend' : 'New friend';
  $('#btn-save-friend').textContent = friend ? 'Save changes' : 'Create friend';
  $('#btn-delete-friend').classList.toggle('hidden', !friend);

  const p = friend ? friend.profile : {};
  $('#f-name').value = p.name || '';
  $('#f-type').value = p.type || 'friend';
  $('#f-age').value = p.age || 25;
  $('#f-gender').value = p.gender || '';
  $('#f-personality').value = p.personality || '';
  $('#f-interests').value = p.interests || '';
  $('#f-style').value = p.style || '';
  $('#f-backstory').value = p.backstory || '';
  $('#f-username').value = p.userName || '';
  renderColorPicker(p.color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  showView('view-editor');
}

async function saveFriendFromForm(e) {
  e.preventDefault();
  const type = $('#f-type').value;
  const profile = {
    name: $('#f-name').value.trim(),
    type,
    age: parseInt($('#f-age').value, 10) || null,
    gender: $('#f-gender').value.trim(),
    personality: $('#f-personality').value.trim(),
    interests: $('#f-interests').value.trim(),
    style: $('#f-style').value.trim(),
    backstory: $('#f-backstory').value.trim(),
    userName: $('#f-username').value.trim(),
    color: $('#f-colors').dataset.color || AVATAR_COLORS[0]
  };
  if (!profile.name) { toast('Give them a name'); return; }

  let friend;
  if (editingId) {
    friend = await DB.getFriend(editingId);
    friend.profile = profile;
  } else {
    friend = {
      id: uid(),
      profile,
      // starting private state — a new acquaintance, warmer if "close friend"
      state: {
        mood: 'curious, easygoing',
        comfort: type === 'close_friend' ? 70 : 35,
        closeness: type === 'close_friend' ? 65 : 15,
        attraction: type === 'romantic' ? 15 : 0,
        opinion_notes: 'Just starting to get to know them. No strong impressions yet.'
      },
      memories: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      lastPreview: ''
    };
  }
  await DB.saveFriend(friend);
  await renderFriendsList();
  if (editingId) openChat(friend.id); else showView('view-friends');
  editingId = null;
}

/* ---------------- chat ---------------- */

async function openChat(friendId) {
  currentFriend = await DB.getFriend(friendId);
  if (!currentFriend) return;
  const p = currentFriend.profile;
  $('#chat-name').textContent = p.name;
  $('#chat-avatar').textContent = initials(p.name);
  $('#chat-avatar').style.background = p.color;
  $('#chat-status').textContent = 'online';
  await renderMessages();
  showView('view-chat');
  scrollChat(false);
}

async function renderMessages() {
  const msgs = await DB.getMessages(currentFriend.id);
  const box = $('#chat-messages');
  box.innerHTML = '';
  let lastTs = 0;
  for (const m of msgs) {
    if (m.ts - lastTs > 30 * 60000) {
      const t = document.createElement('div');
      t.className = 'msg-time';
      t.textContent = fmtTime(m.ts);
      box.appendChild(t);
    }
    lastTs = m.ts;
    box.appendChild(bubbleEl(m.role, m.text));
  }
  if (!msgs.length) {
    const hint = document.createElement('div');
    hint.id = 'chat-start-hint';
    hint.className = 'msg sys';
    hint.textContent = `This is the beginning of your conversation with ${currentFriend.profile.name}. Send the first message.`;
    box.appendChild(hint);
  }
}

function bubbleEl(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : role === 'sys' ? 'sys' : 'them');
  div.textContent = text;
  return div;
}

function scrollChat(smooth = true) {
  const box = $('#chat-messages');
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function sendMessage() {
  if (sending || !currentFriend) return;
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text) return;

  const settings = Settings.get();
  if (!settings.apiKey) {
    toast('Add your Anthropic API key in Settings first');
    showView('view-settings');
    return;
  }

  sending = true;
  $('#btn-send').disabled = true;
  input.value = '';
  input.style.height = 'auto';

  const friend = currentFriend;
  const priorMsgs = await DB.getMessages(friend.id);
  const lastTs = priorMsgs.length ? priorMsgs[priorMsgs.length - 1].ts : null;

  // show + persist the user's message
  const startHint = $('#chat-start-hint');
  if (startHint) startHint.remove();
  document.querySelectorAll('.transient-note').forEach(n => n.remove());
  $('#chat-messages').appendChild(bubbleEl('user', text));
  scrollChat();
  await DB.addMessage({ friendId: friend.id, role: 'user', text, ts: Date.now() });

  const history = priorMsgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, text: m.text }));
  history.push({ role: 'user', text });

  $('#typing').classList.remove('hidden');
  $('#chat-status').textContent = 'typing…';

  try {
    const result = await ClaudeAPI.chat(friend, history, settings, lastTs, (attempt) => {
      $('#chat-status').textContent = `reconnecting… (${attempt})`;
    });

    if (result.refusal) {
      // Not persisted — a hiccup here shouldn't leave a permanent scar in the
      // conversation or in their memory of you. Show a transient note instead.
      $('#typing').classList.add('hidden');
      const note = document.createElement('div');
      note.className = 'msg sys transient-note';
      note.textContent = 'That one didn\'t send. Try putting it a different way.';
      $('#chat-messages').appendChild(note);
      scrollChat();
      return;
    }

    $('#typing').classList.add('hidden');

    // reveal bubbles one by one with human-ish pacing
    for (let i = 0; i < result.bubbles.length; i++) {
      const b = result.bubbles[i];
      if (i > 0) {
        $('#typing').classList.remove('hidden');
        scrollChat();
        await new Promise(r => setTimeout(r, Math.min(2200, 400 + b.length * 18)));
        $('#typing').classList.add('hidden');
      }
      $('#chat-messages').appendChild(bubbleEl('assistant', b));
      scrollChat();
      await DB.addMessage({ friendId: friend.id, role: 'assistant', text: b, ts: Date.now() });
    }

    // save the friend's private state — persisted, never displayed
    if (result.state) {
      friend.state = {
        mood: result.state.mood,
        comfort: result.state.comfort,
        closeness: result.state.closeness,
        attraction: result.state.attraction,
        opinion_notes: result.state.opinion_notes
      };
      if (result.state.new_memories.length) {
        friend.memories = (friend.memories || []).concat(result.state.new_memories).slice(-120);
      }
    }
    friend.lastActivity = Date.now();
    friend.lastPreview = result.bubbles.length ? result.bubbles[result.bubbles.length - 1] : text;
    await DB.saveFriend(friend);
    renderFriendsList();
  } catch (err) {
    $('#typing').classList.add('hidden');
    toast(err.message || 'Something went wrong', 5000);
  } finally {
    sending = false;
    $('#btn-send').disabled = false;
    $('#chat-status').textContent = 'online';
  }
}

/* ---------------- settings ---------------- */

function openSettings() {
  const s = Settings.get();
  $('#s-apikey').value = s.apiKey;
  $('#s-model').value = s.model;
  $('#s-effort').value = s.effort;
  showView('view-settings');
}

function saveSettings() {
  Settings.set({
    apiKey: $('#s-apikey').value.trim(),
    model: $('#s-model').value,
    effort: $('#s-effort').value
  });
  toast('Settings saved');
  showView('view-friends');
}

async function exportBackup() {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `frenz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- wiring ---------------- */

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function init() {
  $('#btn-new-friend').addEventListener('click', () => openEditor(null));
  $('#btn-editor-back').addEventListener('click', () => {
    if (editingId && currentFriend) { openChat(currentFriend.id); }
    else showView('view-friends');
    editingId = null;
  });
  $('#friend-form').addEventListener('submit', saveFriendFromForm);
  $('#btn-delete-friend').addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this friend and your entire conversation? This cannot be undone.')) return;
    await DB.deleteFriend(editingId);
    editingId = null;
    currentFriend = null;
    await renderFriendsList();
    showView('view-friends');
  });

  $('#btn-chat-back').addEventListener('click', () => { renderFriendsList(); showView('view-friends'); });
  $('#btn-chat-edit').addEventListener('click', () => openEditor(currentFriend));

  const composer = $('#composer');
  const input = $('#composer-input');
  composer.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  input.addEventListener('input', () => autoGrow(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-settings-back').addEventListener('click', () => showView('view-friends'));
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await DB.importAll(data);
      toast('Backup imported');
      await renderFriendsList();
      showView('view-friends');
    } catch (err) {
      toast('Import failed: ' + err.message, 5000);
    }
    e.target.value = '';
  });
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('Erase ALL friends and conversations from this device?')) return;
    if (!confirm('Really sure? There is no undo.')) return;
    await DB.wipe();
    toast('All data erased');
    await renderFriendsList();
    showView('view-friends');
  });

  renderFriendsList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is a bonus, not required */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
