// Contracttest: TS-spiegel deriveWachtStatus ≡ golden truthtable (mig 346 + 352 + 470 + 540).
// De golden fixture is byte-equivalent met de DO-assertie in
// supabase/migrations/470_flip_wacht_inkoop_voorraad_betekenis.sql — beide
// kanten (SQL + TS) worden tegen dezelfde cases geborgd (ADR-0006; mig 352
// voegde de B13-cases toe: 'Maatwerk afgerond' met maatwerk=true blijft no-op;
// mig 470 draaide de betekenis van 'Wacht op inkoop'/'Wacht op voorraad' om;
// mig 540: 3 Concept-cases toegevoegd (alle inputs → null, mig-540-DO-assertie
// borgt de SQL-kant)).
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json'
import { deriveWachtStatus } from '../../../../../supabase/functions/_shared/order-lifecycle/derive-status'

describe('order-status ladder: TS ≡ golden truthtable', () => {
  it('fixture bevat 26 cases (23 origineel + 3 Concept no-op cases mig 540)', () => {
    expect(golden.cases).toHaveLength(26)
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
