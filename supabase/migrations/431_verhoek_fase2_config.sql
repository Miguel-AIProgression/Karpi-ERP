-- Migratie 431: Verhoek Fase 2 — antwoorden Verhoek (mail Applicatie Management
-- 16-06-2026) verwerken in de runtime-config. Plan:
--   docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md (ADR-0031)
--
-- Verhoek bevestigde:
--  1. Opdrachtgevernummer Karpi = OG123 (was '' = onbekend; verhoek-send
--     weigerde echte verzending zolang dit leeg was).
--  4. Verpakkingseenheid: tabel 'Standaard artikelwaarden'. Karpi verstuurt via
--     Verhoek NOOIT volle rollen — alleen maatwerk + standaardmaten, opgerold,
--     hooguit ~rolbreedte. Daarom is 'Rol' (≥1251 cm) verkeerd; verhoek-send
--     leidt de eenheid voortaan PER COLLI af (Karpet/Loper/Coupon — zie
--     xml-builder.ts::verhoekVerpakkingseenheid). Dit record houdt alleen nog de
--     fallback-default voor het geval een colli geen afmeting heeft → 'Coupon'
--     (de ruimste, altijd-geldige envelope).
--
-- Overige antwoorden vergden geen DB-wijziging:
--  - ScanCode = fysieke labelbarcode (AI(00)+SSCC) — al de gedeelde seam.
--  - Levering/SoortLevering = 1/1 — al correct.
--  - Niet-gebruikte tags leeg — builder doet dit al.
--  - Afwijkende afzender alleen bij afwijking — opgelost in xml-builder.ts.
--
-- Idempotent: merge (||) op het bestaande JSONB-record uit mig 374.
UPDATE app_config
   SET waarde = waarde
       || jsonb_build_object('opdrachtgever_nummer', 'OG123')
       || jsonb_build_object('verpakkingseenheid', 'Coupon')
 WHERE sleutel = 'verhoek';

NOTIFY pgrst, 'reload schema';
