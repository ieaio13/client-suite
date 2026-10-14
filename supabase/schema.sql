-- Client Operations & Content Suite — Supabase (Postgres) schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Timestamps shown in the UI (created_at, updated_at, sent_at) are stored as
-- 'yyyy-MM-ddTHH:mm:ss' text in APP_TIMEZONE, same as the old Sheet, so imported
-- rows and new rows sort and display identically.

create table if not exists settings (
  key   text primary key,
  value text not null default ''
);

create table if not exists team (
  email     text primary key check (email = lower(email)),
  name      text not null,
  role      text not null check (role in ('Admin', 'Account Manager', 'Designer')),
  pass_hash text not null,
  salt      text not null
);

create table if not exists sessions (
  token_hash text primary key,
  email      text not null references team(email) on delete cascade on update cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_email_idx on sessions(email);

create table if not exists login_attempts (
  key      text primary key,
  count    int not null default 0,
  reset_at timestamptz not null
);

create table if not exists clients (
  id           text primary key,
  name         text not null,
  parent_id    text references clients(id) on delete cascade,
  token        text unique,
  notify_email text not null default '',
  currency     text not null default '',
  archived     boolean not null default false,
  created_at   text not null default ''
);
create index if not exists clients_parent_idx on clients(parent_id);

create table if not exists posts (
  id         text primary key,
  client_id  text not null references clients(id) on delete cascade,
  "text"     text not null default '',
  status     text not null default 'Draft'
             check (status in ('Draft', 'In Review', 'Approved', 'Scheduled', 'Published')),
  tags       text[] not null default '{}',
  platforms  text[] not null default '{}',
  "date"     text not null default '',
  "time"     text not null default '',
  assets     jsonb not null default '[]',
  live_url   text not null default '',
  metrics    jsonb not null default '{}',
  assignee   text not null default '',
  created_at text not null default '',
  updated_at text not null default ''
);
create index if not exists posts_client_idx on posts(client_id);

create table if not exists comments (
  seq        bigint generated always as identity,
  id         text primary key,
  post_id    text not null references posts(id) on delete cascade,
  client_id  text not null references clients(id) on delete cascade,
  author     text not null default '',
  role       text not null default '',
  "text"     text not null default '',
  created_at text not null default ''
);
create index if not exists comments_client_idx on comments(client_id);
create index if not exists comments_post_idx on comments(post_id);

-- seq keeps insertion order for entries created within the same second.
-- post_id has no foreign key on purpose: "deleted post" entries outlive the post.
create table if not exists activity (
  seq        bigint generated always as identity,
  id         text primary key,
  post_id    text not null default '',
  client_id  text not null references clients(id) on delete cascade,
  actor      text not null default '',
  action     text not null default '',
  details    text not null default '',
  created_at text not null default ''
);
create index if not exists activity_client_idx on activity(client_id);

create table if not exists invoices (
  id          text primary key,
  client_id   text not null references clients(id) on delete cascade,
  number      text not null,
  issue_date  text not null default '',
  due_date    text not null default '',
  status      text not null default 'Pending' check (status in ('Pending', 'Paid')),
  currency    text not null default 'USD',
  items       jsonb not null default '[]',
  tax_pct     text not null default '',
  discount    text not null default '',
  notes       text not null default '',
  pdf_file_id text not null default '',
  pdf_url     text not null default '',
  sent_at     text not null default '',
  created_at  text not null default '',
  updated_at  text not null default ''
);
create unique index if not exists invoices_client_number_uq on invoices(client_id, lower(number));

-- Lock every table down. The API uses the service-role key (which bypasses RLS);
-- with no policies defined, the public anon key can read or write nothing.
alter table settings       enable row level security;
alter table team           enable row level security;
alter table sessions       enable row level security;
alter table login_attempts enable row level security;
alter table clients        enable row level security;
alter table posts          enable row level security;
alter table comments       enable row level security;
alter table activity       enable row level security;
alter table invoices       enable row level security;

-- Storage for uploaded media and invoice PDFs. Files are public-by-URL
-- (unguessable paths), the same model as Drive "anyone with the link".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 20971520, array['image/*', 'video/*', 'application/pdf'])
on conflict (id) do nothing;
