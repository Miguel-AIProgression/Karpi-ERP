-- Migratie 434: admin-pseudo-regels (dropship/VERZEND/korting) horen NIET in een
-- fysieke zending — één enforcement-punt op zending_regels.
--
-- PROBLEEM (melding 19-06-2026, ORD-2026-0305 / ZEND-2026-0105):
-- Een dropship-order (DROPSHIP-KLEIN/-GROOT) telde de dropshipment-kostenregel
-- mee als fysiek collo. Gevolg: 2 colli i.p.v. 1, een extra verzendlabel
-- ("DROPSHIPMENT 1 VAN 2"), aantal_colli op de pakbon te hoog, en de
-- dropship-regel verscheen als pakbon-onderregel.
--
-- ROOT CAUSE (ADR-0018-valkuil): de zending-/colli-pijplijn filtert op de
-- HARDCODED string `artikelnr <> 'VERZEND'` (mig 206 / mig 225
-- effectieve_vervoerder_per_orderregel) i.p.v. het generieke predikaat
-- NOT is_admin_pseudo(). VERZEND wordt zo wél geweerd, maar een dropship-regel
-- (zelfde admin-pseudo-klasse, is_pseudo=TRUE — mig 353/370, maar ander
-- artikelnr) glipt door de VERZEND-specifieke filter heen → belandt in
-- zending_regels → genereer_zending_colli (mig 419) maakt er een collo van.
--
-- Dezelfde categorie als de andere ADR-0018-rewrites (mig 263→266→269→273):
-- elke admin-pseudo-string-lijst hoort is_admin_pseudo() te zijn.
--
-- FIX: één invariant, afgedwongen op de bron-tabel i.p.v. in elk van de vier
-- insert-paden (start_pickronden mig 248, start_pickronden_voor_order +
-- start_deelzending mig 413, create_zending_voor_order mig 206). Een
-- BEFORE INSERT-trigger op zending_regels weert élke admin-pseudo-regel —
-- huidige én toekomstige insert-paden. Dit generaliseert wat mig 206
-- bewust voor VERZEND deed ("VERZEND blijft buiten de zending: het is een
-- factuurregel, geen pakbon-/colli-regel") naar de hele admin-pseudo-klasse.
--
-- Omdat zending_regels voortaan alleen fysieke regels bevat, ziet
-- genereer_zending_colli (die over zending_regels loopt) nooit meer een
-- admin-pseudo-regel → geen collo, geen label, geen pakbon-onderregel.
-- Eén punt, alle downstream-consumenten correct.
--
-- NULL-veilig: maatwerk-regels hebben artikelnr=NULL; is_admin_pseudo(NULL)
-- → FALSE (mig 272), dus die blijven gewoon in de zending.
--
-- FORWARD-ONLY (zoals mig 206): bestaande zendingen worden NIET retroactief
-- opgeschoond — die zijn al gepickt/geprint/aangemeld en het magazijn handelt
-- ze fysiek af. Voor een nog-niet-aangemelde lopende zending: zie de
-- handmatige remediatie-notitie onderaan.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.

-- ============================================================================
-- §1. Trigger-functie — skip admin-pseudo bij INSERT op zending_regels
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_zending_regels_skip_admin_pseudo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- BEFORE INSERT die NULL teruggeeft, slaat deze rij stilletjes over.
  -- Admin-pseudo (VERZEND/DROPSHIP-*/BUNDELKORTING/DREMPELKORTING) = factuur-/
  -- administratieve regel, geen fysiek collo → mag geen shipment-membership zijn.
  IF is_admin_pseudo(
       (SELECT artikelnr FROM order_regels WHERE id = NEW.order_regel_id)
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_zending_regels_skip_admin_pseudo() IS
  'Mig 434 (ADR-0018): houdt admin-pseudo-orderregels (VERZEND/DROPSHIP-*/'
  'korting, via is_admin_pseudo()) uit zending_regels. Generaliseert de '
  'VERZEND-specifieke filter van mig 206 naar de hele admin-pseudo-klasse, zodat '
  'ze nooit als collo/label/pakbon-onderregel verschijnen. NULL-veilig: maatwerk '
  '(artikelnr NULL) → is_admin_pseudo FALSE → blijft.';

-- ============================================================================
-- §2. Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_zending_regels_skip_admin_pseudo ON zending_regels;

CREATE TRIGGER trg_zending_regels_skip_admin_pseudo
  BEFORE INSERT ON zending_regels
  FOR EACH ROW
  EXECUTE FUNCTION fn_zending_regels_skip_admin_pseudo();

-- ============================================================================
-- §3. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_skip BIGINT;
BEGIN
  -- Hoeveel admin-pseudo-regels zitten er NU nog in actieve (niet-verzonden)
  -- zendingen? Puur informatief — forward-only, geen auto-cleanup.
  SELECT COUNT(*) INTO v_skip
  FROM zending_regels zr
  JOIN zendingen z       ON z.id = zr.zending_id
  JOIN order_regels ore  ON ore.id = zr.order_regel_id
  WHERE is_admin_pseudo(ore.artikelnr)
    AND z.status NOT IN ('Onderweg', 'Afgeleverd');
  RAISE NOTICE 'Mig 434: trigger actief. Bestaande admin-pseudo-regels in '
    'actieve zendingen (niet auto-opgeschoond): %', v_skip;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- HANDMATIGE REMEDIATIE (optioneel, per lopende zending)
-- ============================================================================
-- Voor een zending die NOG NIET bij de vervoerder is aangemeld en waarvan de
-- labels nog niet fysiek gebruikt zijn, kan de admin-pseudo-collo + membership
-- verwijderd worden. Doe dit ALLEEN bewust per zending (SSCC's staan mogelijk
-- al op geprinte labels):
--
--   -- 1. Verwijder de admin-pseudo-colli van de zending
--   DELETE FROM zending_colli zc
--    USING order_regels ore
--    WHERE zc.zending_id = <ZENDING_ID>
--      AND zc.order_regel_id = ore.id
--      AND is_admin_pseudo(ore.artikelnr);
--
--   -- 2. Verwijder de admin-pseudo-membership
--   DELETE FROM zending_regels zr
--    USING order_regels ore
--    WHERE zr.zending_id = <ZENDING_ID>
--      AND zr.order_regel_id = ore.id
--      AND is_admin_pseudo(ore.artikelnr);
--
--   -- 3. Herstel aantal_colli (en eventueel totaal_gewicht_kg) naar de
--   --    overgebleven fysieke colli
--   UPDATE zendingen z
--      SET aantal_colli = (SELECT COUNT(*) FROM zending_colli
--                           WHERE zending_id = z.id AND bundel_colli_id IS NULL)
--    WHERE z.id = <ZENDING_ID>;
