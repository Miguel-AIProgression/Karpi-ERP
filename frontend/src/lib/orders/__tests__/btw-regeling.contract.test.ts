import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import golden from './golden/btw-regeling.golden.json'
import { bepaalBtwRegeling } from '../btw'

// Golden-contract: dezelfde fixtures voeden assert_btw_regeling_contract
// (SQL-migratie 579, patroon mig 385/389). TS-kant hier; SQL-kant + sync-check
// hieronder.
describe('btw-regeling golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      const r = bepaalBtwRegeling(c.input)
      expect(r.regeling).toBe(c.verwacht.regeling)
      expect(r.effectiefPct).toBe(c.verwacht.effectiefPct)
      expect(r.controleNodig).toBe(c.verwacht.controleNodig)
    })
  }
})

describe('sync: golden ≡ $golden$-blok in de contract-migratie', () => {
  const hier = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(hier, '../../../../../supabase/migrations')

  // _comment is documentatie, geen contract-data.
  const stripComment = ({ _comment, ...rest }: Record<string, unknown>) =>
    (void _comment, rest)

  it('laatste *_btw_regeling_contract*.sql draagt exact dezelfde fixtures', () => {
    const kandidaten = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && f.includes('btw_regeling_contract'))
      .sort()
    expect(
      kandidaten.length,
      'geen contract-migratie gevonden — is mig 583 al aangemaakt?'
    ).toBeGreaterThan(0)
    const sql = readFileSync(join(migrationsDir, kandidaten.at(-1)!), 'utf8')
    const matches = [
      ...sql.matchAll(
        /assert_btw_regeling_contract\(\s*\$golden\$([\s\S]*?)\$golden\$::jsonb\)/g
      ),
    ]
    const m = matches.at(-1)
    expect(
      m,
      'migratie mist de assert_btw_regeling_contract($golden$…$golden$::jsonb)-aanroep'
    ).toBeDefined()
    const inMigratie = JSON.parse(m![1])
    expect(stripComment(inMigratie)).toEqual(
      stripComment(golden as Record<string, unknown>)
    )
  })
})
