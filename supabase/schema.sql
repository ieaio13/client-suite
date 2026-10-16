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

-- ===== Update 2 (also available on its own as 002_features.sql) =====

-- Client order, color, and what their share link allows ('view' or 'edit')
alter table clients add column if not exists sort_order    int  not null default 0;
alter table clients add column if not exists color         text not null default '';
alter table clients add column if not exists portal_access text not null default 'view';
do $$ begin
  alter table clients add constraint clients_portal_access_chk check (portal_access in ('view', 'edit'));
exception when duplicate_object then null; end $$;

-- Who added / last changed each post ('team' or 'client')
alter table posts add column if not exists created_by      text not null default '';
alter table posts add column if not exists created_by_type text not null default 'team';
alter table posts add column if not exists updated_by      text not null default '';

-- Profile details
alter table team add column if not exists title      text not null default '';
alter table team add column if not exists phone      text not null default '';
alter table team add column if not exists avatar_url text not null default '';

-- Reusable tag library
create table if not exists tags (
  id         text primary key,
  name       text not null,
  color      text not null default '',
  sort_order int  not null default 0,
  created_at text not null default ''
);
create unique index if not exists tags_name_uq on tags(lower(name));

-- Browsers that passed an email code (skip the code for 30 days)
create table if not exists trusted_devices (
  token_hash text primary key,
  email      text not null references team(email) on delete cascade on update cascade,
  label      text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists trusted_devices_email_idx on trusted_devices(email);

-- Pending email sign-in codes
create table if not exists login_codes (
  id         text primary key,
  email      text not null references team(email) on delete cascade on update cascade,
  code_hash  text not null,
  attempts   int  not null default 0,
  sent_at    timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists login_codes_email_idx on login_codes(email);

alter table tags            enable row level security;
alter table trusted_devices enable row level security;
alter table login_codes     enable row level security;

-- ===== Update 3 (also available on its own as 003_reference_images.sql) =====

alter table posts add column if not exists ref_assets jsonb not null default '[]';

-- ===== Update 4 (also available on its own as 004_board_columns_comment_images.sql) =====
-- Extra board columns for one brand (e.g. "Shooting", "Editing"). Each sits right after
-- one of the core stages and counts as that stage for approvals and emails.
create table if not exists board_columns (
  id           text primary key,
  client_id    text not null references clients(id) on delete cascade,
  name         text not null,
  color        text not null default '',
  after_status text not null default 'Draft'
               check (after_status in ('Draft', 'In Review', 'Approved', 'Scheduled', 'Published')),
  sort_order   int  not null default 0,
  created_at   text not null default ''
);
create index if not exists board_columns_client_idx on board_columns(client_id);
alter table board_columns enable row level security;

-- Which custom column a post is in ('' = the core stage column)
alter table posts add column if not exists column_id text not null default '';

-- Images attached to comments
alter table comments add column if not exists attachments jsonb not null default '[]';

-- ===================== Update 5: workspaces =====================
create table if not exists workspaces (
  id             text primary key,
  name           text not null default '',
  -- 'trial', 'starter', 'growth', 'agency', 'owner' (unlimited, never expires) or 'paused'
  plan           text not null default 'trial',
  trial_ends_at  text not null default '',
  requested_plan text not null default '',
  owner_email    text not null default '',
  created_at     text not null default ''
);
alter table workspaces enable row level security;

insert into workspaces (id, name, plan, created_at)
values ('ws_main', 'Main workspace', 'owner', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'))
on conflict (id) do nothing;

-- Tag every existing row with the first workspace.
alter table settings      add column if not exists workspace_id text not null default 'ws_main';
alter table team          add column if not exists workspace_id text not null default 'ws_main';
alter table clients       add column if not exists workspace_id text not null default 'ws_main';
alter table posts         add column if not exists workspace_id text not null default 'ws_main';
alter table comments      add column if not exists workspace_id text not null default 'ws_main';
alter table activity      add column if not exists workspace_id text not null default 'ws_main';
alter table invoices      add column if not exists workspace_id text not null default 'ws_main';
alter table tags          add column if not exists workspace_id text not null default 'ws_main';
alter table board_columns add column if not exists workspace_id text not null default 'ws_main';

-- From now on the app always says which workspace a row belongs to.
alter table settings      alter column workspace_id drop default;
alter table team          alter column workspace_id drop default;
alter table clients       alter column workspace_id drop default;
alter table posts         alter column workspace_id drop default;
alter table comments      alter column workspace_id drop default;
alter table activity      alter column workspace_id drop default;
alter table invoices      alter column workspace_id drop default;
alter table tags          alter column workspace_id drop default;
alter table board_columns alter column workspace_id drop default;

create index if not exists team_ws_idx          on team(workspace_id);
create index if not exists clients_ws_idx       on clients(workspace_id);
create index if not exists posts_ws_idx         on posts(workspace_id);
create index if not exists comments_ws_idx      on comments(workspace_id);
create index if not exists activity_ws_idx      on activity(workspace_id);
create index if not exists invoices_ws_idx      on invoices(workspace_id);
create index if not exists tags_ws_idx          on tags(workspace_id);
create index if not exists board_columns_ws_idx on board_columns(workspace_id);

-- Each workspace has its own settings and its own tag names.
alter table settings drop constraint if exists settings_pkey;
alter table settings add primary key (workspace_id, key);
drop index if exists tags_name_uq;
create unique index if not exists tags_ws_name_uq on tags(workspace_id, lower(name));

-- ===================== Update 6: projects, tasks, time =====================
create table if not exists projects (
  id           text primary key,
  workspace_id text not null,
  client_id    text not null references clients(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  status       text not null default 'Active'
               check (status in ('Planning', 'Active', 'On hold', 'Done')),
  start_date   text not null default '',
  due_date     text not null default '',
  budget       text not null default '',
  owner        text not null default '',   -- team email
  sort_order   int  not null default 0,
  created_at   text not null default '',
  updated_at   text not null default ''
);
create index if not exists projects_ws_idx on projects(workspace_id);
create index if not exists projects_client_idx on projects(client_id);
alter table projects enable row level security;

create table if not exists tasks (
  id             text primary key,
  workspace_id   text not null,
  project_id     text not null references projects(id) on delete cascade,
  title          text not null,
  notes          text not null default '',
  status         text not null default 'To do'
                 check (status in ('To do', 'In progress', 'Review', 'Done')),
  assignee       text not null default '',  -- team email
  due_date       text not null default '',
  estimate_hours text not null default '',
  sort_order     int  not null default 0,
  created_by     text not null default '',
  created_at     text not null default '',
  completed_at   text not null default ''
);
create index if not exists tasks_ws_idx on tasks(workspace_id);
create index if not exists tasks_project_idx on tasks(project_id);
alter table tasks enable row level security;

-- Hours worked. A running timer is a row with started_at set and minutes = 0.
create table if not exists time_entries (
  id           text primary key,
  workspace_id text not null,
  project_id   text not null references projects(id) on delete cascade,
  task_id      text not null default '',
  user_email   text not null,
  date         text not null,
  minutes      int  not null default 0 check (minutes >= 0),
  note         text not null default '',
  billable     boolean not null default true,
  invoice_id   text not null default '',   -- set once billed on an invoice
  started_at   text not null default '',   -- ISO time while a timer is running
  created_at   text not null default ''
);
create index if not exists time_entries_ws_idx on time_entries(workspace_id);
create index if not exists time_entries_project_idx on time_entries(project_id);
create index if not exists time_entries_user_idx on time_entries(user_email);
alter table time_entries enable row level security;

-- Time tracking is off unless switched on for a client (Client settings → Time tracking).
alter table clients add column if not exists time_tracking boolean not null default false;
