-- 開催月・イベント名の手動修正（2026-07-07）
-- Supabase SQL Editor で実行、または scripts/apply-catalog-corrections.py

-- 続編の誤マッチ修正
UPDATE public.catalog_events SET held_year = 2026, held_month = 1 WHERE id = 'recent-e306';
UPDATE public.catalog_events SET held_year = 2024, held_month = 4 WHERE id = 'recent-e263';
UPDATE public.catalog_events SET held_year = 2017, held_month = 7 WHERE id = 'charapre-e101';
UPDATE public.catalog_events SET held_year = 2023, held_month = 1 WHERE id = 'charapre-e233';
UPDATE public.catalog_events SET held_year = 2015, held_month = 4 WHERE id = 'charapre-e42';

-- 周年記念（N周年 → 2013+N 年 3月）
UPDATE public.catalog_events SET held_year = 2016, held_month = 3 WHERE id = 'other-e65';
UPDATE public.catalog_events SET held_year = 2016, held_month = 3 WHERE id = 'other-e66';
UPDATE public.catalog_events SET held_year = 2017, held_month = 3 WHERE id = 'other-e91';
UPDATE public.catalog_events SET held_year = 2018, held_month = 3 WHERE id = 'charapre-e117';
UPDATE public.catalog_events SET held_year = 2019, held_month = 3 WHERE id = 'charapre-e141';
UPDATE public.catalog_events SET held_year = 2020, held_month = 3 WHERE id = 'charapre-e166';
UPDATE public.catalog_events SET held_year = 2021, held_month = 3 WHERE id = 'charapre-e191';
UPDATE public.catalog_events SET held_year = 2022, held_month = 3 WHERE id = 'charapre-e212';
UPDATE public.catalog_events SET held_year = 2023, held_month = 3 WHERE id = 'charapre-e236';
UPDATE public.catalog_events SET held_year = 2023, held_month = 3 WHERE id = 'charapre-e238';
UPDATE public.catalog_events SET held_year = 2024, held_month = 3 WHERE id = 'recent-e262';
UPDATE public.catalog_events SET held_year = 2025, held_month = 3 WHERE id = 'recent-e284';
-- recent-e308 (13周年) は 2026/3 のまま

-- マスタ名称修正
UPDATE public.catalog_events SET title = '天上岬の調香師 しあわせのラストノート' WHERE id = 'charapre-e62';
UPDATE public.catalog_events SET abbr = '進撃の巨人コラボ' WHERE id = 'kollabo-e35';
