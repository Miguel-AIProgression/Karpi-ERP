-- Migratie 165: EDI-handelspartner-config voor 13 cutover-partners
--
-- Bron: Transus Online screenshots 2026-04-30 — handmatig vastgelegde toestand
-- van de Processen-toggles voor dertien handelspartners (12 Duits + 1 Nederlands).
-- Configuratie wordt nu in onze edi_handelspartner_config gespiegeld zodat
-- klant-detail tab "EDI" en het overzichts-filter de juiste status laten zien.
--
-- Aanpak: voor elke partner zoekt het script een debiteur op naam (ILIKE) en
-- doet bij precies één match een UPSERT op edi_handelspartner_config. Bij geen
-- of meerdere matches → RAISE NOTICE en skip (geen failure — gebruiker kan
-- handmatig een rij toevoegen via klant-detail → tab "EDI").
--
-- Idempotent: ON CONFLICT (debiteur_nr) DO UPDATE — heruitvoeren is veilig en
-- synct steeds met de tabel hieronder.
--
-- Toggle-bron (uit screenshots):
--
--   | Klant                          | order_in | orderbev | factuur | verzend |
--   |--------------------------------|----------|----------|---------|---------|
--   | Braun Möbel Center             |   ✅     |    ✅    |   ✅    |   ❌    |
--   | Einrichtungshaus Ostermann     |   ✅     |    ✅    |   ✅    |   ❌    |
--   | Friedhelm Schaffrath           |   ✅     |    ✅    |   ✅    |   ❌    |
--   | FuG Handelsgesellschaft Mitte  |   ✅     |    ✅    |   ✅    |   ❌    |
--   | FuG Handelsgesellschaft Ost    |   ✅     |    ✅    |   ✅    |   ❌    |
--   | FuG Handelsgesellschaft West   |   ✅     |    ✅    |   ✅    |   ❌    |
--   | Hammer System Management       |   ✅     |    ❌    |   ✅    |   ❌    |
--   | Hornbach Nederland             |   ✅     |    ✅    |   ✅    |   ✅    |
--   | Krieger Business Services      |   ✅     |    ✅    |   ✅    |   ❌    |
--   | Möbel Martin                   |   ✅     |    ✅    |   ❌    |   ❌    |
--   | Möbelcenter Biller             |   ✅     |    ✅    |   ❌    |   ❌    |
--   | Moebel Inhofer                 |   ✅     |    ✅    |   ❌    |   ❌    |
--   | SB-Möbel BOSS                  |   ✅     |    ❌    |   ✅    |   ❌    |
--
-- transus_actief = TRUE en test_modus = FALSE voor alle dertien (productie-cutover).
-- Hornbach Nederland is enige NL-partner en heeft als enige verzend_uit aan.
-- Hammer + SB-Möbel BOSS = zonder orderbev_uit (toggles staan op "Aanvragen" of
-- expliciet uit in Transus). Möbel Martin/Biller/Inhofer = geen factuur via EDI.
--
-- ============================================================================
-- Naam-mapping bevestigd door DB-previews 2026-04-30:
--   * Ostermann hoofdvestiging WITTEN (621816) — sub-vestigingen hebben
--     "(GEBR.)" suffix; de "@"-marker = hoofd-debiteur (zelfde patroon als
--     Schaffrath en KHG).
--   * Hornbach NL = 361208 (HORNBACH BOUWMARKT (NEDERLAND), Nieuwegein) —
--     7 internationale Hornbach-vestigingen in DB, alleen NL-entiteit selecteren.
--   * Braun Möbel-Center heeft 4 identieke namen voor 4 vestigingen — kies
--     REUTLINGEN (152004) consistent met Transus-screenshot. Gebruik
--     plaats_filter om uniek te matchen.
--   * "Krieger Business Services GmbH" (Schönefeld) zit in DB als
--     "KHG GMBH & CO. KG @" (420000) — KHG = Kurt Krieger Holding, KBS is
--     service-tak. Match op exacte naam (incl. "@"-marker).
--   * "SB-Möbel BOSS Handelsgesellschaft" (master) = 150761. De DB heeft >100
--     vestigingen onder varianten; alleen de master "SB MÖBEL BOSS" (zonder
--     vestigings-suffix) is de Transus-handelspartner.
--
-- Bij heruitvoer (idempotent): toggles synct, notities/test_modus blijven
-- behouden — handmatig aangepaste vestigingen worden niet overschreven.
-- ============================================================================

DO $$
DECLARE
  v_debnr   INTEGER;
  v_count   INTEGER;
  v_name    TEXT;
  cfg       RECORD;
BEGIN
  FOR cfg IN
    SELECT * FROM (VALUES
      -- (naam_pattern,                                plaats_filter,    order_in, orderbev, factuur, verzend)
      ('EINRICHTUNGSHAUS OSTERMANN @',                  NULL::TEXT,       true,    true,     true,    false),
      ('FRIEDHELM SCHAFFRATH%',                         NULL::TEXT,       true,    true,     true,    false),
      ('HAMMER SYSTEM MANAGEMENT%',                     NULL::TEXT,       true,    false,    true,    false),
      ('MÖBEL MARTIN%',                                 NULL::TEXT,       true,    true,     false,   false),
      ('%BILLER%',                                      NULL::TEXT,       true,    true,     false,   false),
      ('FUG HANDELSG. MITTE%',                          NULL::TEXT,       true,    true,     true,    false),
      ('FUG HANDELSG. OST%',                            NULL::TEXT,       true,    true,     true,    false),
      ('FUG HANDELSG. WEST%',                           NULL::TEXT,       true,    true,     true,    false),
      ('%INHOFER%',                                     NULL::TEXT,       true,    true,     false,   false),
      ('HORNBACH BOUWMARKT (NEDERLAND)%',               NULL::TEXT,       true,    true,     true,    true),
      ('BRAUN MOEBEL-CENTER%',                          'REUTLINGEN',     true,    true,     true,    false),
      ('KHG GMBH & CO. KG @',                           NULL::TEXT,       true,    true,     true,    false),
      ('SB MÖBEL BOSS',                                 NULL::TEXT,       true,    false,    true,    false)
    ) AS t(naam_pattern, plaats_filter, order_in, orderbev_uit, factuur_uit, verzend_uit)
  LOOP
    SELECT COUNT(*), MAX(debiteur_nr) INTO v_count, v_debnr
      FROM debiteuren
     WHERE naam ILIKE cfg.naam_pattern
       AND (cfg.plaats_filter IS NULL OR plaats = cfg.plaats_filter);

    IF v_count = 0 THEN
      RAISE NOTICE 'Migratie 165: GEEN debiteur gevonden voor pattern %', cfg.naam_pattern;
      CONTINUE;
    ELSIF v_count > 1 THEN
      RAISE NOTICE 'Migratie 165: % debiteuren matchen pattern % — overslaan, los handmatig op',
                   v_count, cfg.naam_pattern;
      CONTINUE;
    END IF;

    SELECT naam INTO v_name FROM debiteuren WHERE debiteur_nr = v_debnr;

    INSERT INTO edi_handelspartner_config (
      debiteur_nr, transus_actief, order_in, orderbev_uit, factuur_uit, verzend_uit,
      test_modus, notities
    ) VALUES (
      v_debnr, true, cfg.order_in, cfg.orderbev_uit, cfg.factuur_uit, cfg.verzend_uit,
      false,
      'Aangezet door mig 165 (Transus Online cutover-batch 2026-04-30)'
    )
    ON CONFLICT (debiteur_nr) DO UPDATE SET
      transus_actief = EXCLUDED.transus_actief,
      order_in       = EXCLUDED.order_in,
      orderbev_uit   = EXCLUDED.orderbev_uit,
      factuur_uit    = EXCLUDED.factuur_uit,
      verzend_uit    = EXCLUDED.verzend_uit,
      -- test_modus en notities NIET overschrijven bij heruitvoer (kan handmatig zijn aangepast)
      updated_at     = NOW();

    RAISE NOTICE 'Migratie 165: % (#%) → transus_actief=true, order_in=%, orderbev=%, factuur=%, verzend=%',
                 v_name, v_debnr, cfg.order_in, cfg.orderbev_uit, cfg.factuur_uit, cfg.verzend_uit;
  END LOOP;
END $$;
