// Contracttest: TS-landnormalisatie ≡ golden-fixture ≡ SQL normaliseer_land.
// Golden = canon; de SQL-kant wordt geborgd door assert_normaliseer_land_contract()
// in de laatste *_normaliseer_land_contract*.sql-migratie. De sync-describe
// onderaan bewijst dat het $golden$-blok in die migratie inhoudelijk gelijk is
// aan dit JSON-bestand — één bron, meerdere consumenten (patroon:
// bundel-sleutel.contract.test.ts).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import golden from './golden/normaliseer-land.golden.json'
import {
  normalizeCountry,
  landNaarIso2Strikt,
} from '../../../../../supabase/functions/_shared/adres-split'

describe('golden: normalizeCountry (lenient) ≡ landNaarIso2Strikt (strikt) ≡ verwacht', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      // Voor bekende landen + ISO-2 geven beide varianten dezelfde ISO-2 terug.
      expect(normalizeCountry(c.input)).toBe(c.verwacht)
      expect(landNaarIso2Strikt(c.input)).toBe(c.verwacht)
    })
  }
})

describe('runtime-specifieke edge-cases (bewust buiten de golden)', () => {
  it('lenient: onbekend land komt uppercased/diakriet-vrij terug', () => {
    expect(normalizeCountry('Verweggistan')).toBe('VERWEGGISTAN')
  })
  it('strikt: onbekend land → null', () => {
    expect(landNaarIso2Strikt('Verweggistan')).toBeNull()
  })
  it('lenient: leeg/undefined → lege string', () => {
    expect(normalizeCountry('')).toBe('')
    expect(normalizeCountry(null)).toBe('')
    expect(normalizeCountry(undefined)).toBe('')
  })
  it('strikt: leeg/undefined → null', () => {
    expect(landNaarIso2Strikt('')).toBeNull()
    expect(landNaarIso2Strikt(null)).toBeNull()
  })
})

describe('sync: golden ≡ $golden$-blok in de contract-migratie', () => {
  const hier = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(hier, '../../../../../supabase/migrations')

  // _lees_mij is documentatie, geen contract-data.
  const stripLeesMij = ({ _lees_mij, ...rest }: Record<string, unknown>) =>
    (void _lees_mij, rest)

  it('laatste *_normaliseer_land_contract*.sql draagt exact dezelfde fixtures', () => {
    const kandidaten = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && f.includes('normaliseer_land_contract'))
      .sort()
    expect(
      kandidaten.length,
      'geen contract-migratie gevonden — is mig 389 al aangemaakt?'
    ).toBeGreaterThan(0)
    const sql = readFileSync(join(migrationsDir, kandidaten.at(-1)!), 'utf8')
    const matches = [
      ...sql.matchAll(
        /assert_normaliseer_land_contract\(\s*\$golden\$([\s\S]*?)\$golden\$::jsonb\)/g
      ),
    ]
    const m = matches.at(-1)
    expect(
      m,
      'migratie mist de assert_normaliseer_land_contract($golden$…$golden$::jsonb)-aanroep'
    ).toBeDefined()
    const inMigratie = JSON.parse(m![1])
    expect(stripLeesMij(inMigratie)).toEqual(
      stripLeesMij(golden as Record<string, unknown>)
    )
  })
})
