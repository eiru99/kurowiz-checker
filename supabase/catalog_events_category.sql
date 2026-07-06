-- イベントの表示カテゴリ（セクション見出しのグループ）を保持するカラムを追加
-- Supabase → SQL Editor で実行してください

ALTER TABLE public.catalog_events
    ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '通常';

-- 既存イベントのカテゴリを section_id から設定
UPDATE public.catalog_events SET category = 'コラボ' WHERE section_id = 'kollabo';
UPDATE public.catalog_events SET category = 'DL記念' WHERE section_id = 'download';
UPDATE public.catalog_events SET category = 'ウィズセレ' WHERE section_id = 'wizselection';
UPDATE public.catalog_events SET category = '通常'
WHERE section_id IN ('latest', 'recent', 'charapre', 'other');
