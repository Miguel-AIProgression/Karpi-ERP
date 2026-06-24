-- Migratie 496: optioneel pakbon-e-mailadres op debiteuren (klantverzoek 24-06-2026)
--
-- (Hernummerd van 492 → 496 bij merge: de vertegenwoordiger-RLS-branch claimde
--  492-495 op main. De kolom is op 24-06 al op prod toegepast als de
--  email_pakbon-wijziging; ADD COLUMN IF NOT EXISTS = veilig opnieuw te draaien.)
--
-- De klant wil per documenttype een e-mailadres kunnen vastleggen op de
-- klantkaart. Factuur (email_factuur), orderbevestiging (email_overig) en
-- verzending/T&T (email_verzend, mig 369) bestonden al; de pakbon had geen
-- eigen veld.
--
-- Scope bewust beperkt tot het VASTLEGGEN van het adres. De huidige
-- pakbon-stroom blijft ongewijzigd: de pakbon gaat als bijlage mee met de
-- factuurmail (factuur-verzenden) naar email_factuur. Dit veld legt het
-- gewenste pakbon-adres vast voor toekomstige/handmatige pakbon-specifieke
-- routing — geen nieuwe mailstroom in deze migratie (afgesproken met gebruiker).
--
-- email_2 is bewust NIET hergebruikt: dat is nog een actieve fallback in de
-- orderbevestiging-ladder (email_overig -> email_factuur -> email_2).

ALTER TABLE debiteuren ADD COLUMN IF NOT EXISTS email_pakbon TEXT;

COMMENT ON COLUMN debiteuren.email_pakbon IS
  'Optioneel e-mailadres specifiek voor de pakbon (mig 496). De huidige pakbon gaat als bijlage mee met de factuurmail; dit veld legt het gewenste pakbon-adres vast voor toekomstige/handmatige routing.';
