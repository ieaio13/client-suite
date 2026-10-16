-- Clientflow update 4: custom board columns per sub-client, and images on comments.
-- Run once in Supabase → SQL Editor. Safe to run again; existing data is kept.

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
