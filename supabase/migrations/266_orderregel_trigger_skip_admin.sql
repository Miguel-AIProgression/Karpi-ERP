-- Migratie 266: trg_orderregel_herallocateer slaat admin-artikelnrs over
--
-- Probleem: bij INSERT van een orderregel met artikelnr ∈
-- (VERZEND, BUNDELKORTING, DREMPELKORTING) fired AFTER INSERT-trigger
-- trg_orderregel_herallocateer (mig 146) → herallocateer_orderregel(NEW.id)
-- → herwaardeer_order_status → herwaardeer_claims_voor_order → loop alle
-- niet-admin regels → herallocateer_orderregel → ... stack-depth-error.
--
-- Mig 263 voegde reeds een admin-filter toe in herwaardeer_claims_voor_order,
-- maar pakt alleen het pad waarbij admin-regels ZELF in de loop voorkomen.
-- De cyclus die start vanaf trigger A's PERFORM herallocateer_orderregel(NEW.id)
-- voor een admin-regel-INSERT blijft draaien zodra een product-regel via die
-- weg de loop binnen komt.
--
-- Fix: admin-regels hebben sowieso geen claim-allocatie nodig (te_leveren=0,
-- gefactureerd=1). Skip trigger A volledig voor deze artikelnrs.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- VOORWAARDE: mig 146 toegepast.

CREATE OR REPLACE FUNCTION trg_orderregel_herallocateer()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Alle claims worden vanzelf cascade-deleted door FK ON DELETE CASCADE.
    -- Producten.gereserveerd resync gebeurt via trigger C.
    RETURN OLD;
  END IF;

  -- Mig 266: admin-pseudo-producten kennen geen voorraad/IO-allocatie. Skip
  -- om N²-recursie via herallocateer_orderregel → herwaardeer_order_status →
  -- herwaardeer_claims_voor_order → herallocateer_orderregel te voorkomen.
  IF COALESCE(NEW.artikelnr, '') IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING') THEN
    RETURN NEW;
  END IF;

  -- Trigger op zowel artikelnr- als te_leveren-wijziging
  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_orderregel_herallocateer() IS
  'Mig 146 + Mig 266: order_regels INSERT/UPDATE/DELETE trigger-handler. Roept '
  'herallocateer_orderregel aan bij claim-relevante mutaties. Admin-pseudo-'
  'producten (VERZEND/BUNDELKORTING/DREMPELKORTING) worden overgeslagen omdat '
  'die geen voorraad/IO-allocatie hebben. Sinds mig 267 (wrapper-revert) bestaat '
  'de oorspronkelijke N²-recursie niet meer; deze filter blijft als defensieve '
  'guard én scheelt onnodig werk in herallocateer_orderregel voor admin-regels. '
  'Symmetrisch met mig 263 (filter binnen herwaardeer_claims_voor_order).';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Mig 266 toegepast: trg_orderregel_herallocateer slaat admin-artikelnrs over.';
END $$;
