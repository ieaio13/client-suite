-- Flokey update 6: projects, tasks and time tracking.
-- Run once in Supabase → SQL Editor (after 005_workspaces.sql). Safe to run again.
-- Only adds new tables; nothing existing is changed.

-- A piece of client work: a website, a campaign, a branding job…
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
