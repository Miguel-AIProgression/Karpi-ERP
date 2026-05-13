-- Migratie 265: pseudo-producten voor verzendkosten + bundel-korting
--
-- Achtergrond: factuur- én orderregel-mirror gebruiken vaste artikelnrs als FK
-- naar `producten` voor:
--   · 'VERZEND'         → de per-order verzend-orderregel (al lang in gebruik)
--   · 'BUNDELKORTING'   → totaal-niveau korting bij bundel-zending (mig 262 V2)
--   · 'DREMPELKORTING'  → cadeau-regel bij `gratis_drempel`-status (mig 262 V2)
--
-- BUNDELKORTING/DREMPELKORTING zijn op de live DB handmatig ingevoegd, niet via
-- een migratie. Bij een fresh deploy ontbreken ze waardoor de eerste bundel-
-- factuur op de FK-constraint `factuur_regels_artikelnr_fkey` of
-- `order_regels_artikelnr_fkey` crasht. Deze migratie sluit dat gat.
--
-- VERZEND wordt voor de zekerheid óók idempotent verzekerd — bestaande rij
-- wordt niet aangepast (ON CONFLICT DO NOTHING).
--
-- Idempotent: INSERT ... ON CONFLICT (artikelnr) DO NOTHING.

INSERT INTO producten (artikelnr, omschrijving, product_type, actief)
VALUES
  ('VERZEND',         'Verzendkosten',                       'overig', true),
  ('BUNDELKORTING',   'Bundelkorting verzending (correctie)', 'overig', true),
  ('DREMPELKORTING',  'Drempelkorting verzending (cadeau)',   'overig', true)
ON CONFLICT (artikelnr) DO NOTHING;

DO $$
DECLARE
  v_aantal INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_aantal
    FROM producten
   WHERE artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');
  RAISE NOTICE 'Mig 265: % van 3 pseudo-producten aanwezig na deploy.', v_aantal;
END $$;
