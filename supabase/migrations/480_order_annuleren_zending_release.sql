-- Migratie 480: order annuleren cascadeert ook naar een al-aangemaakte
-- zending/pickronde (ontbrekende derde cascade-tak, ADR-0023/mig 290-patroon).
--
-- Achtergrond
-- -----------
-- `markeer_geannuleerd` (mig 218) schrijft een `geannuleerd`-event in
-- `order_events`; daarop reageren tot nu toe twee ontkoppelde listeners:
--   - `trg_order_events_reservering_release` (mig 255) — releaset voorraad-
--     en IO-claims (`order_reserveringen`).
--   - `trg_order_events_snijplan_release` (mig 290) — annuleert snijplannen
--     en geeft rollen vrij.
-- Geen van beide raakt `zendingen`/`zending_regels`/`zending_colli`/
-- `zending_orders`. Gevonden tijdens het testen: een order met een actieve
-- pickronde (zending status 'Gepland' of 'Picken') die direct via "Annuleer
-- order" wordt geannuleerd, laat de zending **ongewijzigd** staan — een
-- weeskind dat verwijst naar een geannuleerde order, met colli/labels die
-- nooit meer relevant zijn.
--
-- Bevestigd door de gebruiker als bedoeld gedrag: "Als een order wordt
-- geannuleerd dan wordt alles geannuleerd... De aangemaakte pickronde /
-- zending wordt verwijderd." (mig 255/290 dekken de rest al correct.)
--
-- Scope — waarom alleen 'Gepland'/'Picken'
-- -----------------------------------------
-- `markeer_geannuleerd` blokkeert alleen op `status = 'Verzonden'` (niet ook
-- 'Deels verzonden') — een 'Deels verzonden'-order (1 zending al 'Klaar voor
-- verzending'/verder, een andere regel nog open) kan dus wél geannuleerd
-- worden. Een zending die al 'Klaar voor verzending' of verder is, is fysiek
-- al (deels) verzonden/aangemeld bij de vervoerder — die mag NOOIT door deze
-- cascade verwijderd worden (vergelijkbaar met `annuleer_pickronde`, mig 398,
-- dat ook alleen 'Picken' toestaat). Deze trigger raakt dus uitsluitend
-- zendingen die nog niet voltooid zijn.
--
-- Bundel-zending-bewust (mig 222): de cascade verwijdert alleen de regels/
-- colli die bij de GEANNULEERDE order horen + de `zending_orders`-koppeling.
-- Blijft de zending daarna gekoppeld aan een andere (niet-geannuleerde) order
-- in de bundel, dan blijft de zending zelf bestaan (met herberekende
-- aantal_colli/totaal_gewicht_kg) — alleen wanneer de geannuleerde order de
-- ENIGE order op de zending was, vervalt de hele zending.
--
-- Geen "niets-gepickt"-guard (anders dan `annuleer_pickronde`): een order
-- annuleren is een definitieve, zwaardere actie dan de "per ongeluk
-- gestart"-correctieknop — eventuele al-gescande colli van een geannuleerde
-- order zijn sowieso niet meer relevant.

CREATE OR REPLACE FUNCTION public.trg_order_events_zending_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_zending_id BIGINT;
  v_regel_ids  BIGINT[];
BEGIN
  IF NEW.event_type <> 'geannuleerd' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(id) INTO v_regel_ids
    FROM order_regels WHERE order_id = NEW.order_id;

  IF v_regel_ids IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_zending_id IN
    SELECT DISTINCT z.id
      FROM zendingen z
      JOIN zending_orders zo ON zo.zending_id = z.id
     WHERE zo.order_id = NEW.order_id
       AND z.status IN ('Gepland', 'Picken')
  LOOP
    DELETE FROM zending_colli
     WHERE zending_id = v_zending_id
       AND order_regel_id = ANY(v_regel_ids);

    DELETE FROM zending_regels
     WHERE zending_id = v_zending_id
       AND order_regel_id = ANY(v_regel_ids);

    DELETE FROM zending_orders
     WHERE zending_id = v_zending_id
       AND order_id = NEW.order_id;

    IF NOT EXISTS (SELECT 1 FROM zending_orders WHERE zending_id = v_zending_id) THEN
      -- Geannuleerde order was de enige op deze zending — de hele zending vervalt.
      DELETE FROM zendingen WHERE id = v_zending_id;
    ELSE
      -- Bundel: andere order(s) blijven op deze zending staan. Herberekenen
      -- wat overblijft (zelfde stijl als start_pickronden's eigen INSERT).
      UPDATE zendingen z
         SET aantal_colli = (
               SELECT COUNT(*)::INTEGER FROM zending_colli WHERE zending_id = z.id
             ),
             totaal_gewicht_kg = (
               SELECT NULLIF(ROUND(COALESCE(SUM(gewicht_kg), 0), 2), 0)
                 FROM zending_colli WHERE zending_id = z.id
             )
       WHERE z.id = v_zending_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_events_zending_release ON order_events;
CREATE TRIGGER trg_order_events_zending_release
  AFTER INSERT ON order_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'geannuleerd')
  EXECUTE FUNCTION trg_order_events_zending_release();

-- Eenmalige backfill: ZEND-2026-0197 (order ORD-2026-0820, geannuleerd vóór
-- deze migratie) is precies het weeskind dat deze trigger voortaan voorkomt.
-- Live geverifieerd: dit is de ENIGE bestaande zending in 'Gepland'/'Picken'
-- waarvan alle gekoppelde orders al 'Geannuleerd' zijn.
DO $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  SELECT z.id INTO v_zending_id
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
    JOIN orders o ON o.id = zo.order_id
   WHERE z.zending_nr = 'ZEND-2026-0197'
     AND z.status = 'Picken'
   GROUP BY z.id
  HAVING bool_and(o.status = 'Geannuleerd');

  IF v_zending_id IS NOT NULL THEN
    DELETE FROM zending_colli WHERE zending_id = v_zending_id;
    DELETE FROM zending_regels WHERE zending_id = v_zending_id;
    DELETE FROM zending_orders WHERE zending_id = v_zending_id;
    DELETE FROM zendingen WHERE id = v_zending_id;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
