-- Clientflow update 2: client editing, who-added tracking, client order & colors,
-- tag library, profiles, and email sign-in codes for new devices.
-- Run once in Supabase → SQL Editor. Safe to run again; existing data is kept.

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
