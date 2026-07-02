// Contracttest: TS-spiegel deriveWachtStatus ≡ golden truthtable (mig 346 + 352 + 470 + 540 + 558).
// De golden fixture is byte-equivalent met de DO-assertie in
// supabase/migrations/558_derive_wacht_status_combi_levering.sql — beide
// kanten (SQL + TS) worden tegen dezelfde cases geborgd (ADR-0006; mig 352
// voegde de B13-cases toe: 'Maatwerk afgerond' met maatwerk=true blijft no-op;
// mig 470 draaide de betekenis van 'Wacht op inkoop'/'Wacht op voorraad' om;
// mig 540: 3 Concept-cases toegevoegd; mig 558 (ADR-0040): 'combi'-veld op elke
// case + 10 nieuwe Combi-levering-cases, incl. demotie vanuit 'Klaar voor picken').
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json'
import { deriveWachtStatus } from '../../../../../supabase/functions/_shared/order-lifecycle/derive-status'

describe('order-status ladder: TS ≡ golden truthtable', () => {
  it('fixture bevat 36 cases (26 origineel + 10 Combi-levering-cases mig 558)', () => {
    expect(golden.cases).toHaveLength(36)
  })

  for (const c of golden.cases) {
    it(`${c.huidig} | io=${c.io} tekort=${c.tekort} mw=${c.maatwerk} combi=${c.combi} -> ${c.verwacht ?? 'no-op'}`, () => {
      expect(
        deriveWachtStatus({
          huidig: c.huidig,
          heeftIoClaim: c.io,
          heeftTekort: c.tekort,
          heeftMaatwerk: c.maatwerk,
          wachtOpCombiLevering: c.combi,
        }),
      ).toBe(c.verwacht)
    })
  }
})
