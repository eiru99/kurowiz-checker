-- =============================================================================
-- catalog 修復用 SQL（Add ボタンが開けないときに実行）
-- =============================================================================
--
-- 【手順】
-- 1. Supabase → SQL Editor → New query
-- 2. このファイルをすべて貼り付け
-- 3. 右下の Run（緑ボタン）を押す
-- 4. 成功したら Results に "Success. No rows returned" などと出る
-- 5. サイトを再読み込みして Add を再度試す
--
-- ※ エラー "permission denied for table catalog_sections" (42501) は
--    RLS ではなく GRANT（テーブル権限）不足が原因です
-- =============================================================================

-- 不足している列があれば追加
ALTER TABLE public.catalog_sections
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.catalog_events
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS main text NOT NULL DEFAULT '火';

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS sub text NOT NULL DEFAULT '火';

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS image_path text;

ALTER TABLE public.catalog_spirits
    ADD COLUMN IF NOT EXISTS info_url text;

-- ★ 重要: anon ロールにテーブル権限を付与（Table Editor 手動作成時に不足しがち）
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_sections TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_spirits TO anon, authenticated;

-- RLS を有効化
ALTER TABLE public.catalog_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_spirits ENABLE ROW LEVEL SECURITY;

-- ポリシーを作り直し（anon から読み書き可能に）
DROP POLICY IF EXISTS "anon read catalog_sections" ON public.catalog_sections;
DROP POLICY IF EXISTS "anon insert catalog_sections" ON public.catalog_sections;
DROP POLICY IF EXISTS "anon update catalog_sections" ON public.catalog_sections;

DROP POLICY IF EXISTS "anon read catalog_events" ON public.catalog_events;
DROP POLICY IF EXISTS "anon insert catalog_events" ON public.catalog_events;
DROP POLICY IF EXISTS "anon update catalog_events" ON public.catalog_events;

DROP POLICY IF EXISTS "anon read catalog_spirits" ON public.catalog_spirits;
DROP POLICY IF EXISTS "anon insert catalog_spirits" ON public.catalog_spirits;
DROP POLICY IF EXISTS "anon update catalog_spirits" ON public.catalog_spirits;
DROP POLICY IF EXISTS "anon delete catalog_spirits" ON public.catalog_spirits;

CREATE POLICY "anon read catalog_sections"
    ON public.catalog_sections FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert catalog_sections"
    ON public.catalog_sections FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update catalog_sections"
    ON public.catalog_sections FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon read catalog_events"
    ON public.catalog_events FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert catalog_events"
    ON public.catalog_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update catalog_events"
    ON public.catalog_events FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon read catalog_spirits"
    ON public.catalog_spirits FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert catalog_spirits"
    ON public.catalog_spirits FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update catalog_spirits"
    ON public.catalog_spirits FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon delete catalog_spirits"
    ON public.catalog_spirits FOR DELETE TO anon USING (true);

-- Storage バケット
INSERT INTO storage.buckets (id, name, public)
VALUES ('spirit-images', 'spirit-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "public read spirit images" ON storage.objects;
DROP POLICY IF EXISTS "anon upload spirit images" ON storage.objects;
DROP POLICY IF EXISTS "anon update spirit images" ON storage.objects;
DROP POLICY IF EXISTS "anon delete spirit images" ON storage.objects;

CREATE POLICY "public read spirit images"
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'spirit-images');

CREATE POLICY "anon upload spirit images"
    ON storage.objects FOR INSERT
    TO anon
    WITH CHECK (bucket_id = 'spirit-images');

CREATE POLICY "anon update spirit images"
    ON storage.objects FOR UPDATE
    TO anon
    USING (bucket_id = 'spirit-images')
    WITH CHECK (bucket_id = 'spirit-images');

CREATE POLICY "anon delete spirit images"
    ON storage.objects FOR DELETE
    TO anon
    USING (bucket_id = 'spirit-images');

-- 初期データ（空のときだけ入る）
INSERT INTO public.catalog_sections (id, title, sort_order) VALUES
    ('latest', '最新ガチャ', 1),
    ('recent', '直近ガチャ', 2),
    ('charapre', 'キャラプレ対象のイベントガチャ', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.catalog_events (id, section_id, abbr, title, sort_order) VALUES
    ('kamisanpo3', 'latest', 'かみさんぽっ3', 'かみさんぽっ!人と妖精の国アイリー', 1),
    ('anniversary13', 'recent', '13周年記念', '魔法使いと黒猫のウィズ 13th Anniversary', 1),
    ('anniversary12', 'recent', '12周年記念', '魔法使いと黒猫のウィズ 12th Anniversary', 2),
    ('anniversary10', 'recent', '10周年記念', '魔法使いと黒猫のウィズ 10th Anniversary', 3),
    ('chrom-magna-1', 'charapre', 'クロム・マグナI', '学園魔道杯 クロム・マグナ', 1),
    ('dorukimas-1', 'charapre', 'ドルキマス1', '空戦のドルキマス 漆黒の翼', 2),
    ('suzaku-1', 'charapre', '幻魔特区スザク1', '幻魔特区スザク', 3),
    ('haigan-1', 'charapre', '覇眼戦線1', '覇眼戦線', 4),
    ('twilight-mares-1', 'charapre', '黄昏メアレス1', '黄昏メアレス I', 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.catalog_spirits (id, event_id, name, main, sub, image_path, sort_order) VALUES
    ('kamisanpo3-kanue', 'kamisanpo3', 'カヌエ', '火', '水', 'images/spirits/kamisanpo3-kanue.png', 1),
    ('kamisanpo3-sora', 'kamisanpo3', 'ソラ', '火', '水', 'images/spirits/kamisanpo3-sora.png', 2),
    ('kamisanpo3-shivuru', 'kamisanpo3', 'シーヴル', '雷', '水', 'images/spirits/kamisanpo3-shivuru.png', 3),
    ('kamisanpo3-holly', 'kamisanpo3', 'ホリー', '水', '火', 'images/spirits/kamisanpo3-holly.png', 4),
    ('anniversary13-gatlin', 'anniversary13', '未来を照らす歌姫 ガトリン・Ｇ・Ｕ', '火', '光', 'images/spirits/anniversary13-gatlin.png', 1),
    ('anniversary12-aldverik', 'anniversary12', '漆黒 of 魔王 アルドベリク', '闇', '火', 'images/spirits/anniversary12-aldverik.png', 1),
    ('anniversary10-eny', 'anniversary10', '世界の中心の少女 エニィ', '水', '火', 'images/spirits/anniversary10-eny.png', 1),
    ('chrom-magna-1-linka', 'chrom-magna-1', '一樹の輝き リンカ・ワイアット', '火', '火', 'images/spirits/chrom-magna-1-linka.png', 1),
    ('dorukimas-1-dietrich', 'dorukimas-1', '孤高の総帥 ディートリヒ・ベルク', '水', '闇', 'images/spirits/dorukimas-1-dietrich.png', 1),
    ('suzaku-1-kivam', 'suzaku-1', '宿命を背負う少年 キワム・ハスラー', '火', '火', 'images/spirits/suzaku-1-kivam.png', 1),
    ('haigan-1-riveta', 'haigan-1', '覇眼の戦乙女 リヴェータ・イレ', '火', '火', 'images/spirits/haigan-1-riveta.png', 1),
    ('twilight-mares-1-refill', 'twilight-mares-1', '夢と現の境界 リフィル・J・チェイサー', '雷', '光', 'images/spirits/twilight-mares-1-refill.png', 1)
ON CONFLICT (id) DO NOTHING;

-- 確認用（Results に件数が出れば OK）
SELECT 'catalog_sections' AS table_name, count(*) AS rows FROM public.catalog_sections
UNION ALL
SELECT 'catalog_events', count(*) FROM public.catalog_events
UNION ALL
SELECT 'catalog_spirits', count(*) FROM public.catalog_spirits;
