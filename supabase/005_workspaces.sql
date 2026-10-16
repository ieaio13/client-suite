-- Clientflow update 5: workspaces, so other agencies can sign up and get their own
-- separate space, with a free trial and plan limits.
-- Run once in Supabase → SQL Editor. Safe to run again.
-- Everything you already have becomes the first workspace, 'ws_main', on the
-- unlimited 'owner' plan — nothing is deleted or moved.

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
