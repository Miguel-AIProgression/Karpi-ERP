-- Eénmalig opruim-script: bestaande Concept-facturen samenvoegen naar bundel-facturen
--
-- Probleem: vóór mig 252 enqueue'de `enqueue_factuur_voor_event` per order
-- één queue-rij. Bundel-zendingen met N orders kregen daardoor N losse
-- facturen i.p.v. 1. Dit script identificeert die N-tuples en regenereert
-- ze als 1 bundel-factuur via `genereer_factuur_voor_bundel`.
--
-- Veiligheid:
--   • Alleen facturen in status 'Concept' worden aangeraakt — Verstuurde of
--     Betaalde facturen blijven met rust (juridisch/audit-redenen).
--   • Alleen zendingen waar ALLE orders Concept-facturen hebben in deze set
--     worden gemerged. Een zending waar 1 order al Verstuurd is en 1 nog
--     Concept blijft buiten beeld — handmatig oplossen.
--   • Wrap in BEGIN/ROLLBACK zodat je eerst kunt droog-runnen.
--
-- VOORWAARDEN:
--   • Mig 234 toegepast (`genereer_factuur_voor_bundel` bestaat)
--   • Mig 252 toegepast (toekomstige bundels worden al goed gemaakt — anders
--     genereer je facturen die meteen weer vervuilen)
--
-- GEBRUIK:
--   1. Run het hele script. Het opent een transaction en eindigt met
--      `RAISE NOTICE 'Klaar — controleer en commit/rollback handmatig'`.
--      Het script COMMIT zelf NIET.
--   2. Bekijk de NOTICEs en de SELECT-output (hieronder) in de SQL Editor.
--   3. Als alles klopt: `COMMIT;`. Anders `ROLLBACK;`.

BEGIN;

-- =====================================================================
-- Stap 1: identificeer kandidaten
-- =====================================================================
-- Een bundel-kandidaat is een zending waarvan álle gekoppelde orders óók
-- ten minste 1 Concept-factuur hebben, en samen >1 distinct factuur tellen.

CREATE TEMP TABLE _merge_kandidaten ON COMMIT DROP AS
WITH zending_facturen AS (
  -- Voor elke (zending, order) — welke Concept-facturen wijzen hierop?
  SELECT DISTINCT
    z.id           AS zending_id,
    z.zending_nr,
    zo.order_id,
    f.id           AS factuur_id,
    f.factuur_nr,
    f.totaal
  FROM zendingen z
  JOIN zending_orders zo ON zo.zending_id = z.id
  JOIN factuur_regels fr ON fr.order_id = zo.order_id
  JOIN facturen f        ON f.id = fr.factuur_id
  WHERE f.status = 'Concept'
    AND COALESCE(fr.artikelnr, '') <> 'VERZEND'
),
zending_telling AS (
  SELECT
    zending_id,
    zending_nr,
    array_agg(DISTINCT order_id   ORDER BY order_id)   AS order_ids,
    array_agg(DISTINCT factuur_id ORDER BY factuur_id) AS oude_factuur_ids,
    array_agg(DISTINCT factuur_nr ORDER BY factuur_nr) AS oude_factuur_nrs,
    SUM(totaal)                                        AS oud_totaal_som,
    COUNT(DISTINCT factuur_id)                         AS aantal_facturen,
    COUNT(DISTINCT order_id)                           AS aantal_orders
  FROM zending_facturen
  GROUP BY zending_id, zending_nr
)
SELECT
  zt.*,
  -- Veiligheidscheck: dekken de Concept-facturen exact alle orders van de
  -- zending? Zo nee → zending overslaan (gemixt-status, handmatig fixen).
  (SELECT array_agg(zo2.order_id ORDER BY zo2.order_id)
     FROM zending_orders zo2
    WHERE zo2.zending_id = zt.zending_id) AS alle_orders_in_zending
FROM zending_telling zt
WHERE zt.aantal_facturen > 1;

-- Filter: alleen zendingen waar Concept-facturen alle bundle-orders dekken.
DELETE FROM _merge_kandidaten
 WHERE order_ids <> alle_orders_in_zending;

-- =====================================================================
-- Stap 2: dry-run rapport
-- =====================================================================
DO $$
DECLARE
  v_count INTEGER;
  v_facturen INTEGER;
  v_orders INTEGER;
BEGIN
  SELECT COUNT(*),
         COALESCE(SUM(aantal_facturen), 0),
         COALESCE(SUM(aantal_orders), 0)
    INTO v_count, v_facturen, v_orders
    FROM _merge_kandidaten;

  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'BUNDEL-MERGE DRY-RUN RAPPORT';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Te mergen zendingen   : %', v_count;
  RAISE NOTICE 'Oude facturen weg     : %', v_facturen;
  RAISE NOTICE 'Nieuwe facturen erbij : % (1 per zending)', v_count;
  RAISE NOTICE 'Orders herbericht     : %', v_orders;
  RAISE NOTICE '=================================================================';
END $$;

-- Detail per zending — toon dit aan gebruiker vóór COMMIT
SELECT
  zending_nr,
  aantal_facturen   AS oude_aantal,
  oude_factuur_nrs  AS worden_verwijderd,
  ROUND(oud_totaal_som, 2) AS oud_totaal_eur,
  array_length(order_ids, 1) AS aantal_orders
FROM _merge_kandidaten
ORDER BY zending_nr;

-- =====================================================================
-- Stap 3: uitvoeren — per kandidaat oude weg, nieuwe erin
-- =====================================================================
DO $$
DECLARE
  v_kandidaat       _merge_kandidaten%ROWTYPE;
  v_new_factuur_id  BIGINT;
  v_new_factuur_nr  TEXT;
  v_new_totaal      NUMERIC(12,2);
BEGIN
  FOR v_kandidaat IN SELECT * FROM _merge_kandidaten ORDER BY zending_nr
  LOOP
    RAISE NOTICE 'Mergen %: % oude facturen (%) → 1 bundel-factuur',
      v_kandidaat.zending_nr,
      v_kandidaat.aantal_facturen,
      v_kandidaat.oude_factuur_nrs;

    -- 3a. factuur_queue + edi_berichten FK losmaken (anders blokkeert
    --     RESTRICT op DELETE FROM facturen).
    UPDATE factuur_queue
       SET factuur_id = NULL
     WHERE factuur_id = ANY(v_kandidaat.oude_factuur_ids);

    UPDATE edi_berichten
       SET factuur_id = NULL
     WHERE factuur_id = ANY(v_kandidaat.oude_factuur_ids);

    -- 3b. Verwijder de oude facturen (factuur_regels gaan via CASCADE mee).
    DELETE FROM facturen
     WHERE id = ANY(v_kandidaat.oude_factuur_ids);

    -- 3c. Reset gefactureerd op de orderregels — bundel-RPC's no-op-guard
    --     check `gefactureerd < orderaantal` en zou anders blokkeren met
    --     "Zending heeft geen te-factureren regels".
    UPDATE order_regels
       SET gefactureerd = 0
     WHERE order_id = ANY(v_kandidaat.order_ids)
       AND COALESCE(artikelnr, '') <> 'VERZEND';

    -- 3d. Genereer de nieuwe bundel-factuur via mig 234 RPC.
    SELECT genereer_factuur_voor_bundel(v_kandidaat.zending_id)
      INTO v_new_factuur_id;

    SELECT factuur_nr, totaal INTO v_new_factuur_nr, v_new_totaal
      FROM facturen WHERE id = v_new_factuur_id;

    RAISE NOTICE '  → % (€ %) — was € %',
      v_new_factuur_nr,
      ROUND(v_new_totaal, 2),
      ROUND(v_kandidaat.oud_totaal_som, 2);
  END LOOP;
END $$;

-- =====================================================================
-- Stap 4: na-controle — toon nieuwe facturen + hun zending-koppeling
-- =====================================================================
-- We selecteren alle facturen die vandaag zijn aangemaakt; de nieuwe
-- bundel-facturen zitten daartussen. `aantal_orders_op_factuur` moet
-- overeenkomen met `aantal_orders_in_zending` voor de gemergede gevallen.

SELECT
  f.factuur_nr,
  f.debiteur_nr,
  f.totaal,
  f.status,
  (SELECT z.zending_nr
     FROM factuur_regels fr2
     JOIN zending_orders zo ON zo.order_id = fr2.order_id
     JOIN zendingen z       ON z.id = zo.zending_id
    WHERE fr2.factuur_id = f.id
      AND COALESCE(fr2.artikelnr, '') <> 'VERZEND'
    LIMIT 1) AS zending_nr,
  (SELECT COUNT(DISTINCT fr3.order_id)
     FROM factuur_regels fr3
    WHERE fr3.factuur_id = f.id
      AND COALESCE(fr3.artikelnr, '') <> 'VERZEND') AS aantal_orders_op_factuur
FROM facturen f
WHERE f.factuurdatum = CURRENT_DATE
ORDER BY f.factuur_nr;

-- ⚠ TRANSACTIE STAAT NOG OPEN — kies één van:
--   COMMIT;     -- alle wijzigingen worden definitief
--   ROLLBACK;   -- alles wordt teruggedraaid (oude facturen blijven staan)
