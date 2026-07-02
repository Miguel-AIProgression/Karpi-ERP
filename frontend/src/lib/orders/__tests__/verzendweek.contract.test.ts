import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import golden from './golden/verzendweek.golden.json'
import { verzendWeekSleutel } from '../verzendweek'

describe('verzendweek golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(`${c.datum} → ${c.verwacht}`, () => {
      expect(verzendWeekSleutel(c.datum)).toBe(c.verwacht)
    })
  }
})

describe('sync: golden ≡ $golden$-blok in de contract-migratie', () => {
  const hier = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(hier, '../../../../../supabase/migrations')

  // _comment is documentatie, geen contract-data.
  const stripComment = ({ _comment, ...rest }: Record<string, unknown>) =>
    (void _comment, rest)

  it('laatste *_verzendweek_contract*.sql draagt exact dezelfde fixtures', () => {
    const kandidaten = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && f.includes('verzendweek_contract'))
      .sort()
    expect(
      kandidaten.length,
      'geen contract-migratie gevonden — is mig 584 al aangemaakt?'
    ).toBeGreaterThan(0)
    const sql = readFileSync(join(migrationsDir, kandidaten.at(-1)!), 'utf8')
    const matches = [
      ...sql.matchAll(
        /assert_verzendweek_contract\(\s*\$golden\$([\s\S]*?)\$golden\$::jsonb\)/g
      ),
    ]
    const m = matches.at(-1)
    expect(
      m,
      'migratie mist de assert_verzendweek_contract($golden$…$golden$::jsonb)-aanroep'
    ).toBeDefined()
    const inMigratie = JSON.parse(m![1])
    expect(stripComment(inMigratie)).toEqual(
      stripComment(golden as Record<string, unknown>)
    )
  })
})
