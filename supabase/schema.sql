create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  class_level text,
  subjects text[] default '{}',
  is_registered boolean not null default false,
  registration_step text not null default 'intro',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  phone text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  subject text not null,
  score integer not null default 0,
  total integer not null default 5,
  questions jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_phone on public.students(phone);
create index if not exists idx_conversations_phone_updated on public.conversations(phone, updated_at desc);
create index if not exists idx_messages_phone_created on public.messages(phone, created_at desc);
