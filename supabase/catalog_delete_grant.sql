-- =============================================================================
-- 最小修復: catalog_spirits の DELETE 権限（編集画面から精霊削除用）
-- =============================================================================
-- permission denied for table catalog_spirits が出たら、これだけ Run すれば OK
-- =============================================================================

GRANT DELETE ON public.catalog_spirits TO anon, authenticated;

DROP POLICY IF EXISTS "anon delete catalog_spirits" ON public.catalog_spirits;
CREATE POLICY "anon delete catalog_spirits"
    ON public.catalog_spirits FOR DELETE TO anon USING (true);
