import { describe, expect, it } from 'vitest'
import golden from '../../../../../../supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json'
import { ACTIVE_ORDER_STATUSES } from '../vertegenwoordigers'

// Drift-vangnet (audit 2026-07-02): de hand-getypte kopie in
// vertegenwoordigers.ts moet exact "alle order-statussen minus
// eindstatussen" blijven. Wijzigt de enum (nieuwe golden), dan wordt deze
// test rood i.p.v. dat de kopie stil achterblijft.
//
// 'Maatwerk afgerond' is óók een eindstatus: terminale status voor
// Productie-only orders (ADR-0029) — bereikt nooit 'Verzonden', en mig 355
// rekent 'm al bij de bestaande eindstatus-guards elders (zie CONTEXT.md).
// Eerste run van deze test (vóór de fix) toonde dat de kopie twee golden-
// waarden miste: 'Concept' (mig 308/540-542, nu breed gebruikte intake-
// status — hoort als open/actieve order WÉL mee te tellen) en 'Maatwerk
// afgerond' (hierboven als eindstatus geclassificeerd, dus terecht
// afwezig). 'Concept' is toegevoegd aan ACTIVE_ORDER_STATUSES.
const EINDSTATUSSEN = ['Verzonden', 'Geannuleerd', 'Maatwerk afgerond']

describe('ACTIVE_ORDER_STATUSES drift-vangnet', () => {
  it('is exact de golden order-status-enum minus eindstatussen', () => {
    const volledigeEnum = [...golden.canoniek, ...golden.legacy] as string[]
    const verwacht = volledigeEnum.filter((s) => !EINDSTATUSSEN.includes(s))
    expect([...ACTIVE_ORDER_STATUSES].sort()).toEqual([...verwacht].sort())
  })
})
