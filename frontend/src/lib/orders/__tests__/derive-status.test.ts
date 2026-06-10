// Contracttest: TS-spiegel deriveWachtStatus ≡ golden truthtable (mig 346).
// De golden fixture is byte-equivalent met de DO-assertie in
// supabase/migrations/346_derive_wacht_status_single_source.sql — beide kanten
// (SQL + TS) worden tegen dezelfde 17 cases geborgd (ADR-0006).
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json'
import { deriveWachtStatus } from '../../../../../supabase/functions/_shared/order-lifecycle/derive-status'

describe('order-status ladder: TS ≡ golden truthtable', () => {
  for (const c of golden.cases) {
    it(`${c.huidig} | io=${c.io} tekort=${c.tekort} mw=${c.maatwerk} -> ${c.verwacht ?? 'no-op'}`, () => {
      expect(
        deriveWachtStatus({
          huidig: c.huidig,
          heeftIoClaim: c.io,
          heeftTekort: c.tekort,
          heeftMaatwerk: c.maatwerk,
        }),
      ).toBe(c.verwacht)
    })
  }
})
