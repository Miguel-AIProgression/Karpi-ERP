-- Migratie 475: idempotentie-sleutel voor uitgaand verzendbericht (DESADV)
-- wordt (order_id, zending_id) i.p.v. (bron_tabel, bron_id) op order-niveau.
--
-- Achtergrond
-- -----------
-- `bouw-verzendbericht-edi` bouwde tot nu toe één DESADV per ORDER (bron_tabel=
-- 'orders', bron_id=order_id) en pakte daarvoor willekeurig de eerste zending
-- (`.limit(1)` zonder ORDER BY). Bij een deelzending (order met ≥2 fysieke
-- zendingen) is dat dubbel fout: (1) de regel-inhoud kwam uit ALLE order_regels
-- met het volledige bestelde aantal, niet uit wat in déze zending daadwerkelijk
-- verzonden is, en (2) de bestaande partial unique index
-- `uk_edi_berichten_uitgaand_actief (berichttype, bron_tabel, bron_id)` liet
-- nooit een TWEEDE actief verzendbericht voor dezelfde order toe — een tweede
-- deelzending zou dus stil als "al_aanwezig" worden overgeslagen.
--
-- De edge function (zie supabase/functions/bouw-verzendbericht-edi/index.ts) is
-- in dezelfde wijziging herontwerpt naar de zending als eenheid: per
-- (zending, order)-paar één DESADV, regels uit `zending_regels` i.p.v.
-- `order_regels.orderaantal`. Deze migratie maakt dat op DB-niveau ook
-- daadwerkelijk afdwingbaar.
--
-- Wijziging
-- ---------
-- 1. De bestaande index dekt voortaan NIET meer 'verzendbericht' (de andere
--    berichttypes — order/orderbev/factuur — blijven ongewijzigd op
--    (bron_tabel, bron_id) gededuplceerd).
-- 2. Nieuwe partial unique index op de twee al-bestaande dedicated kolommen
--    `order_id`/`zending_id` (voorheen voor verzendbericht altijd NULL/alleen
--    order_id) — staat toe: meerdere orders in 1 bundel-zending (verschillende
--    order_id, zelfde zending_id) ÉN meerdere zendingen voor 1 deelzending-
--    order (zelfde order_id, verschillende zending_id).
--
-- Backwards-compatibel: voor een normale order (1 zending) is dit exact
-- gelijk aan de oude garantie — precies 1 actief verzendbericht. NULL-waarden
-- in een unique index worden door Postgres niet als gelijk beschouwd, dus de
-- ~100 bestaande verzendbericht-rijen met zending_id=NULL botsen niet met
-- elkaar of met nieuwe rijen.

DROP INDEX IF EXISTS uk_edi_berichten_uitgaand_actief;

CREATE UNIQUE INDEX uk_edi_berichten_uitgaand_actief
  ON public.edi_berichten (berichttype, bron_tabel, bron_id)
  WHERE (
    richting = 'uit'
    AND berichttype <> 'verzendbericht'
    AND status NOT IN ('Fout', 'Geannuleerd')
  );

CREATE UNIQUE INDEX uk_edi_berichten_verzendbericht_actief
  ON public.edi_berichten (order_id, zending_id)
  WHERE (
    richting = 'uit'
    AND berichttype = 'verzendbericht'
    AND status NOT IN ('Fout', 'Geannuleerd')
  );

-- Backfill: alle huidige verzendbericht-rijen hebben (geverifieerd) precies 1
-- zending per order — zending_id kan dus eenduidig ingevuld worden.
UPDATE edi_berichten eb
   SET zending_id = zo.zending_id
  FROM zending_orders zo
 WHERE eb.berichttype = 'verzendbericht'
   AND eb.zending_id IS NULL
   AND eb.order_id = zo.order_id;

NOTIFY pgrst, 'reload schema';
