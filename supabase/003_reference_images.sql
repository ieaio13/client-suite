-- Flokey update 3: separate "reference images" (brief / inspiration) from the
-- existing "assets", which are now shown as the final design.
-- Run once in Supabase → SQL Editor. Safe to run again; existing data is kept.

alter table posts add column if not exists ref_assets jsonb not null default '[]';
