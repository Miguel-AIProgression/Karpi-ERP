-- Migratie 279: Werkagenda-rekenkunde in SQL — ground-truth voor werkdag-helpers
--
-- ADR-0020: Levertijd-Module als capaciteit-seam owner.
-- Plan:  docs/superpowers/plans/2026-05-13-levertijd-als-deep-module.md — stap 8.
--
-- ----------------------------------------------------------------------------
-- Wat deze migratie doet
-- ----------------------------------------------------------------------------
-- Levert de SQL-implementatie van werkdag-rekenkunde die tot nu toe alleen in
-- twee runtimes (Deno-edge `_shared/werkagenda.ts` + frontend
-- `frontend/src/lib/utils/bereken-agenda.ts`) leefde. Vanaf nu is **SQL de
-- ground-truth**; de TS- en Deno-mirrors blijven bestaan als synchrone
-- spiegels (UI-pad mag geen DB-roundtrip triggeren — Magazijn's `bucketVoor`
-- en honderden render-toetsen).
--
-- Geleverde functies:
--   * werkdag_offset_n(p_datum, p_n)  — canoniek: positief N = vooruit,
--                                       negatief N = achteruit. Skipt za/zo.
--   * werkdag_plus_n(p_datum, p_n)    — N werkdagen vooruit (offset_n(+n)).
--   * werkdag_min_n(p_datum, p_n)     — N werkdagen achteruit (offset_n(-n));
--                                       naam == gedrag == TS-mirror werkdagMinN.
--   * werkagenda_kalender(p_van, p_tot) — SETOF DATE van werkdagen in [van,tot].
--
-- ----------------------------------------------------------------------------
-- Werkdag-definitie
-- ----------------------------------------------------------------------------
-- Een "werkdag" = ma..vr (ISO-weekdag 1..5). Zaterdag/zondag tellen niet.
-- NL-feestdagen worden **niet** uitgesloten in deze versie — consistent met
-- de Deno-mirror (`_shared/werkagenda.ts`, STANDAARD_WERKTIJDEN met alleen
-- werkdagen 1..5, geen feestdag-tabel) en met de TS-default
-- (STANDAARD_WERKTIJDEN.vrij = []). Als er ooit een NL-feestdag-tabel
-- bijkomt, moet die op drie plekken tegelijk landen:
--   1) hier (SQL-functies),
--   2) supabase/functions/_shared/werkagenda.ts (Deno-mirror),
--   3) frontend/src/lib/utils/bereken-agenda.ts (TS-mirror).
--
-- ----------------------------------------------------------------------------
-- Bestaande functies — niet hercrëeren
-- ----------------------------------------------------------------------------
-- * iso_week_plus(date, int)         — mig 145 (ISO-week-string van datum+N weken)
-- * verzendweek_voor_datum(date)     — mig 228 (ISO-jaar+week voor afleverdatum)
-- Deze blijven canonical; geen duplicate hier.
--
-- ----------------------------------------------------------------------------
-- Idempotent: CREATE OR REPLACE voor alle functies.

-- ============================================================================
-- werkdag_offset_n: canonieke richting-neutrale werkdag-verschuiving
-- ============================================================================
-- Positief N = N werkdagen vooruit, negatief N = N werkdagen achteruit.
-- Dit is de ground-truth-implementatie; werkdag_plus_n / werkdag_min_n zijn
-- richting-expliciete wrappers zodat naam == gedrag (zie code-review S2,
-- ADR-0020): de oude `werkdag_min_n` telde bij positief N juist OP, wat
-- tegengesteld was aan de TS-mirror `werkdagMinN` (die N *aftrekt*). Nu klopt
-- werkdag_min_n(d, n) == d − n werkdagen, 1-op-1 met de mirror.
-- Stappen-cap (60) is een veiligheidsrem tegen pathologische input.
CREATE OR REPLACE FUNCTION werkdag_offset_n(p_datum DATE, p_n INTEGER)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_huidig   DATE := p_datum;
  v_richting INTEGER;
  v_resterend INTEGER;
  v_stappen INTEGER := 0;
BEGIN
  IF p_datum IS NULL OR p_n IS NULL OR p_n = 0 THEN
    RETURN p_datum;
  END IF;

  v_richting := CASE WHEN p_n > 0 THEN 1 ELSE -1 END;
  v_resterend := abs(p_n);

  WHILE v_resterend > 0 AND v_stappen < 60 LOOP
    v_huidig := v_huidig + v_richting;
    v_stappen := v_stappen + 1;
    -- EXTRACT(ISODOW FROM date) → 1=ma .. 7=zo. Werkdag = 1..5.
    IF EXTRACT(ISODOW FROM v_huidig) BETWEEN 1 AND 5 THEN
      v_resterend := v_resterend - 1;
    END IF;
  END LOOP;

  RETURN v_huidig;
END;
$$;

COMMENT ON FUNCTION werkdag_offset_n(DATE, INTEGER) IS
  'Mig 279 (ADR-0020): canonieke werkdag-verschuiving — positief N = vooruit, '
  'negatief N = achteruit. Skipt zaterdag/zondag. NL-feestdagen worden NIET '
  'uitgesloten — consistent met Deno-mirror _shared/werkagenda.ts en TS-mirror '
  'bereken-agenda.ts. SQL is ground-truth; wijzigingen aan werkdag-definitie '
  'ook in beide mirrors. Gebruik werkdag_plus_n / werkdag_min_n in callers.';

-- ============================================================================
-- werkdag_plus_n / werkdag_min_n: richting-expliciete wrappers
-- ============================================================================
-- werkdag_plus_n(d, n) = d + n werkdagen
-- werkdag_min_n(d, n)  = d − n werkdagen  (1-op-1 met TS-mirror werkdagMinN)
CREATE OR REPLACE FUNCTION werkdag_plus_n(p_datum DATE, p_n INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT werkdag_offset_n(p_datum, p_n);
$$;

COMMENT ON FUNCTION werkdag_plus_n(DATE, INTEGER) IS
  'Mig 279: N werkdagen vooruit. Wrapper rond werkdag_offset_n(d, +n).';

CREATE OR REPLACE FUNCTION werkdag_min_n(p_datum DATE, p_n INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT werkdag_offset_n(p_datum, -p_n);
$$;

COMMENT ON FUNCTION werkdag_min_n(DATE, INTEGER) IS
  'Mig 279: N werkdagen achteruit (d − n werkdagen). Wrapper rond '
  'werkdag_offset_n(d, -n). Naam == gedrag == TS-mirror werkdagMinN '
  '(code-review S2, ADR-0020).';

-- ============================================================================
-- werkagenda_kalender: alle werkdagen in [p_van, p_tot] inclusief
-- ============================================================================
CREATE OR REPLACE FUNCTION werkagenda_kalender(p_van DATE, p_tot DATE)
RETURNS SETOF DATE
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT d::DATE
  FROM generate_series(p_van, p_tot, INTERVAL '1 day') AS d
  WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5;
$$;

COMMENT ON FUNCTION werkagenda_kalender(DATE, DATE) IS
  'Mig 279: werkdag-set tussen twee data (inclusief). Skipt zaterdag/zondag. '
  'Bruikbaar voor capaciteit-loops in Levertijd-Module RPCs en bucket-fills.';

-- ============================================================================
-- Smoke-test (ASSERT-blok) — directe verificatie bij apply
-- ============================================================================
DO $$
BEGIN
  -- Canoniek vooruit: woe 13-05-2026 + 5 werkdagen → do 14, vr 15,
  -- (skip za/zo), ma 18, di 19, wo 20-05-2026.
  ASSERT werkdag_offset_n('2026-05-13'::DATE, 5) = '2026-05-20'::DATE,
    format('werkdag_offset_n(2026-05-13, +5) verwachtte 2026-05-20, kreeg %s',
           werkdag_offset_n('2026-05-13'::DATE, 5));

  -- Canoniek achteruit: woe 13-05-2026 − 2 werkdagen → di 12, ma 11-05-2026.
  ASSERT werkdag_offset_n('2026-05-13'::DATE, -2) = '2026-05-11'::DATE,
    format('werkdag_offset_n(2026-05-13, -2) verwachtte 2026-05-11, kreeg %s',
           werkdag_offset_n('2026-05-13'::DATE, -2));

  -- werkdag_plus_n: vrijdag 15-05-2026 + 1 werkdag → maandag 18-05-2026.
  ASSERT werkdag_plus_n('2026-05-15'::DATE, 1) = '2026-05-18'::DATE,
    format('werkdag_plus_n(vrij 2026-05-15, 1) verwachtte ma 2026-05-18, kreeg %s',
           werkdag_plus_n('2026-05-15'::DATE, 1));

  -- werkdag_min_n: maandag 18-05-2026 − 1 werkdag → vrijdag 15-05-2026.
  -- Naam == gedrag == TS-mirror werkdagMinN (aftrekken).
  ASSERT werkdag_min_n('2026-05-18'::DATE, 1) = '2026-05-15'::DATE,
    format('werkdag_min_n(ma 2026-05-18, 1) verwachtte vr 2026-05-15, kreeg %s',
           werkdag_min_n('2026-05-18'::DATE, 1));

  -- werkdag_min_n 5 werkdagen terug vanaf wo 13-05 → wo 06-05-2026
  -- (di 12, ma 11, vr 8, do 7, wo 6).
  ASSERT werkdag_min_n('2026-05-13'::DATE, 5) = '2026-05-06'::DATE,
    format('werkdag_min_n(2026-05-13, 5) verwachtte 2026-05-06, kreeg %s',
           werkdag_min_n('2026-05-13'::DATE, 5));

  -- N=0 → identity.
  ASSERT werkdag_offset_n('2026-05-13'::DATE, 0) = '2026-05-13'::DATE,
    'werkdag_offset_n(date, 0) moet identity zijn';

  -- NULL-safe.
  ASSERT werkdag_offset_n(NULL, 5) IS NULL, 'werkdag_offset_n(NULL, n) moet NULL retourneren';
  ASSERT werkdag_offset_n('2026-05-13'::DATE, NULL) = '2026-05-13'::DATE,
    'werkdag_offset_n(date, NULL) moet input retourneren';

  -- Wrapper-equivalentie: plus = offset(+n), min = offset(-n).
  ASSERT werkdag_plus_n('2026-05-13'::DATE, 5) = werkdag_offset_n('2026-05-13'::DATE, 5),
    'werkdag_plus_n(d, n) moet werkdag_offset_n(d, +n) zijn';
  ASSERT werkdag_min_n('2026-05-13'::DATE, 5) = werkdag_offset_n('2026-05-13'::DATE, -5),
    'werkdag_min_n(d, n) moet werkdag_offset_n(d, -n) zijn';

  -- Kalender-werkdagen ma 11 t/m vr 15 mei 2026 → exact 5 werkdagen.
  ASSERT (SELECT COUNT(*) FROM werkagenda_kalender('2026-05-11'::DATE, '2026-05-15'::DATE)) = 5,
    'werkagenda_kalender(ma..vr) moet 5 werkdagen geven';

  -- Kalender van vr 15 t/m ma 18 mei 2026 → 2 werkdagen (vr + ma).
  ASSERT (SELECT COUNT(*) FROM werkagenda_kalender('2026-05-15'::DATE, '2026-05-18'::DATE)) = 2,
    'werkagenda_kalender(vr..ma) moet 2 werkdagen geven (weekend overslaan)';
END $$;

NOTIFY pgrst, 'reload schema';
