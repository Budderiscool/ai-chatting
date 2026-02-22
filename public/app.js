const auth = document.getElementById('auth');
const chatSection = document.getElementById('chatSection');
const authStatus = document.getElementById('authStatus');
const bannerEl = document.getElementById('banner');

const state = { me: null, chats: [], activeChatId: null };

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showAuth(message = '') {
  auth.classList.remove('hidden');
  chatSection.classList.add('hidden');
  authStatus.textContent = message;
}

function showChat() {
  auth.classList.add('hidden');
  chatSection.classList.remove('hidden');
  document.getElementById('meLabel').textContent = `${state.me.username} (${state.me.id})`;
  document.getElementById('personality').value = state.me.personality;
  document.getElementById('adminPanel').classList.toggle('hidden', !state.me.is_admin);
}

function renderMessages(messages) {
  const root = document.getElementById('messages');
  root.innerHTML = '';
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `msg ${msg.role}`;
    div.innerHTML = `<small>${msg.role}</small>${marked.parse(msg.content)}`;
    root.appendChild(div);
  }
  root.scrollTop = root.scrollHeight;
}

async function loadBanner() {
  const data = await api('/api/banner');
  if (data.banner) {
    bannerEl.classList.remove('hidden');
    bannerEl.textContent = `📢 ${data.banner.message}`;
  } else {
    bannerEl.classList.add('hidden');
    bannerEl.textContent = '';
  }
}

async function loadChats() {
  const data = await api('/api/chats');
  state.chats = data.chats;
  const list = document.getElementById('chatList');
  list.innerHTML = '';
  for (const chat of state.chats) {
    const btn = document.createElement('button');
    btn.textContent = `${chat.title} · ${chat.user_id.slice(0, 8)}`;
    btn.onclick = async () => {
      state.activeChatId = chat.id;
      const info = await api(`/api/chats/${chat.id}/messages`);
      renderMessages(info.messages);
    };
    list.appendChild(btn);
  }

  if (!state.activeChatId && state.chats[0]) {
    state.activeChatId = state.chats[0].id;
    const info = await api(`/api/chats/${state.activeChatId}/messages`);
    renderMessages(info.messages);
  }
}

async function refreshAdmin() {
  if (!state.me?.is_admin) return;
  const data = await api('/api/admin/overview');
  document.getElementById('adminOverview').textContent = JSON.stringify(data, null, 2);
}

async function init() {
  try {
    const me = await api('/api/me');
    state.me = me.user;
    showChat();
    await loadChats();
    await loadBanner();
    await refreshAdmin();
  } catch {
    showAuth();
    await loadBanner();
  }
}

document.getElementById('signupBtn').onclick = async () => {
  try {
    const payload = {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    };
    const data = await api('/api/signup', { method: 'POST', body: JSON.stringify(payload) });
    state.me = data.user;
    showChat();
    await loadChats();
  } catch (e) {
    showAuth(e.message);
  }
};

document.getElementById('loginBtn').onclick = async () => {
  try {
    const payload = {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    };
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify(payload) });
    state.me = data.user;
    showChat();
    await loadChats();
    await refreshAdmin();
  } catch (e) {
    showAuth(e.message);
  }
};

document.getElementById('logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  state.me = null;
  state.activeChatId = null;
  showAuth('Logged out');
};

document.getElementById('newChatBtn').onclick = async () => {
  const data = await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) });
  state.activeChatId = data.chat.id;
  await loadChats();
};

document.getElementById('sendBtn').onclick = async () => {
  if (!state.activeChatId) return;
  const input = document.getElementById('messageInput');
  const content = input.value;
  input.value = '';
  await api(`/api/chats/${state.activeChatId}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
  const info = await api(`/api/chats/${state.activeChatId}/messages`);
  renderMessages(info.messages);
  await loadChats();
};

document.getElementById('savePersonalityBtn').onclick = async () => {
  const personality = document.getElementById('personality').value;
  const data = await api('/api/me/personality', { method: 'PATCH', body: JSON.stringify({ personality }) });
  state.me = data.user;
};

document.getElementById('setBannerBtn').onclick = async () => {
  const message = document.getElementById('bannerInput').value;
  await api('/api/admin/banner', { method: 'POST', body: JSON.stringify({ message }) });
  await loadBanner();
};

document.getElementById('refreshAdminBtn').onclick = refreshAdmin;

setInterval(loadBanner, 30000);
init();
