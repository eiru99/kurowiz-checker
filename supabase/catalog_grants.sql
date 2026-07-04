-- =============================================================================
-- 最小修復: GRANT のみ（Add エラー 42501 用）
-- =============================================================================
-- permission denied for table catalog_sections / catalog_spirits が出たら、これだけ Run すれば OK
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_sections TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_spirits TO anon, authenticated;

DROP POLICY IF EXISTS "anon delete catalog_spirits" ON public.catalog_spirits;
CREATE POLICY "anon delete catalog_spirits"
    ON public.catalog_spirits FOR DELETE TO anon USING (true);
