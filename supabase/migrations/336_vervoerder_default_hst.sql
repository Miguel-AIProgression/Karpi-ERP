-- Migratie 336: HST als default-vervoerder binnen NL
--
-- ADR: altijd-een-vervoerder. Een niet-afhaal-order zonder matchende regel bleef
-- als 'bron=geen' liggen en ging nooit de deur uit. Zolang HST de enige koppeling
-- is, wordt HST de default — maar alleen binnen z'n bereik (NL). Buiten NL blijft
-- 'bron=geen' → zichtbaar als "handmatig vervoerder kiezen" (geen stille HST-toewijzing).
--
-- Mechanisme: catch-all vervoerder_selectie_regel met laagste prio en conditie
-- {land:['NL']}. De bestaande ladder (mig 219/225: override > regel > geen) levert
-- dan vanzelf HST binnen NL via de regel-evaluator. Specifieke regels (lagere prio)
-- winnen nog steeds. Plus is_default-vlag als toekomst-marker (2e vervoerder = vlag om).
--
-- Idempotent.

ALTER TABLE vervoerders ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vervoerders.is_default IS
  'Markeert de huidige default-vervoerder. Hooguit één TRUE (partial unique index). '
  'Catch-all selectie-regel verwijst hiernaar conceptueel; bij 2e vervoerder vlag omzetten.';

-- Hooguit één default tegelijk.
CREATE UNIQUE INDEX IF NOT EXISTS uk_vervoerders_is_default
  ON vervoerders (is_default) WHERE is_default = TRUE;

UPDATE vervoerders SET is_default = TRUE
 WHERE code = 'hst_api'
   AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE is_default = TRUE);

-- Catch-all HST-regel (NL). Alleen toevoegen als er nog geen default-NL-regel staat,
-- zodat re-apply geen duplicaat maakt.
INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, service_code, notitie)
SELECT 'hst_api', 99999, jsonb_build_object('land', ARRAY['NL']), NULL,
       'Default-vervoerder binnen NL (mig 336) — laagste prio, specifieke regels winnen.'
 WHERE EXISTS (SELECT 1 FROM vervoerders WHERE code = 'hst_api' AND actief = TRUE)
   AND NOT EXISTS (
     SELECT 1 FROM vervoerder_selectie_regels
      WHERE vervoerder_code = 'hst_api' AND prio = 99999
        AND conditie = jsonb_build_object('land', ARRAY['NL'])
   );

NOTIFY pgrst, 'reload schema';
