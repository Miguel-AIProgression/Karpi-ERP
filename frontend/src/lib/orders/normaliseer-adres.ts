// Adres-normalisatie voor zending-bundeling — single source of truth.
//
// Spiegelt 1-op-1 de SQL-functie `_normaliseer_afleveradres(adres, postcode,
// land)` uit migratie 222. Wijzigt één van beide kanten → de andere ook.
// Gebruikt door:
//   · `bundel-sleutel.ts`             (frontend bundel-key)
//   · `bundel-cluster.ts`             (Pick & Ship UI-clustering)
//   · `voorgestelde-bundels.ts`       (preview-fetcher type-narrowing)
//
// Vorm: `POSTCODE|ADRES|LAND`, alle uppercase.
// - Postcode: alle whitespace verwijderd ('1234 AB' → '1234AB')
// - Adres:    whitespace genormaliseerd ('  Hoofd  weg 12  ' → 'HOOFD WEG 12')
// - Land:     trim + uppercase ('  nl ' → 'NL')
// Lege/missende velden krijgen '?'.
export function normaliseerAdresKey(input: {
  afl_adres: string | null
  afl_postcode: string | null
  afl_land: string | null
}): string {
  const postcode =
    (input.afl_postcode ?? '').replace(/\s+/g, '').toUpperCase().trim() || '?'
  const adres =
    (input.afl_adres ?? '').replace(/\s+/g, ' ').trim().toUpperCase() || '?'
  const land = (input.afl_land ?? '').trim().toUpperCase() || '?'
  return `${postcode}|${adres}|${land}`
}
