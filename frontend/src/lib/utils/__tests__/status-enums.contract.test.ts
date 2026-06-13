import { describe, it, expect } from 'vitest'
import golden from './status-enums.golden.json'
import {
  SNIJPLAN_STATUSSEN,
  CONFECTIE_STATUSSEN,
  TE_SNIJDEN,
  ROL_FYSIEK_BEZET,
  INPAK_KANDIDAAT,
  CONFECTIE_INSTROOM,
} from '@/lib/utils/snijplan-status'

const asSet = (xs: readonly string[]) => new Set(xs)

describe('status-enum contract: TS ≡ DB-snapshot', () => {
  it('SNIJPLAN_STATUSSEN dekt exact snijplan_status', () => {
    expect([...SNIJPLAN_STATUSSEN]).toEqual(golden.snijplan_status)
  })

  it('CONFECTIE_STATUSSEN dekt exact confectie_status', () => {
    expect([...CONFECTIE_STATUSSEN]).toEqual(golden.confectie_status)
  })

  it('geen dubbele waarden binnen een enum-array', () => {
    expect(SNIJPLAN_STATUSSEN.length).toBe(asSet(SNIJPLAN_STATUSSEN).size)
    expect(CONFECTIE_STATUSSEN.length).toBe(asSet(CONFECTIE_STATUSSEN).size)
  })
})

describe('semantische groepen', () => {
  it('TE_SNIJDEN bevat exact [Gepland, Snijden]', () => {
    expect([...TE_SNIJDEN]).toEqual(['Gepland', 'Snijden'])
  })

  it('ROL_FYSIEK_BEZET bevat exact [Snijden, Gesneden]', () => {
    expect([...ROL_FYSIEK_BEZET]).toEqual(['Snijden', 'Gesneden'])
  })

  it('INPAK_KANDIDAAT bevat exact [Gesneden, In confectie, Gereed]', () => {
    expect([...INPAK_KANDIDAAT]).toEqual(['Gesneden', 'In confectie', 'Gereed'])
  })

  it('CONFECTIE_INSTROOM bevat exact [Gesneden, In confectie]', () => {
    expect([...CONFECTIE_INSTROOM]).toEqual(['Gesneden', 'In confectie'])
  })
})
