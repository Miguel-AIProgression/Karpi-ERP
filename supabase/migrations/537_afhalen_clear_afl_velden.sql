-- Mig 537: Opschonen afl_*-velden op afhalen-orders en hun zendingen
--
-- Deeltaak A: bundel-lock trigger bypass voor afhalen-orders.
-- `trg_lock_zending_bundel_sleutel` (mig 230) blokkeert afl_*-mutaties op
-- orders met een actieve bundel-zending. Afhalen-orders participeren nooit in
-- adres-gebaseerde bundeling (geen vervoerder, aparte 'AFHAAL'-sleutel), dus
-- de lock is hier zinloos en hindert de opschoon-UPDATE hieronder.
-- Oplossing: vroege RETURN NEW als NEW.afhalen = TRUE.

CREATE OR REPLACE FUNCTION trg_lock_zending_bundel_sleutel()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Afhalen-orders bundelen nooit op adres — lock is hier niet van toepassing.
  IF NEW.afhalen = TRUE THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = NEW.id
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
  ) OR EXISTS (
    SELECT 1
      FROM zendingen z
     WHERE z.order_id = NEW.id
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Order % is gelocked: actieve bundel-zending bestaat al — wijziging van afleverdatum/afleveradres/debiteur niet toegestaan',
      NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- Mig 537: Opschonen afl_*-velden op afhalen-orders en hun zendingen
--
-- Bij afhalen-orders is er geen afleveradres — de klant haalt zelf op bij
-- Karpi (Tweede Broekdijk 10, Aalten). De afl_*-velden waren gevuld met het
-- eigen adres van de klant (overgenomen vanuit het klantprofiel bij aanmaken).
-- Dat klopt niet: het afleveradres bij afhalen ís Karpi's eigen adres, en de
-- UI/documenten leiden dat nu ook zo af (order-addresses.tsx, orderbevestiging).
-- Bewust: ook al-verzonden ('Verzonden'/'Afgehaald') orders worden opgeschoond
-- — puur historische cleanup, de orders zijn al afgehandeld.
--
-- 73 orders geraakt (alle hebben afl_* gevuld met klantadres);
-- zendingen-snapshot meegereinigd zodat pakbonnen van lopende afhalen-orders
-- ook het juiste (lege) adres zien.

-- 1. Orders: wis alle afl_*-velden
UPDATE orders
SET
  afl_naam      = NULL,
  afl_naam_2    = NULL,
  afl_adres     = NULL,
  afl_postcode  = NULL,
  afl_plaats    = NULL,
  afl_land      = NULL,
  afl_email     = NULL,
  afl_telefoon  = NULL
WHERE afhalen = TRUE;

-- 2. Zendingen: wis de snapshot-velden die vanuit het order zijn overgenomen
UPDATE zendingen z
SET
  afl_naam     = NULL,
  afl_adres    = NULL,
  afl_postcode = NULL,
  afl_plaats   = NULL,
  afl_land     = NULL,
  afl_telefoon = NULL,
  afl_email    = NULL
FROM zending_orders zo
JOIN orders o ON o.id = zo.order_id
WHERE zo.zending_id = z.id
  AND o.afhalen = TRUE;
