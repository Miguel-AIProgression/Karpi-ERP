// Snijtijd per vorm (mig 460) — vervangt het vlakke snijtijd_minuten/stuk.
// Pure rekenfunctie; het ophalen van de tarieven (maatwerk_vormen,
// kwaliteiten.moeilijk_te_snijden) gebeurt per runtime apart (db-helpers.ts
// voor edge, frontend/src/lib/supabase/queries/ voor de browser) — ADR-0033.

/**
 * Snijtijd in minuten voor één stuk. `vormCode` ontbreekt soms (legacy data) —
 * zelfde default als `getVormDisplay` (frontend/src/lib/utils/vorm-labels.ts):
 * ontbrekende vorm telt als rechthoek.
 *
 * Uitzondering: bij kwaliteiten die moeilijk te snijden zijn (Marich/Louvre/
 * Galaxy-collecties) telt rechthoek als het algemene tarief (5 min), niet de
 * rechthoek-korting — een letterlijke 5, niet "wat rond toevallig kost", zodat
 * een latere wijziging van het rond-tarief deze uitzondering niet ongezien
 * meeverandert.
 */
export function bepaalSnijtijdMinuten(
  vormCode: string | null,
  kwaliteitCode: string | null,
  vormTarieven: Map<string, number>,
  moeilijkeKwaliteiten: Set<string>,
  fallbackMinuten = 5,
): number {
  const vorm = vormCode ?? 'rechthoek'
  if (vorm === 'rechthoek' && kwaliteitCode != null && moeilijkeKwaliteiten.has(kwaliteitCode)) {
    return 5
  }
  return vormTarieven.get(vorm) ?? fallbackMinuten
}
