-- Migratie 532: BEFORE-trigger vult maatwerk_kwaliteit/kleur_code vanuit product
--
-- Waarom
-- ------
-- release_gepland_stukken filtert op:
--   orr.maatwerk_kwaliteit_code = p_kwaliteit_code
--   orr.maatwerk_kleur_code     = ANY(v_kleur_varianten)
-- NULL matcht nooit — een maatwerk-stuk met NULL kw/kl kan nooit worden
-- vrijgegeven door auto-plan-groep, en wordt daarmee een permanent bevroren
-- "weesje" (status=Gepland, rol_id gevuld, nooit meer herplanbaar).
--
-- Aanleiding: 71 order_regels uit de oud-systeem-import hadden
-- maatwerk_kwaliteit_code IS NULL (mig 531 fixte de view; data-repair vulde
-- de 71 regels handmatig). Deze trigger borgt dat het niet opnieuw kan
-- ontstaan via welk kanaal dan ook (UI, EDI, Shopify, directe INSERT).
--
-- Gedrag
-- ------
-- BEFORE INSERT OR UPDATE op order_regels.
-- Conditie (via WHEN): NEW.is_maatwerk = TRUE.
-- Als maatwerk_kwaliteit_code IS NULL EN artikelnr IS NOT NULL:
--   → vul vanuit producten.kwaliteit_code
-- Als maatwerk_kleur_code IS NULL EN artikelnr IS NOT NULL:
--   → vul vanuit producten.kleur_code
-- Beide zijn idempotent: als de waarde al ingesteld is, niks doen.
--
-- Samenspel met bestaande triggers
-- ---------------------------------
-- trg_auto_maak_snijplan (AFTER INSERT/UPDATE, mig 110/323):
--   Leest na onze BEFORE de al-gevulde mw_kw/kl — correct ✓
-- trg_auto_sync_snijplan_maten (AFTER UPDATE van mw_kw op order_regels, mig 323):
--   Vuurt als mw_kw hier van NULL naar een waarde gaat (UPDATE-pad) →
--   synct bestaande snijplan-maten — gewenst gedrag ✓
-- release_gepland_stukken / fetchStukken:
--   Zien voortaan altijd een non-NULL mw_kw → can't freeze ✓

CREATE OR REPLACE FUNCTION fn_order_regels_maatwerk_kw_fallback()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_kw TEXT;
  v_kl TEXT;
BEGIN
  -- Alleen actief als is_maatwerk=TRUE én er een artikelnr is om op te zoeken
  IF NEW.artikelnr IS NOT NULL THEN
    IF NEW.maatwerk_kwaliteit_code IS NULL OR NEW.maatwerk_kleur_code IS NULL THEN
      SELECT kwaliteit_code, kleur_code
        INTO v_kw, v_kl
        FROM producten
       WHERE artikelnr = NEW.artikelnr;

      IF NEW.maatwerk_kwaliteit_code IS NULL THEN
        NEW.maatwerk_kwaliteit_code := v_kw;
      END IF;
      IF NEW.maatwerk_kleur_code IS NULL THEN
        NEW.maatwerk_kleur_code := v_kl;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- WHEN-conditie beperkt de body-uitvoering tot is_maatwerk=TRUE rijen;
-- UPDATE zonder wijziging in is_maatwerk/mw-velden loopt nooit door de body.
DROP TRIGGER IF EXISTS trg_order_regels_maatwerk_kw_fallback ON order_regels;

CREATE TRIGGER trg_order_regels_maatwerk_kw_fallback
  BEFORE INSERT OR UPDATE
  ON order_regels
  FOR EACH ROW
  WHEN (NEW.is_maatwerk = TRUE)
  EXECUTE FUNCTION fn_order_regels_maatwerk_kw_fallback();
