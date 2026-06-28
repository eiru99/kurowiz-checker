-- =============================================================================
-- 黒ウィズ 精霊チェッカー — Supabase セットアップ（RLS 有効版）
-- =============================================================================
--
-- 【実行手順】
-- 1. https://supabase.com/dashboard を開く
-- 2. プロジェクト (lwddylqiyhnubeakrner) を選択
-- 3. 左メニュー「SQL Editor」→「New query」
-- 4. このファイルの内容をすべてコピーして貼り付け → Run
--
-- 【この SQL がやること】
-- - spirits テーブルを整備（sync_key を1人1行に統一）
-- - RLS（行レベルセキュリティ）を有効化
-- - anon ユーザーに SELECT / INSERT / UPDATE のみ許可（DELETE は不可）
-- - Realtime（端末間の即時同期）を有効化
--
-- 【注意】
-- - service_role キーは絶対に HTML に書かないでください
-- - anon キーの公開は GitHub / Vercel 公開時は普通のことです
-- =============================================================================

-- テーブルが無ければ作成
CREATE TABLE IF NOT EXISTS public.spirits (
    sync_key   text        PRIMARY KEY,
    owned_ids  integer[]   NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 既存テーブルに列が無ければ追加
ALTER TABLE public.spirits
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 重複 sync_key があれば古い行を削除（最新 updated_at を残す）
DELETE FROM public.spirits a
    USING public.spirits b
WHERE a.sync_key = b.sync_key
  AND (
    COALESCE(a.updated_at, '1970-01-01'::timestamptz)
    < COALESCE(b.updated_at, '1970-01-01'::timestamptz)
    OR (
        COALESCE(a.updated_at, '1970-01-01'::timestamptz)
        = COALESCE(b.updated_at, '1970-01-01'::timestamptz)
        AND a.ctid < b.ctid
    )
  );

-- sync_key に主キー制約が無ければ付与
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.spirits'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE public.spirits ADD PRIMARY KEY (sync_key);
    END IF;
END $$;

-- 更新日時を自動更新
CREATE OR REPLACE FUNCTION public.set_spirits_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spirits_set_updated_at ON public.spirits;
CREATE TRIGGER spirits_set_updated_at
    BEFORE UPDATE ON public.spirits
    FOR EACH ROW
    EXECUTE FUNCTION public.set_spirits_updated_at();

-- RLS を有効化
ALTER TABLE public.spirits ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除してから作り直す（再実行しても安全）
DROP POLICY IF EXISTS "anon can read spirits" ON public.spirits;
DROP POLICY IF EXISTS "anon can insert spirits" ON public.spirits;
DROP POLICY IF EXISTS "anon can update spirits" ON public.spirits;

-- 読み取り（端末間同期のため必要）
CREATE POLICY "anon can read spirits"
    ON public.spirits
    FOR SELECT
    TO anon
    USING (true);

-- 新規作成（初回保存）
CREATE POLICY "anon can insert spirits"
    ON public.spirits
    FOR INSERT
    TO anon
    WITH CHECK (
        sync_key IS NOT NULL
        AND length(trim(sync_key)) >= 6
        AND owned_ids IS NOT NULL
    );

-- 更新（チェックの切り替え・リセット）
CREATE POLICY "anon can update spirits"
    ON public.spirits
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (
        sync_key IS NOT NULL
        AND length(trim(sync_key)) >= 6
        AND owned_ids IS NOT NULL
    );

-- DELETE 用ポリシーは意図的に作らない → anon から行削除不可

-- Realtime 有効化（スマホ↔PC の即時反映）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'spirits'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.spirits;
    END IF;
END $$;
