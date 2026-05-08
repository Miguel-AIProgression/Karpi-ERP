-- Migratie 236: claims_voor_product RPC
--
-- Vervangt de 80-regel client-side orchestratie in
-- frontend/src/lib/supabase/queries/producten.ts (fetchClaimsVoorProduct).
-- De relationele logica (orderregels → claims → orders → debiteuren, met
-- IO-info via join op inkooporder_regels) hoort in SQL: één view-achtige
-- query, één round-trip, en de status-filter (`Verzonden`/`Geannuleerd`)
-- staat op de plek waar de bron-van-waarheid leeft.
--
-- Concept: per artikel alle actieve claims (bron='voorraad' of
-- 'inkooporder_regel') zien op order_regels die het artikel ofwel direct
-- bestellen (artikelnr) ofwel via omstickeren leveren (fysiek_artikelnr).

CREATE OR REPLACE FUNCTION claims_voor_product(p_artikelnr TEXT)
RETURNS TABLE (
  claim_id        BIGINT,
  bron            TEXT,
  aantal          INTEGER,
  inkooporder_nr  TEXT,
  verwacht_datum  DATE,
  order_id        BIGINT,
  order_nr        TEXT,
  order_status    TEXT,
  orderdatum      DATE,
  klant_naam      TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.id                AS claim_id,
    r.bron::TEXT        AS bron,
    r.aantal            AS aantal,
    io.inkooporder_nr   AS inkooporder_nr,
    io.verwacht_datum   AS verwacht_datum,
    o.id                AS order_id,
    o.order_nr          AS order_nr,
    o.status::TEXT      AS order_status,
    o.orderdatum        AS orderdatum,
    d.naam              AS klant_naam
  FROM order_reserveringen r
  JOIN order_regels reg     ON reg.id = r.order_regel_id
  JOIN orders o             ON o.id = reg.order_id
  LEFT JOIN debiteuren d    ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN inkooporder_regels ior ON ior.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ior.inkooporder_id
  WHERE r.status = 'actief'
    AND o.status NOT IN ('Verzonden', 'Geannuleerd')
    AND (reg.artikelnr = p_artikelnr OR reg.fysiek_artikelnr = p_artikelnr)
  ORDER BY o.orderdatum NULLS LAST, o.order_nr;
$$;

COMMENT ON FUNCTION claims_voor_product(TEXT) IS
  'Alle actieve claims (voorraad + inkooporder_regel) op order_regels die '
  'p_artikelnr direct bestellen of via omstickeren leveren. Filtert orders '
  'in eindstatus (Verzonden / Geannuleerd) eruit. Mig 236.';
