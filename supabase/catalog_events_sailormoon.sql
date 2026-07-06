-- セーラームーンコラボ追加（GameWith e35）
-- scripts/import-gamewith-spirits.py で取り込み済み。再実行時は import スクリプトを使用。

INSERT INTO public.catalog_events (
    id, section_id, category, abbr, title, storage_folder, sort_order, held_year, held_month
) VALUES (
    'kollabo-sailormoon',
    'kollabo',
    'コラボ',
    'セーラームーンコラボ',
    'SAILORMOON 黒き月の侵略者/2匹の黒猫',
    'seeraamuunkorabo',
    19,
    2015,
    1
) ON CONFLICT (id) DO UPDATE SET
    abbr = EXCLUDED.abbr,
    title = EXCLUDED.title,
    category = EXCLUDED.category,
    held_year = EXCLUDED.held_year,
    held_month = EXCLUDED.held_month;
