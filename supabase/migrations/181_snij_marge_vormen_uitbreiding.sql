-- supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
-- Breidt de set "vormen die +5cm snij-marge krijgen" uit met de 4 nieuwe codes.
-- Cloud is GEEN maatwerk-vorm in dit plan — niet opgenomen. Houd synchroon met
-- _shared/snij-marges.ts en frontend/src/lib/utils/snij-marges.ts (Task 4).

CREATE OR REPLACE FUNCTION stuk_snij_marge_cm(
  afwerking TEXT,
  vorm      TEXT
) RETURNS INTEGER
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO' THEN 6 ELSE 0 END,
    CASE WHEN lower(COALESCE(vorm, '')) IN (
      'rond', 'ovaal',
      'organisch_a', 'organisch_b_sp',
      'pebble', 'ellips', 'afgeronde_hoeken'
    ) THEN 5 ELSE 0 END
  );
$$;

COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT) IS
  'Extra cm op elke dimensie bij snijden. ZO-afwerking: +6cm. '
  'Alle vormen behalve "rechthoek": +5cm voor handmatig uitzagen. '
  'Bij combi wint de grootste marge (niet cumulatief). '
  'Houd synchroon met snij-marges.ts in edge function en frontend.';
