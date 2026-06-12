// Contracttest: TS-bundel-sleutel-familie ≡ golden-fixture ≡ SQL-familie.
// Golden = canon; de SQL-kant wordt geborgd door assert_bundel_sleutel_contract()
// in de laatste *_bundel_sleutel_contract*.sql-migratie. De sync-describe
// onderaan bewijst dat het $golden$-blok in die migratie inhoudelijk gelijk is
// aan dit JSON-bestand — één bron, twee consumenten (patroon: order-status.contract.test.ts).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import golden from './golden/bundel-sleutel.golden.json'
import { normaliseerAdresKey } from '../normaliseer-adres'
import { verzendWeekIsoString } from '../verzendweek'
import { bundelSleutelVoorOrder } from '../bundel-sleutel'

describe('golden: normaliseerAdresKey', () => {
  for (const c of golden.adres_cases) {
    it(c.naam, () => {
      expect(
        normaliseerAdresKey({
          afl_adres: c.afl_adres,
          afl_postcode: c.afl_postcode,
          afl_land: c.afl_land,
        })
      ).toBe(c.verwacht)
    })
  }
})

describe('golden: verzendWeekIsoString', () => {
  for (const c of golden.week_cases) {
    it(c.naam, () => {
      expect(verzendWeekIsoString(c.datum)).toBe(c.verwacht)
    })
  }
})

describe('golden: bundelSleutelVoorOrder (compositie, end-to-end)', () => {
  for (const c of golden.sleutel_cases) {
    it(c.naam, () => {
      expect(
        bundelSleutelVoorOrder({
          debiteur_nr: c.debiteur_nr,
          afl_adres: c.afl_adres,
          afl_postcode: c.afl_postcode,
          afl_land: c.afl_land,
          afleverdatum: c.afleverdatum,
          vervoerder_code: c.vervoerder_code,
          afhalen: c.afhalen,
        })
      ).toBe(c.verwacht)
    })
  }
})

describe('sync: golden ≡ $golden$-blok in de contract-migratie', () => {
  const hier = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(hier, '../../../../../supabase/migrations')

  it('laatste *_bundel_sleutel_contract*.sql draagt exact dezelfde fixtures', () => {
    const kandidaten = readdirSync(migrationsDir)
      .filter((f) => f.includes('bundel_sleutel_contract'))
      .sort()
    expect(
      kandidaten.length,
      'geen contract-migratie gevonden — is mig 383 al aangemaakt (Task 3)?'
    ).toBeGreaterThan(0)
    const sql = readFileSync(join(migrationsDir, kandidaten.at(-1)!), 'utf8')
    const m = sql.match(/\$golden\$([\s\S]*?)\$golden\$/)
    expect(m, 'migratie mist het $golden$…$golden$-blok').not.toBeNull()
    const inMigratie = JSON.parse(m![1])
    // _lees_mij is documentatie, geen contract-data.
    const { _lees_mij: _a, ...goldenData } = golden as Record<string, unknown>
    const { _lees_mij: _b, ...migratieData } = inMigratie
    expect(migratieData).toEqual(goldenData)
  })
})
