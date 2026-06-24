-- Mig 499: allocatie_opties_voor_artikel — live databron voor de uitgebreide
-- omsticker-keuze (3 soorten opties naast elkaar, gesorteerd op levertijd).
--
-- Pure, herevaluerende functie (geen state/snapshot, zelfde filosofie als
-- voorgestelde_zending_bundels mig 229) — combineert:
--   1) eigen artikel: open inkooporder_regels met ETA (bron='inkooporder_regel',
--      verwacht_datum gevuld) — bestond al als losse databron (IoLevertijdHint),
--      nu in dezelfde resultset.
--   2) equivalent artikel: nu op voorraad (bron='voorraad', verwacht_datum
--      NULL = direct leverbaar) — bestond al als UitwisselbaarTekortHint.
--   3) equivalent artikel: wacht op zíjn eigen inkoop met ETA — NIEUW, bestond
--      nergens als optie.
--
-- Equivalentie-matching mirrort EXACT de allocator (herallocateer_orderregel_auto
-- Stap 1.5, mig 497): zelfde collectie_id + kleur_code + breedte_cm + lengte_cm
-- + maatwerk_vorm_code. Bewust niet de iets afwijkende matching van
-- zoek_equivalente_producten (karpi_code-substring, mig 404) — deze functie
-- toont wat een gekozen optie straks ECHT claimt, dus moet exact aansluiten
-- op de allocator-criteria, niet op een parallelle definitie.

CREATE OR REPLACE FUNCTION allocatie_opties_voor_artikel(p_artikelnr TEXT)
RETURNS TABLE(
  bron TEXT,
  artikelnr TEXT,
  omschrijving TEXT,
  inkooporder_regel_id BIGINT,
  vrij_aantal INTEGER,
  verwacht_datum DATE
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_eigen_artikelnr    TEXT;
  v_stuks_artikelnr    TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       BIGINT;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
BEGIN
  -- Doos→stuks vertaling zoals de allocator (mig 408) — opties gaan altijd
  -- over het stuks-artikel, niet het doos-artikel.
  SELECT p0.stuks_artikelnr INTO v_stuks_artikelnr
    FROM producten p0 WHERE p0.artikelnr = p_artikelnr;
  v_eigen_artikelnr := COALESCE(v_stuks_artikelnr, p_artikelnr);

  -- Optie 2: eigen artikel, open inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, v_eigen_artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum
    FROM inkooporder_regels ir
    JOIN inkooporders io ON io.id = ir.inkooporder_id
    JOIN producten p ON p.artikelnr = ir.artikelnr
   WHERE ir.artikelnr = v_eigen_artikelnr
     AND ir.eenheid = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;

  -- Equivalentie-kenmerken van het eigen artikel bepalen.
  SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
    INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = v_eigen_artikelnr;

  IF v_collectie_id IS NULL OR v_kleur_code IS NULL THEN
    RETURN;
  END IF;

  -- Optie 1: equivalent, nu op voorraad.
  RETURN QUERY
  SELECT 'voorraad'::TEXT, p.artikelnr, p.omschrijving,
         NULL::BIGINT, p.vrije_voorraad, NULL::DATE
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.vrije_voorraad > 0
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
   ORDER BY p.vrije_voorraad DESC;

  -- Optie 3: equivalent, wacht op zíjn eigen inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, p.artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    JOIN inkooporder_regels ir ON ir.artikelnr = p.artikelnr
    JOIN inkooporders io ON io.id = ir.inkooporder_id
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
     AND ir.eenheid      = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;
END;
$function$;
