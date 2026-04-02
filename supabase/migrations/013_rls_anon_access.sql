-- =============================================================
-- 013_rls_anon_access.sql
-- V1: Allow anon role full access (no auth yet)
-- Remove this when auth is implemented in V2
-- =============================================================

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'debiteuren', 'afleveradressen', 'producten', 'rollen',
            'prijslijst_headers', 'prijslijst_regels',
            'collecties', 'kwaliteiten', 'magazijn_locaties',
            'klanteigen_namen', 'klant_artikelnummers',
            'orders', 'order_regels',
            'zendingen', 'zending_regels',
            'facturen', 'factuur_regels',
            'snijplannen', 'confectie_orders', 'samples',
            'vertegenwoordigers', 'leveranciers',
            'inkooporders', 'inkooporder_regels',
            'activiteiten_log', 'nummering'
        ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "Anon full access" ON public.%I
             FOR ALL TO anon USING (true) WITH CHECK (true)',
            tbl
        );
    END LOOP;
END $$;
