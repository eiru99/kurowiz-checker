-- 精霊の説明ページ URL 用カラムを追加
-- Supabase → SQL Editor で実行してください

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS info_url text;
