-- 018: Herclassificatie van verkeerd geclassificeerde "overig" producten
-- Van 1407 actieve "overig" producten naar 2, door betere patroonherkenning.
--
-- Oorzaak: migratie 015 checkte alleen op "BREED" in omschrijving, maar
-- miste het veel voorkomende "NNN BR" patroon (breedte-aanduiding) en
-- vaste maten zonder "CA:" prefix.
--
-- UITGEVOERD op 2026-04-02 via Python script (Supabase REST API).
-- Deze SQL is de declaratieve vastlegging van de wijzigingen.

-- ============================================================
-- STAP 1: MAATWK placeholders deactiveren (908 stuks)
-- Producten met karpi_code LIKE '%MAATWK%', omschrijving = 'Onbekend'
-- ============================================================
UPDATE producten
SET actief = false
WHERE product_type = 'overig'
  AND UPPER(karpi_code) LIKE '%MAATWK%';

-- ============================================================
-- STAP 2: Vaste maten (207 → vast, 1 → vast/rond)
-- NNNxNNN patroon >= 1m² of ROND
-- ============================================================
UPDATE producten SET product_type = 'vast'
WHERE product_type = 'overig' AND actief = true
  AND omschrijving ~ '\d{2,3}\s*[xX]\s*\d{2,3}'
  AND (regexp_match(omschrijving, '(\d{2,3})\s*[xX]\s*(\d{2,3})'))[1]::int
    * (regexp_match(omschrijving, '(\d{2,3})\s*[xX]\s*(\d{2,3})'))[2]::int >= 10000;

UPDATE producten SET product_type = 'vast'
WHERE product_type = 'overig' AND actief = true
  AND UPPER(omschrijving) ~ '(\d{2,3}\s*(CM\s*)?ROND|ROND.*\d{2,3})';

-- ============================================================
-- STAP 3: Staaltjes (86 stuks)
-- NNNxNNN patroon < 1m², 27.5x27.5 tegels, zitkussens
-- ============================================================
UPDATE producten SET product_type = 'staaltje'
WHERE product_type = 'overig' AND actief = true
  AND omschrijving ~ '\d{2,3}\s*[xX]\s*\d{2,3}'
  AND (regexp_match(omschrijving, '(\d{2,3})\s*[xX]\s*(\d{2,3})'))[1]::int
    * (regexp_match(omschrijving, '(\d{2,3})\s*[xX]\s*(\d{2,3})'))[2]::int < 10000;

-- Vernissage tegels (27,5x27,5) en zitkussens
UPDATE producten SET product_type = 'staaltje'
WHERE product_type = 'overig' AND actief = true
  AND artikelnr IN (
    '553130013','553160027','553210052','553220049','553240038','553260057',
    '604990003','604990005','793180000','793250000','793860000','899450002'
  );

-- ============================================================
-- STAP 4: Rolproducten (159 + 16 = 175 stuks)
-- Alles met BR patroon, ROLLEN, typische rolbreedtes, of 400/500
-- ============================================================
UPDATE producten SET product_type = 'rol'
WHERE product_type = 'overig' AND actief = true
  AND (
    UPPER(omschrijving) ~ '\d{2,4}\s*(?:CM\s*)?BR'
    OR UPPER(omschrijving) LIKE '%ROLLEN%'
    OR UPPER(omschrijving) ~ '\d{3}B[\s\.]'
    OR (UPPER(omschrijving) ~ '(145|150|155|160|180|190|200|240|300|320|400|500)\s*CM\b'
        AND NOT omschrijving ~ '\d{2,3}\s*[xX]\s*\d{2,3}')
    OR (UPPER(omschrijving) ~ '\b(400|500)\b'
        AND NOT omschrijving ~ '\d{2,3}\s*[xX]\s*\d{2,3}')
  );

-- Beach Life, Arctic Life, en overige rolproducten zonder BR patroon
UPDATE producten SET product_type = 'rol'
WHERE product_type = 'overig' AND actief = true
  AND artikelnr IN (
    '1000040','1000165','1907004','1907009','1907010','1907012',
    '1907017','1907026','1907033','1911000','1911001','1911002',
    '1911003','1911004','1000052','1000067'
  );

-- ============================================================
-- STAP 5: "NIET GEBRUIKEN" producten deactiveren (17 stuks)
-- ============================================================
UPDATE producten SET actief = false
WHERE product_type = 'overig' AND actief = true
  AND (
    UPPER(omschrijving) LIKE '%NIET GEBRUIKEN%'
    OR UPPER(omschrijving) LIKE '%NIET GEBRUIKEN%'
    OR UPPER(omschrijving) LIKE 'VERVANGEN DOOR%'
  );
