create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  username text unique not null,
  password_hash text not null,
  personality text not null default 'You are a helpful assistant.',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'bot')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  created_by uuid references users(id),
  updated_at timestamptz not null default now()
);
