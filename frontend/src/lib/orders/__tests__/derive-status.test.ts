// Contracttest: TS-spiegel deriveWachtStatus ≡ golden truthtable (mig 346 + 352 + 470).
// De golden fixture is byte-equivalent met de DO-assertie in
// supabase/migrations/470_flip_wacht_inkoop_voorraad_betekenis.sql — beide
// kanten (SQL + TS) worden tegen dezelfde 23 cases geborgd (ADR-0006; mig 352
// voegde de B13-cases toe: 'Maatwerk afgerond' met maatwerk=true blijft no-op;
// mig 470 draaide de betekenis van 'Wacht op inkoop'/'Wacht op voorraad' om).
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json'
import { deriveWachtStatus } from '../../../../../supabase/functions/_shared/order-lifecycle/derive-status'

describe('order-status ladder: TS ≡ golden truthtable', () => {
  it('fixture bevat 23 cases (DO-assertie in mig 352 moet byte-gelijk meelopen)', () => {
    expect(golden.cases).toHaveLength(23)
  })

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
