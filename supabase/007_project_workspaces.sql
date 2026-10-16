-- Flokey update 7: projects as their own small workspaces.
--   · project guests (designers/editors who only see the projects they're added to)
--   · clients that live inside a project until you move them to your main list
--   · invoices that belong to a project
-- Run once in Supabase → SQL Editor (after 006). Safe to run again. Nothing is deleted.

-- A new team role for people who only see the projects they're invited to.
alter table team drop constraint if exists team_role_check;
alter table team add constraint team_role_check check (role in ('Admin', 'Account Manager', 'Designer', 'Guest'));

-- A project no longer needs a client from your main list (it can have its own clients).
alter table projects alter column client_id drop not null;
alter table projects drop constraint if exists projects_client_id_fkey;
alter table projects add constraint projects_client_id_fkey foreign key (client_id) references clients(id) on delete set null;

-- Clients created inside a project. in_main_list = false keeps them out of your sidebar
-- until you click "Move to my clients" (they stay part of the project either way).
alter table clients add column if not exists project_id text not null default '';
alter table clients add column if not exists in_main_list boolean not null default true;
create index if not exists clients_project_idx on clients(project_id);

-- Invoices that belong to a project (kept apart from your clients' own invoices).
alter table invoices add column if not exists project_id text not null default '';
create index if not exists invoices_project_idx on invoices(project_id);

-- Who is in each project.
create table if not exists project_members (
  workspace_id text not null,
  project_id   text not null references projects(id) on delete cascade,
  email        text not null,
  added_by     text not null default '',
  added_at     text not null default '',
  primary key (project_id, email)
);
create index if not exists project_members_email_idx on project_members(email);
alter table project_members enable row level security;

-- One-time links that let an invited guest set their password.
create table if not exists invites (
  token_hash   text primary key,
  workspace_id text not null,
  email        text not null,
  project_id   text not null default '',
  expires_at   timestamptz not null,
  created_at   text not null default ''
);
create index if not exists invites_email_idx on invites(email);
alter table invites enable row level security;
