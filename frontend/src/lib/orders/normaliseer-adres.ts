// Adres-normalisatie voor zending-bundeling — single source of truth.
//
// Spiegelt 1-op-1 de SQL-functie `_normaliseer_afleveradres(adres, postcode,
// land)` (mig 222, gehard in mig 385). Het contract wordt afgedwongen door
// golden fixtures (__tests__/golden/bundel-sleutel.golden.json): de Vitest-
// contracttest toetst deze module, `assert_bundel_sleutel_contract()` toetst
// de SQL-kant met exact dezelfde cases. Wijzig je gedrag → golden bijwerken
// → nieuwe contract-migratie (de sync-test dwingt dat af).
// Gebruikt door:
//   · `bundel-sleutel.ts`             (frontend bundel-key)
//   · `bundel-cluster.ts`             (Pick & Ship UI-clustering)
//   · `voorgestelde-bundels.ts`       (preview-fetcher type-narrowing)
//
// Vorm: `POSTCODE|ADRES|LAND`, alle uppercase.
// - Postcode: alle whitespace verwijderd ('1234 AB' → '1234AB')
// - Adres:    whitespace genormaliseerd ('  Hoofd  weg 12  ' → 'HOOFD WEG 12')
// - Land:     trim + uppercase ('  nl ' → 'NL')
// - ß (U+00DF) en ẞ (U+1E9E) folden naar 'SS' — JS toUpperCase() doet dat
//   alleen voor ß; Postgres upper() voor geen van beide (locale-afhankelijk).
//   De expliciete fold maakt beide kanten deterministisch gelijk.
// Lege/missende velden krijgen '?'.

const foldScharfesS = (s: string) => s.replace(/[\u00df\u1e9e]/g, 'ss')

export function normaliseerAdresKey(input: {
  afl_adres: string | null
  afl_postcode: string | null
  afl_land: string | null
}): string {
  const postcode =
    foldScharfesS(input.afl_postcode ?? '')
      .replace(/\s+/g, '')
      .toUpperCase()
      .trim() || '?'
  const adres =
    foldScharfesS(input.afl_adres ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase() || '?'
  const land = foldScharfesS(input.afl_land ?? '').trim().toUpperCase() || '?'
  return `${postcode}|${adres}|${land}`
}
