-- イベントの開催年月（年/月）を保持するカラムを追加
-- Supabase → SQL Editor で実行してください

ALTER TABLE public.catalog_events
    ADD COLUMN IF NOT EXISTS held_year integer;

ALTER TABLE public.catalog_events
    ADD COLUMN IF NOT EXISTS held_month integer;

