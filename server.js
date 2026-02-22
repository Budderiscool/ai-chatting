require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const {
  PORT = 3000,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-1.5-flash',
  SESSION_SECRET,
  ADMIN_USER_ID
} = process.env;

const missingEnv = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
  ['GEMINI_API_KEY', GEMINI_API_KEY],
  ['SESSION_SECRET', SESSION_SECRET]
].filter(([, value]) => !value).map(([name]) => name);

const appReady = missingEnv.length === 0;
const supabase = appReady ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
const genAI = appReady ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

if (!appReady) {
  console.warn(`Missing required env vars: ${missingEnv.join(', ')}. App will start in setup-only mode.`);
}

const COOKIE_NAME = 'chat_session';

app.get('/api/health', (_req, res) => {
  if (!appReady) {
    return res.status(503).json({
      status: 'setup_required',
      missingEnv,
      message: 'Set required environment variables before using the API.'
    });
  }

  return res.json({ status: 'ok' });
});

app.use('/api', (req, res, next) => {
  if (!appReady && req.path !== '/health') {
    return res.status(503).json({
      error: 'Server is in setup-only mode. Set environment variables and restart.',
      missingEnv
    });
  }
  return next();
});

function signSession(user) {
  return jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SESSION_SECRET, {
    expiresIn: '7d'
  });
}

function authRequired(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    req.user = jwt.verify(token, SESSION_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin only endpoint.' });
  }
  return next();
}

async function getUserByUsername(username) {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, password_hash, personality, is_admin')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;
  return data;
}

app.post('/api/signup', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!username || password.length < 8) {
      return res.status(400).json({ error: 'Username required and password must be at least 8 chars.' });
    }

    const existing = await getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already exists.' });

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const isAdmin = ADMIN_USER_ID ? id === ADMIN_USER_ID : false;

    const { data, error } = await supabase
      .from('users')
      .insert({
        id,
        username,
        password_hash: passwordHash,
        personality: 'You are a helpful, concise assistant.',
        is_admin: isAdmin
      })
      .select('id, username, personality, is_admin')
      .single();

    if (error) throw error;

    res.cookie(COOKIE_NAME, signSession(data), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({ user: data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Sign-up failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await getUserByUsername(username);

    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    res.cookie(COOKIE_NAME, signSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ user: { id: user.id, username: user.username, personality: user.personality, is_admin: user.is_admin } });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

app.post('/api/logout', authRequired, (req, res) => {
  res.clearCookie(COOKIE_NAME);
  return res.status(204).send();
});

app.get('/api/me', authRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, personality, is_admin')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ user: data });
});

app.patch('/api/me/personality', authRequired, async (req, res) => {
  const personality = String(req.body.personality || '').trim();
  if (!personality) return res.status(400).json({ error: 'Personality cannot be empty.' });

  const { data, error } = await supabase
    .from('users')
    .update({ personality })
    .eq('id', req.user.id)
    .select('id, username, personality, is_admin')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ user: data });
});

app.get('/api/chats', authRequired, async (req, res) => {
  let query = supabase
    .from('chats')
    .select('id, title, user_id, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (!req.user.is_admin) query = query.eq('user_id', req.user.id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ chats: data });
});

app.post('/api/chats', authRequired, async (req, res) => {
  const title = String(req.body.title || 'New chat').slice(0, 80);
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: req.user.id, title })
    .select('id, title, user_id, created_at, updated_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ chat: data });
});

async function chatVisibleToUser(chatId, user) {
  const { data, error } = await supabase
    .from('chats')
    .select('id, user_id, title')
    .eq('id', chatId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (user.is_admin || data.user_id === user.id) return data;
  return null;
}

app.get('/api/chats/:chatId/messages', authRequired, async (req, res) => {
  try {
    const chat = await chatVisibleToUser(req.params.chatId, req.user);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });

    const { data, error } = await supabase
      .from('messages')
      .select('id, chat_id, role, content, created_at')
      .eq('chat_id', req.params.chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ chat, messages: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/:chatId/messages', authRequired, async (req, res) => {
  try {
    const chat = await chatVisibleToUser(req.params.chatId, req.user);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });

    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message cannot be empty.' });

    const { error: userMsgErr } = await supabase.from('messages').insert({
      chat_id: chat.id,
      role: 'user',
      content
    });
    if (userMsgErr) throw userMsgErr;

    const [{ data: profile, error: profileErr }, { data: history, error: histErr }] = await Promise.all([
      supabase.from('users').select('personality').eq('id', chat.user_id).single(),
      supabase
        .from('messages')
        .select('role, content')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: true })
        .limit(30)
    ]);

    if (profileErr) throw profileErr;
    if (histErr) throw histErr;

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const prompt = [
      `System personality: ${profile.personality}`,
      'Respond in markdown when useful. Emojis are allowed and encouraged when natural.',
      'Conversation so far:',
      ...history.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
      `USER: ${content}`,
      'ASSISTANT:'
    ].join('\n');

    const result = await model.generateContent(prompt);
    const botReply = result.response.text().trim() || 'I could not generate a response right now.';

    const { data: insertedBot, error: botErr } = await supabase
      .from('messages')
      .insert({ chat_id: chat.id, role: 'bot', content: botReply })
      .select('id, chat_id, role, content, created_at')
      .single();

    if (botErr) throw botErr;

    await supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', chat.id);

    return res.status(201).json({ botMessage: insertedBot });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not generate bot response.' });
  }
});

app.get('/api/banner', async (_req, res) => {
  const { data, error } = await supabase
    .from('banners')
    .select('id, message, active, updated_at')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ banner: data || null });
});

app.post('/api/admin/banner', authRequired, adminRequired, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Banner message cannot be empty.' });

  await supabase.from('banners').update({ active: false }).eq('active', true);

  const { data, error } = await supabase
    .from('banners')
    .insert({ message, active: true, created_by: req.user.id })
    .select('id, message, active, updated_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ banner: data });
});

app.get('/api/admin/overview', authRequired, adminRequired, async (_req, res) => {
  const [{ data: users, error: usersErr }, { data: chats, error: chatsErr }, { data: messages, error: messagesErr }] =
    await Promise.all([
      supabase.from('users').select('id, username, is_admin, created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('chats').select('id, title, user_id, created_at, updated_at').order('updated_at', { ascending: false }).limit(200),
      supabase.from('messages').select('id, chat_id, role, content, created_at').order('created_at', { ascending: false }).limit(300)
    ]);

  if (usersErr || chatsErr || messagesErr) {
    return res.status(500).json({ error: usersErr?.message || chatsErr?.message || messagesErr?.message });
  }

  return res.json({ users, chats, messages });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
