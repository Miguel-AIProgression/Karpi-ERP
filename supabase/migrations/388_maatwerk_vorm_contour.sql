-- Maatwerk-vorm "Contour" toevoegen.
--
-- Aanleiding: Floorpassion (de webshop van Karpi) verkoopt tapijten "in Contour
-- Vorm" — een organische contour-vorm waarin het tapijt wordt gesneden. Inkomende
-- Shopify-orders (bv. "Vernon 13 - Linnen Grey — Contour / 240 x 340 cm") landden
-- als [UNMATCHED] omdat product-matcher.ts de vorm niet kende. De matcher koppelt
-- deze nu via detectVorm() → 'contour' aan het generieke {KWAL}{KLEUR}MAATWERK-
-- artikel met maatwerk_vorm='contour'. order_regels.maatwerk_vorm heeft een FK
-- naar maatwerk_vormen(code), dus de vorm moet bestaan vóór de matcher hem zet.
--
-- Toeslag €75 conform de overige organische vormen (organisch_a, pebble, ellips,
-- cloud, klanteigen_vorm). Idempotent.

INSERT INTO maatwerk_vormen (code, naam, afmeting_type, toeslag, actief, volgorde, kan_afwijkende_maten)
VALUES ('contour', 'Contour', 'lengte_breedte', 75.0, true, 95, false)
ON CONFLICT (code) DO NOTHING;
