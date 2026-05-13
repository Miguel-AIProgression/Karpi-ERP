-- Migratie 277: Levertijd-Module — RPC-skeleton (fit-check + snelste haalbaar)
--
-- ADR-0020: Levertijd als deep Module (capaciteit-seam owner met smal SQL-interface).
-- Plan: docs/superpowers/plans/2026-05-13-levertijd-als-deep-module.md (stap 2/10)
--
-- Levertijd-Module exporteert twee publieke RPC's voor frontend-consumers:
--
--   1. levertijd_fit_check(p_regel_ids, p_gewenste_week)
--      → per regel: haalbaar?, reden, eerstvolgend_haalbaar (ISO-week-string)
--      Use-case: live form-time check tijdens order-intake. Operator typt een
--      gewenste leverweek; deze RPC rapporteert per regel of die week haalbaar
--      is, en zo niet, welke week dan wél.
--
--   2. levertijd_snelste_haalbaar(p_regel_ids)
--      → per regel: snelste_haalbaar (ISO-week-string), spoed_uitleg
--      Use-case: "klant heeft haast" — toon snelste mogelijke leverweek per
--      regel, los van klant-standaard. Frontend gebruikt dit voor de
--      "overneem snelste" popover-flow.
--
-- Implementatie-grondslag — voorraad-pad (is_maatwerk=FALSE):
--   Deze RPC delegeert naar Reservering-Module's view `order_regel_levertijd`
--   (mig 150 → 156 → 269 → 270 → 273). Die view rapporteert per regel een
--   `verwachte_leverweek` als ISO-week-string ('YYYY-Www'-formaat) óf de
--   sentinel-waarde 'voorraad' (= onmiddellijk leverbaar — geen IO nodig)
--   óf NULL (= maatwerk of wacht_op_nieuwe_inkoop). Het `levertijd_status`-
--   veld onderscheidt die varianten: 'voorraad' | 'op_inkoop' |
--   'wacht_op_nieuwe_inkoop' | 'maatwerk'.
--
--   ISO-week-strings zijn lexicografisch sorteerbaar (jaar eerst, dan week
--   met zero-pad). `'2026-W05' < '2026-W12' < '2027-W01'` werkt correct.
--
-- Implementatie-grondslag — maatwerk-pad (is_maatwerk=TRUE):
--   TIJDELIJKE STUB. Capaciteit-match tegen open snijplannen +
--   productie_planning-config komt in mig 278 (stap 7 van het plan).
--   In deze skeleton:
--     - fit_check returnt haalbaar=TRUE met eerstvolgend_haalbaar = gewenste week
--     - snelste_haalbaar returnt huidige-week + 2 weken als veilige default
--
-- Idempotent: CREATE OR REPLACE FUNCTION voor beide RPC's.
-- VOORWAARDE: mig 156/269/270/273 (view order_regel_levertijd), mig 276
-- (levertijd-status-kolom + trigger).

-- ============================================================================
-- 1. levertijd_fit_check — per regel: haalbaar voor gewenste week?
-- ============================================================================

CREATE OR REPLACE FUNCTION levertijd_fit_check(
  p_regel_ids BIGINT[],
  p_gewenste_week TEXT
)
RETURNS TABLE (
  regel_id BIGINT,
  haalbaar BOOLEAN,
  reden TEXT,
  eerstvolgend_haalbaar TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels oreg     ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd v ON v.order_regel_id = i.regel_id
  )
  SELECT
    rd.regel_id,
    CASE
      -- TODO mig 278 (stap 7): vervang door capaciteit-match tegen open
      -- snijplannen + productie_planning-config (zie ADR-0020 / plan stap 7).
      WHEN COALESCE(rd.is_maatwerk, false) THEN TRUE
      -- Voorraad-pad: view's 'voorraad'-sentinel = onmiddellijk leverbaar voor élke week
      WHEN rd.verwachte_leverweek = 'voorraad' THEN TRUE
      -- Geen view-rij → regel onbekend of in eindstatus → conservatief haalbaar
      -- (view filtert eindstatus + admin-pseudo's; geen reden voor false-block hier)
      WHEN rd.verwachte_leverweek IS NULL AND rd.levertijd_status IS NULL THEN TRUE
      -- Wacht op nieuwe inkoop: niet haalbaar voor elke week (geen ETA bekend)
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN FALSE
      -- IO-claim aanwezig: lexicografische vergelijking ISO-week-strings
      WHEN rd.verwachte_leverweek IS NOT NULL
        THEN rd.verwachte_leverweek <= p_gewenste_week
      ELSE TRUE
    END AS haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN NULL
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN 'wacht op nieuwe inkoop'
      WHEN rd.verwachte_leverweek IS NOT NULL AND rd.verwachte_leverweek > p_gewenste_week
        THEN CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr
          ELSE 'op inkoop'
        END
      WHEN rd.levertijd_status = 'op_inkoop' THEN
        CASE WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr ELSE 'op inkoop' END
      ELSE NULL
    END AS reden,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN p_gewenste_week
      WHEN rd.verwachte_leverweek = 'voorraad' THEN p_gewenste_week
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN NULL
      WHEN rd.verwachte_leverweek IS NOT NULL THEN rd.verwachte_leverweek
      ELSE p_gewenste_week
    END AS eerstvolgend_haalbaar
  FROM regel_data rd;
END;
$$;

GRANT EXECUTE ON FUNCTION levertijd_fit_check(BIGINT[], TEXT) TO authenticated;

COMMENT ON FUNCTION levertijd_fit_check(BIGINT[], TEXT) IS
  'Levertijd-Module (ADR-0020, mig 277): per regel — haalbaar voor gewenste '
  'ISO-week? Voorraad-pad leest order_regel_levertijd-view (Reservering-Module '
  'eigendom). Maatwerk-pad is STUB (returnt altijd TRUE) — echte capaciteit-'
  'match volgt in mig 278 (stap 7). Retour: regel_id, haalbaar, reden, '
  'eerstvolgend_haalbaar (ISO-week-string).';

-- ============================================================================
-- 2. levertijd_snelste_haalbaar — per regel: snelst mogelijke leverweek
-- ============================================================================

CREATE OR REPLACE FUNCTION levertijd_snelste_haalbaar(
  p_regel_ids BIGINT[]
)
RETURNS TABLE (
  regel_id BIGINT,
  snelste_haalbaar TEXT,
  spoed_uitleg TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels oreg     ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd v ON v.order_regel_id = i.regel_id
  )
  SELECT
    rd.regel_id,
    CASE
      -- TODO mig 278 (stap 7): vervang door capaciteit-match tegen open
      -- snijplannen + productie_planning-config (zie ADR-0020 / plan stap 7).
      WHEN COALESCE(rd.is_maatwerk, false)
        THEN to_char(current_date + INTERVAL '2 weeks', 'IYYY-"W"IW')
      -- Voorraad-sentinel: onmiddellijk leverbaar → huidige ISO-week
      WHEN rd.verwachte_leverweek = 'voorraad'
        THEN to_char(current_date, 'IYYY-"W"IW')
      -- Geen view-rij of wacht_op_nieuwe_inkoop: geen ETA bekend
      WHEN rd.verwachte_leverweek IS NULL THEN NULL
      -- IO-claim: rapporteer view's verwachte_leverweek
      ELSE rd.verwachte_leverweek
    END AS snelste_haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false)
        THEN 'stub: maatwerk capaciteit-match volgt in stap 7'
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad onmiddellijk'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop'
        THEN 'wacht op nieuwe inkoop — geen ETA bekend'
      WHEN rd.verwachte_leverweek IS NOT NULL THEN
        CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'eerstvolgende IO ' || rd.eerste_io_nr
          ELSE 'eerstvolgende inkoop'
        END
      ELSE NULL
    END AS spoed_uitleg
  FROM regel_data rd;
END;
$$;

GRANT EXECUTE ON FUNCTION levertijd_snelste_haalbaar(BIGINT[]) TO authenticated;

COMMENT ON FUNCTION levertijd_snelste_haalbaar(BIGINT[]) IS
  'Levertijd-Module (ADR-0020, mig 277): per regel — snelst mogelijke ISO-week. '
  'Voorraad-pad leest order_regel_levertijd-view (Reservering-Module eigendom): '
  'voorraad-sentinel → huidige week, IO-claim → view''s verwachte_leverweek, '
  'wacht_op_nieuwe_inkoop → NULL. Maatwerk-pad is STUB (huidige week + 2 weken) '
  '— echte capaciteit-match volgt in mig 278 (stap 7). Retour: regel_id, '
  'snelste_haalbaar (ISO-week-string), spoed_uitleg.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 3. ASSERT-blok: smoke-tests
-- ============================================================================

DO $$
DECLARE
  v_fit_count INTEGER;
  v_snelste_count INTEGER;
  v_fit_cols INTEGER;
  v_snelste_cols INTEGER;
  v_empty_rows INTEGER;
BEGIN
  -- 1) Beide functies bestaan in pg_proc
  SELECT COUNT(*) INTO v_fit_count
    FROM pg_proc
   WHERE proname = 'levertijd_fit_check';
  ASSERT v_fit_count >= 1, 'levertijd_fit_check niet aangemaakt in pg_proc';

  SELECT COUNT(*) INTO v_snelste_count
    FROM pg_proc
   WHERE proname = 'levertijd_snelste_haalbaar';
  ASSERT v_snelste_count >= 1, 'levertijd_snelste_haalbaar niet aangemaakt in pg_proc';

  -- 2) Functies retourneren het verwachte aantal kolommen (4 resp. 3)
  SELECT array_length(proallargtypes, 1) - 2 INTO v_fit_cols
    FROM pg_proc
   WHERE proname = 'levertijd_fit_check'
   LIMIT 1;
  ASSERT v_fit_cols = 4,
    format('levertijd_fit_check retourneert %s OUT-kolommen, verwacht 4', v_fit_cols);

  SELECT array_length(proallargtypes, 1) - 1 INTO v_snelste_cols
    FROM pg_proc
   WHERE proname = 'levertijd_snelste_haalbaar'
   LIMIT 1;
  ASSERT v_snelste_cols = 3,
    format('levertijd_snelste_haalbaar retourneert %s OUT-kolommen, verwacht 3', v_snelste_cols);

  -- 3) Smoke-test met lege array: 0 rijen, geen error
  SELECT COUNT(*) INTO v_empty_rows
    FROM levertijd_fit_check(ARRAY[]::BIGINT[], '2026-W25');
  ASSERT v_empty_rows = 0,
    format('levertijd_fit_check(empty) gaf %s rijen, verwacht 0', v_empty_rows);

  SELECT COUNT(*) INTO v_empty_rows
    FROM levertijd_snelste_haalbaar(ARRAY[]::BIGINT[]);
  ASSERT v_empty_rows = 0,
    format('levertijd_snelste_haalbaar(empty) gaf %s rijen, verwacht 0', v_empty_rows);

  RAISE NOTICE 'Mig 277 OK: levertijd_fit_check + levertijd_snelste_haalbaar aangemaakt.';
  RAISE NOTICE '  - Voorraad-pad: delegate naar order_regel_levertijd-view (Reservering).';
  RAISE NOTICE '  - Maatwerk-pad: STUB — capaciteit-match volgt in mig 278 (stap 7).';
END $$;
