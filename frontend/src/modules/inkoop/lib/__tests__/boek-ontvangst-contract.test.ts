// frontend/src/modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts
//
// Contract-tests voor de Inkoop-Module ontvangst-RPC-wrappers (ADR-0017, mig 271).
//
// Patroon overgenomen van magazijn/__tests__/pickronde.contract.test.ts:
// we mocken `@/lib/supabase/client` en verifieren dat de TS-wrappers de juiste
// RPC-naam + argument-shape aanroepen. Geen integratie met de echte DB —
// dat is bewust: Karpi heeft (nog) geen lokale test-DB en de productie-DB
// muteren in een test-suite is onveilig.
//
// Wat dit bestand WEL afdekt:
//   - `boekVoorraadOntvangst` roept de RPC aan met de juiste param-shape
//   - `boekOntvangst` roept de RPC aan met de juiste param-shape
//   - Foutmeldingen van Supabase worden als Error gepropageerd
//
// Wat dit bestand NIET afdekt (gemarkeerd als `describe.skip` met TODO):
//   - Echte DB-side-effects: voorraad-bump, rollen-INSERT, claim-consume,
//     herwaardeer-trigger, eenheid-mismatch-foutmelding, DEPRECATED-wrapper-
//     forwarding. Deze gedrag-tests vereisen seed-data + rollback-mechanisme
//     en runnen pas tegen een test-DB.
//
// LET OP — huidige codestate (mig 271 + Task 1 van "Inkoopproces Volledig"):
//   De queries-functies `boekOntvangst` / `boekVoorraadOntvangst` roepen
//   de nieuwe Module-aligned RPC-namen aan (`boek_inkooporder_ontvangst_
//   rollen` / `_stuks`). De OUDE namen (`boek_ontvangst` / `boek_voorraad_
//   ontvangst`) bestaan nog als DEPRECATED thin wrappers in de DB (deadline
//   2026-07-13, worden pas in mig 604 gedropt) maar worden vanuit de
//   frontend niet meer aangeroepen.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  },
}))

import { boekOntvangst, boekVoorraadOntvangst } from '../../queries/inkooporders'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

// ============================================================
// Suite 1: boekVoorraadOntvangst (stuks-pad)
// ============================================================

describe('boekVoorraadOntvangst (stuks-pad) — RPC-contract', () => {
  it('roept RPC boek_inkooporder_ontvangst_stuks aan met p_regel_id + p_aantal + p_medewerker', async () => {
    await boekVoorraadOntvangst(42, 5, 'tester')
    expect(rpcCalls).toEqual([
      {
        fn: 'boek_inkooporder_ontvangst_stuks',
        args: { p_regel_id: 42, p_aantal: 5, p_medewerker: 'tester' },
      },
    ])
  })

  it('zonder medewerker stuurt p_medewerker=null', async () => {
    await boekVoorraadOntvangst(7, 1)
    expect(rpcCalls[0].args).toMatchObject({
      p_regel_id: 7,
      p_aantal: 1,
      p_medewerker: null,
    })
  })

  it('propageert RPC-fout als Error', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "Regel 3 heeft eenheid m. Voorraad-ontvangst is alleen voor eenheid 'stuks'." },
    }
    await expect(boekVoorraadOntvangst(3, 1)).rejects.toThrow(/eenheid/)
  })

  it('propageert generieke "regel niet gevonden"-fout', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: 'Inkooporder-regel 999 niet gevonden' },
    }
    await expect(boekVoorraadOntvangst(999, 1)).rejects.toThrow(/niet gevonden/)
  })
})

// ============================================================
// Suite 2: boekOntvangst (rollen-pad)
// ============================================================

describe('boekOntvangst (rollen-pad) — RPC-contract', () => {
  it('roept RPC boek_inkooporder_ontvangst_rollen aan met p_regel_id + p_rollen + p_medewerker', async () => {
    nextRpcResponse = { data: [{ rol_id: 100, rolnummer: 'R-2026-0001' }], error: null }
    const rollen = [{ lengte_cm: 2500, breedte_cm: 400, rolnummer: null }]
    const result = await boekOntvangst(42, rollen, 'tester')

    expect(rpcCalls).toEqual([
      {
        fn: 'boek_inkooporder_ontvangst_rollen',
        args: { p_regel_id: 42, p_rollen: rollen, p_medewerker: 'tester' },
      },
    ])
    expect(result).toEqual([{ rol_id: 100, rolnummer: 'R-2026-0001' }])
  })

  it('zonder medewerker stuurt p_medewerker=null', async () => {
    nextRpcResponse = { data: [], error: null }
    await boekOntvangst(7, [], undefined)
    expect(rpcCalls[0].args).toMatchObject({
      p_regel_id: 7,
      p_rollen: [],
      p_medewerker: null,
    })
  })

  it('geeft lege array terug als RPC null retourneert', async () => {
    nextRpcResponse = { data: null, error: null }
    const result = await boekOntvangst(1, [{ lengte_cm: 100, breedte_cm: 400 }])
    expect(result).toEqual([])
  })

  it('propageert RPC-fout als Error', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "Regel 3 heeft eenheid stuks. Rol-ontvangst is alleen voor eenheid 'm'." },
    }
    await expect(boekOntvangst(3, [])).rejects.toThrow(/eenheid/)
  })
})

// ============================================================
// Suite 3: SKIPPED — gedrag-tests die een test-DB vereisen
// ============================================================
//
// Deze tests beschrijven het gewenste eindgedrag (post-mig-257) maar
// kunnen niet runnen zonder een lokale test-DB met seed-data. Ze staan
// hier als levende specificatie + TODO voor wanneer Karpi een test-DB-
// setup heeft (bv. `supabase start` lokaal + seed-script).
//
// Enable strategie:
//   1. Lokale test-DB starten (supabase CLI of dedicated branch).
//   2. Seed-script: minimaal 1 IO-regel `eenheid='stuks'` met openstaande
//      claim, 1 IO-regel `eenheid='m'`, en 1 product met bekende voorraad.
//   3. Vervang `describe.skip` → `describe`, vervang de mock met de echte
//      `@/lib/supabase/client` (eventueel achter env-var `INTEGRATION=1`),
//      en zorg dat elke test in transactie + rollback zit.
//
// Specificatie-comment per test geeft het verwachte gedrag.

describe.skip('boek_inkooporder_ontvangst_stuks — gedrag (vereist test-DB)', () => {
  it.todo('boekt stuks-ontvangst en bumpt producten.voorraad met p_aantal')
  it.todo('consumeert openstaande IO-claim (bron=inkooporder_regel → status=geleverd)')
  it.todo('maakt voorraad-claim (bron=voorraad → status=actief) voor dezelfde orderregel')
  it.todo("verwerpt eenheid='m' IO-regel met 'Gebruik boek_inkooporder_ontvangst_rollen'")
  it.todo('roept herwaardeer_claims_voor_order aan voor elke geraakte order')
  it.todo("flipt IO-status naar 'Deels ontvangen' bij partial fill")
  it.todo("flipt IO-status naar 'Ontvangen' wanneer alle regels te_leveren_m=0")
})

describe.skip('boek_inkooporder_ontvangst_rollen — gedrag (vereist test-DB)', () => {
  it.todo('maakt rollen aan en bumpt geleverd_m op IO-regel')
  it.todo('roept GEEN claim-consume aan — order_reserveringen blijft ongewijzigd')
  it.todo("verwerpt eenheid='stuks' IO-regel met 'Gebruik boek_inkooporder_ontvangst_stuks'")
  it.todo('genereert auto-rolnummer als rolnummer null is')
  it.todo('respecteert handmatig opgegeven rolnummer')
})

describe.skip('DEPRECATED wrappers — forward 1-op-1 (vereist test-DB)', () => {
  it.todo('boek_voorraad_ontvangst gedraagt zich identiek aan boek_inkooporder_ontvangst_stuks')
  it.todo('boek_ontvangst gedraagt zich identiek aan boek_inkooporder_ontvangst_rollen')
})
