-- Migratie 300: verzendweek-veld op snijplan_sticker_data (sticker-redesign mig 295 follow-up)
--
-- De pre-bestaande sticker had een verzendweek-referentie (bv. "2620" voor
-- jaar 26, week 20) die in mig 295 weggevallen was — wij wisten niet wat de
-- code betekende. Operations gebruikt hem o.a. voor batch-tracering en
-- snelle visuele identificatie van een sticker zonder QR/scancode.
--
-- Toegevoegd als ISO-formaat ('YYYY-Www') in de view zodat sortering stabiel
-- blijft; frontend formatteert naar 'YYWW' voor compactheid op de sticker.
-- Bron: orders.afleverdatum -> verzendweek_voor_datum (mig 228).

BEGIN;

CREATE OR REPLACE VIEW snijplan_sticker_data AS
WITH base AS (
  SELECT
    sp.id          AS snijplan_id,
    sp.snijplan_nr,
    sp.scancode,
    sp.status,
    o.id           AS order_id,
    o.order_nr,
    o.afleverdatum,
    o.debiteur_nr,
    d.naam         AS klant_naam,
    oreg.id        AS order_regel_id,
    oreg.maatwerk_lengte_cm  AS bestelde_lengte_cm,
    oreg.maatwerk_breedte_cm AS bestelde_breedte_cm,
    sp.lengte_cm   AS snij_lengte_cm,
    sp.breedte_cm  AS snij_breedte_cm,
    COALESCE(oreg.maatwerk_kwaliteit_code, r.kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
    COALESCE(oreg.maatwerk_kleur_code,     r.kleur_code,     p.kleur_code)     AS kleur_code
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  JOIN orders o          ON o.id    = oreg.order_id
  JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN producten p  ON p.artikelnr   = oreg.artikelnr
  LEFT JOIN rollen r     ON r.id          = sp.rol_id
)
SELECT
  b.snijplan_id,
  b.snijplan_nr,
  b.scancode,
  b.status,
  b.order_id,
  b.order_nr,
  b.order_regel_id,
  b.debiteur_nr,
  b.klant_naam,
  b.kwaliteit_code,
  b.kleur_code,
  COALESCE(b.bestelde_lengte_cm,  b.snij_lengte_cm)  AS lengte_cm,
  COALESCE(b.bestelde_breedte_cm, b.snij_breedte_cm) AS breedte_cm,
  COALESCE(
    resolve_klanteigen_naam(b.debiteur_nr, b.kwaliteit_code, b.kleur_code),
    k.omschrijving,
    b.kwaliteit_code
  ) AS kwaliteit_naam,
  k.poolmateriaal,
  sticker_ean_voor_kw_kl(b.kwaliteit_code, b.kleur_code) AS ean_code,
  -- Verzendweek-referentie voor de sticker (mig 300). NULL bij orders zonder
  -- afleverdatum; frontend toont dan niets.
  verzendweek_voor_datum(b.afleverdatum) AS verzendweek_iso
FROM base b
LEFT JOIN kwaliteiten k ON k.code = b.kwaliteit_code;

COMMENT ON VIEW snijplan_sticker_data IS
  'Mig 295 + 300: alle velden voor de klant-facing maatwerk-sticker in 1 row. '
  'Bron-van-waarheid voor wat op de sticker komt. verzendweek_iso (mig 300) '
  'wordt frontend-side naar YYWW geformatteerd voor de sticker-footer.';

COMMIT;

NOTIFY pgrst, 'reload schema';
