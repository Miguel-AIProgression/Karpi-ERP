// Parser-tests voor Karpi-fixed-width inkomende orders.
//
// Fixtures:
//   * `docs/transus/voorbeelden/rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh`
//     — productie-bestand 2026-04-30, klantorder 8MRE0, 3 regels (PATS23/92/10).
//
// Doel: bewijzen dat het echte bestand parseable is en dat de drie GLN-rollen
// (BY ≠ DP ≠ IV) correct uit elkaar gehouden worden.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKarpiOrder } from './karpi-fixed-width'

const FIXTURE_BDSK_8MRE0 = join(
  __dirname,
  '../../../../../docs/transus/voorbeelden/rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh',
)

describe('parseKarpiOrder — BDSK 8MRE0 fixture', () => {
  const raw = readFileSync(FIXTURE_BDSK_8MRE0, 'utf8')
  const parsed = parseKarpiOrder(raw)

  it('parseert klantordernummer correct', () => {
    expect(parsed.header.ordernummer).toBe('8MRE0')
  })

  it('parseert leverdatum als ISO YYYY-MM-DD', () => {
    expect(parsed.header.leverdatum).toBe('2026-05-22')
  })

  it('houdt drie BDSK-GLN-rollen apart', () => {
    expect(parsed.header.gln_gefactureerd).toBe('9007019015989') // IV (BDSK Handels)
    expect(parsed.header.gln_besteller).toBe('9007019005430') // BY (XXXLUTZ Wuerselen)
    expect(parsed.header.gln_afleveradres).toBe('9007019005430') // DP (zelfde als BY hier)
  })

  it('herkent Karpi als leverancier', () => {
    expect(parsed.header.gln_leverancier).toBe('8715954999998')
  })

  it('parseert 3 regels met juiste GTINs', () => {
    expect(parsed.regels).toHaveLength(3)
    expect(parsed.regels.map((r) => r.gtin)).toEqual([
      '8715954176023', // PATS23
      '8715954218143', // PATS92
      '8715954235829', // PATS10
    ])
  })

  it('parseert aantallen correct (1× per regel)', () => {
    for (const r of parsed.regels) {
      expect(r.aantal).toBe(1)
    }
  })

  it('plaatst klantordernummer als ordernummer_ref op elke regel', () => {
    for (const r of parsed.regels) {
      expect(r.ordernummer_ref).toBe('8MRE0')
    }
  })
})
