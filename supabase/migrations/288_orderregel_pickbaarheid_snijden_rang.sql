-- Migratie 288: orderregel_pickbaarheid — voeg ontbrekende status 'Snijden' toe aan slechtste_rang
--
-- Symptoom: maatwerk-orders met meerdere stuks "belanden tussen wal en schip".
-- Voorbeeld ORD-2026-2067 (regel 1, 5 stuks): 4 snijplannen 'Ingepakt', 1 nog
-- 'Snijden'. De order verdwijnt uit Pick & Ship ZONDER dat ergens een
-- 'wacht_op'-reden verschijnt — niet als "Wacht op snijden", nergens.
--
-- Root cause: de slechtste_rang-CASE in mig 170 mist de status 'Snijden'
-- (een geldige snijplan_status, toegevoegd in legacy mig 051 BEFORE 'Gesneden'
-- — de actief-aan-het-snijden-staat). Een snijplan op 'Snijden' valt in de
-- ELSE-tak → NULL. `MIN()` negeert NULL's. Dus voor een regel met 4× rang 7
-- (Ingepakt) + 1× NULL (Snijden) wordt slechtste_rang = MIN(7,7,7,7,NULL) = 7
-- → wacht_op = ELSE NULL.
--
-- Gevolg: is_pickbaar = (pickbaar_stuks=4 = totaal_stuks=5) = false  ✅ terecht,
-- maar wacht_op = NULL  ❌ — de view kan niet vertellen DAT/WAAROM het regel
-- wacht. De Pick & Ship-filter (fetchPickShipOrders) eist alle regels pickbaar,
-- dus de order verdwijnt geruisloos i.p.v. zichtbaar "Wacht op snijden" te zijn.
-- De kolom heet niet voor niets `slechtste_rang` ("wacht_op afgeleid van
-- slechtst-presterende snijplan", mig 170-comment) — die invariant was kapot
-- voor élke maatwerkregel met een 'Snijden'-stuk náást gevorderde stukken.
--
-- Fix: voeg `WHEN 'Snijden' THEN 2` toe. 'Snijden' hoort in de 'snijden'-
-- wacht_op-bucket (rang <= 2: de snede is nog niet voltooid). Rang 2 (gelijk
-- aan 'Gepland') is bewust gekozen: beide → wacht_op='snijden', en MIN trekt
-- slechtste_rang correct omlaag zodra één stuk nog gesneden wordt. Geen
-- hernummering van de overige statussen — alle bestaande drempels en gedrag
-- voor niet-'Snijden'-regels blijven identiek. is_pickbaar verandert NIET
-- (dat leunt op pickbaar_stuks/totaal_stuks, niet op slechtste_rang).
--
-- Verder volledig identiek aan mig 170. `CREATE OR REPLACE VIEW` overschrijft.

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT
    sp.order_regel_id,
    COUNT(*)                                          AS totaal_stuks,
    COUNT(*) FILTER (WHERE sp.status = 'Ingepakt')    AS pickbaar_stuks,
    MIN(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt') AS locatie,
    MIN(
      CASE sp.status
        WHEN 'Wacht'        THEN 1
        WHEN 'Gepland'      THEN 2
        WHEN 'Snijden'      THEN 2
        WHEN 'Gesneden'     THEN 3
        WHEN 'In confectie' THEN 4
        WHEN 'In productie' THEN 5
        WHEN 'Gereed'       THEN 6
        WHEN 'Ingepakt'     THEN 7
        ELSE NULL
      END
    ) AS slechtste_rang
  FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'
  GROUP BY sp.order_regel_id
),
voorraad_claim AS (
  SELECT
    rsv.order_regel_id,
    COUNT(*) AS aantal_actief
  FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad' AND rsv.status = 'actief'
  GROUP BY rsv.order_regel_id
),
rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr)
    r.artikelnr,
    ml.code AS code
  FROM rollen r
  JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar' AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id ASC
)
SELECT
  oreg.id            AS order_regel_id,
  oreg.order_id,
  oreg.regelnummer,
  oreg.artikelnr,
  oreg.is_maatwerk,
  oreg.orderaantal,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.omschrijving,
  oreg.maatwerk_kwaliteit_code,
  oreg.maatwerk_kleur_code,
  ma.totaal_stuks,
  ma.pickbaar_stuks,
  CASE
    WHEN oreg.is_maatwerk THEN
      COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
    ELSE
      COALESCE(vc.aantal_actief > 0, false)
  END AS is_pickbaar,
  CASE
    WHEN oreg.is_maatwerk         THEN 'snijplan'
    WHEN rl.code IS NOT NULL      THEN 'rol'
    WHEN p.locatie IS NOT NULL    THEN 'producten_default'
    ELSE NULL
  END AS bron,
  CASE
    WHEN oreg.is_maatwerk THEN ma.locatie
    ELSE COALESCE(rl.code, p.locatie)
  END AS fysieke_locatie,
  CASE
    WHEN oreg.is_maatwerk THEN
      CASE
        WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'
        WHEN ma.slechtste_rang <= 2 THEN 'snijden'
        WHEN ma.slechtste_rang <= 4 THEN 'confectie'
        WHEN ma.slechtste_rang <= 6 THEN 'inpak'
        ELSE NULL
      END
    ELSE
      CASE WHEN COALESCE(vc.aantal_actief, 0) = 0 THEN 'inkoop' ELSE NULL END
  END AS wacht_op
FROM order_regels oreg
JOIN orders o            ON o.id = oreg.order_id
LEFT JOIN producten p    ON p.artikelnr = oreg.artikelnr
LEFT JOIN maatwerk_aggr ma   ON ma.order_regel_id = oreg.id
LEFT JOIN voorraad_claim vc  ON vc.order_regel_id = oreg.id
LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd');

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron (snijplan|rol|producten_default), '
  'wacht_op (snijden|confectie|inpak|inkoop|null). Verenigt maatwerk- en standaard-paden. '
  'Mig 170; mig 288: status ''Snijden'' toegevoegd aan slechtste_rang (rang 2) — anders '
  'viel een nog-te-snijden stuk in ELSE→NULL en negeerde MIN() het, waardoor '
  'wacht_op ten onrechte NULL werd voor maatwerkregels met een ''Snijden''-stuk.';

NOTIFY pgrst, 'reload schema';
