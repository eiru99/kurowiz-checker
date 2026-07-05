-- カタログのセクション・イベント配置を画面表示用に正規化
-- Supabase SQL Editor で実行

INSERT INTO public.catalog_sections (id, title, sort_order) VALUES
    ('wizselection', 'プラチナ/ウィズセレクション', 7)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    sort_order = EXCLUDED.sort_order;

UPDATE public.catalog_sections SET sort_order = 1 WHERE id = 'latest';
UPDATE public.catalog_sections SET sort_order = 2 WHERE id = 'recent';
UPDATE public.catalog_sections SET sort_order = 3 WHERE id = 'charapre';
UPDATE public.catalog_sections SET sort_order = 4 WHERE id = 'other';
UPDATE public.catalog_sections SET sort_order = 5 WHERE id = 'kollabo';
UPDATE public.catalog_sections SET sort_order = 6 WHERE id = 'download';
UPDATE public.catalog_sections SET sort_order = 7 WHERE id = 'wizselection';

UPDATE public.catalog_events
SET section_id = 'download',
    sort_order = 0
WHERE id = 'charapre-e97';

UPDATE public.catalog_events
SET section_id = 'wizselection',
    sort_order = 1
WHERE id = 'charapre-wizsele';

-- download セクション内の既存イベント sort_order を 1 ずつ繰り下げ
UPDATE public.catalog_events AS target
SET sort_order = target.sort_order + 1
WHERE target.section_id = 'download'
  AND target.id <> 'charapre-e97';

UPDATE public.catalog_events
SET sort_order = 1
WHERE id = 'download-e97'
  AND section_id = 'download';
