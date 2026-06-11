-- Migratie 366: backfill fact_email + afl_email op bestaande open orders
--
-- Mig 364 vult beide e-mail-snapshots alleen bij NIEUWE orders (via de
-- order-RPC's); orders van vóór die migratie staan leeg — geen factuur-e-mail
-- zichtbaar en géén track & trace vanuit de vervoerder (mig 365). Deze backfill
-- vult bestaande open orders met exact dezelfde ladder als het orderformulier:
--
--   fact_email: debiteuren.email_factuur → fallback debiteuren.email_overig
--   afl_email:  afleveradressen.email van het matchende afleveradres
--               (adres-snapshot-match via _normaliseer_afleveradres, mig 222)
--               → fallback debiteuren.email_overig
--
-- Guards:
--   * Alleen vullen waar leeg — nooit een bewust ingevuld adres overschrijven.
--   * Eindstatussen (Verzonden/Geannuleerd) overgeslagen — geen zending meer.
--   * `debiteur_match_bron='env_fallback'`-orders (verzameldebiteur,
--     consumenten-webshop) overgeslagen: de debiteur-e-mail is daar de
--     verzameldebiteur, niet de klant — een verkeerd T&T-adres is erger dan
--     geen. Consument-e-mails komen daar al uit de webshop-payload.
--
-- Sluit af met een herhaling van de mig 365-zending-backfill zodat
-- nog-niet-verstuurde zendingen het zojuist gevulde order-e-mailadres
-- alsnog als snapshot krijgen.
--
-- Idempotent (alle UPDATEs filteren op "nog leeg").

-- 1. fact_email uit debiteuren (email_factuur → email_overig)
UPDATE orders o
   SET fact_email = COALESCE(
         NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
         NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
       )
  FROM debiteuren d
 WHERE d.debiteur_nr = o.debiteur_nr
   AND NULLIF(TRIM(COALESCE(o.fact_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND COALESCE(o.debiteur_match_bron, '') <> 'env_fallback'
   AND COALESCE(
         NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
         NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
       ) IS NOT NULL;

-- 2a. afl_email uit het matchende afleveradres (laagste adres_nr wint bij
--     meerdere matches; adres_nr 0 = hoofdadres)
UPDATE orders o
   SET afl_email = (
         SELECT NULLIF(TRIM(COALESCE(a.email, '')), '')
           FROM afleveradressen a
          WHERE a.debiteur_nr = o.debiteur_nr
            AND NULLIF(TRIM(COALESCE(a.email, '')), '') IS NOT NULL
            AND _normaliseer_afleveradres(a.adres, a.postcode, a.land)
              = _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
          ORDER BY a.adres_nr
          LIMIT 1
       )
 WHERE NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND EXISTS (
         SELECT 1
           FROM afleveradressen a
          WHERE a.debiteur_nr = o.debiteur_nr
            AND NULLIF(TRIM(COALESCE(a.email, '')), '') IS NOT NULL
            AND _normaliseer_afleveradres(a.adres, a.postcode, a.land)
              = _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
       );

-- 2b. afl_email fallback: algemeen klant-e-mailadres (zoals het formulier doet
--     wanneer het gekozen afleveradres geen eigen e-mail heeft)
UPDATE orders o
   SET afl_email = NULLIF(TRIM(COALESCE(d.email_overig, '')), '')
  FROM debiteuren d
 WHERE d.debiteur_nr = o.debiteur_nr
   AND NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND COALESCE(o.debiteur_match_bron, '') <> 'env_fallback'
   AND NULLIF(TRIM(COALESCE(d.email_overig, '')), '') IS NOT NULL;

-- 3. Zending-snapshots bijwerken (herhaalt de mig 365-backfill, nu mét de
--    zojuist gevulde order-e-mailadressen)
UPDATE zendingen z
   SET afl_email = NULLIF(TRIM(COALESCE(o.afl_email, '')), '')
  FROM orders o
 WHERE o.id = z.order_id
   AND NULLIF(TRIM(COALESCE(z.afl_email, '')), '') IS NULL
   AND z.status NOT IN ('Onderweg', 'Afgeleverd')
   AND NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NOT NULL;

NOTIFY pgrst, 'reload schema';
