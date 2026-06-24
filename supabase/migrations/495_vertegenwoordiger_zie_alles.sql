-- Migratie 493: rep ziet ALLES (read-only) — per-klant SELECT-filtering vervalt
--
-- Nieuwe eis (2026-06-24): de externe vertegenwoordiger moet niet alleen zijn eigen
-- klanten zien maar ALLE data (read-only), behalve systeembeheer. De per-klant
-- SELECT-filtering uit mig 490/492 vervalt dus. Read-only wordt voortaan frontend-
-- zijde afgedwongen (route-guard + verborgen muteer-knoppen + een client-side
-- .from()-write-vangnet). De schrijf-blokkade-policies (insert/update/delete) uit
-- mig 490/492 blijven als server-side defense-in-depth gewoon staan.
--
-- We DROPpen alléén de SELECT-policies → de al-bestaande blanket-policy
-- "Authenticated full access" (USING true) bepaalt dan weer de zichtbaarheid voor
-- de rep = alles, identiek aan het personeel. huidige_vertegenw_code() blijft
-- bestaan maar heeft geen callers meer; is_externe_vertegenwoordiger() blijft de
-- schrijf-policies voeden. vertegenwoordiger_login blijft de "wie is rep"-bron.

DROP POLICY IF EXISTS debiteuren_rep_select    ON debiteuren;
DROP POLICY IF EXISTS orders_rep_select        ON orders;
DROP POLICY IF EXISTS order_regels_rep_select  ON order_regels;
DROP POLICY IF EXISTS facturen_rep_select      ON facturen;
DROP POLICY IF EXISTS factuur_regels_rep_select ON factuur_regels;

NOTIFY pgrst, 'reload schema';
