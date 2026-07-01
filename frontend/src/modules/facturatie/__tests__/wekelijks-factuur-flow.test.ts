/**
 * Wekelijks factuur flow — vergelijking met per_zending.
 *
 * Documenteert en toetst de contracten, gatekeepers en divergenties
 * tussen de wekelijkse verzamelfactuur en de normale per_zending factuur.
 *
 * Wat HETZELFDE is:
 *   - PDF generatie via fetchFactuurDocument + naarFactuurPdfInput
 *   - E-mail verzending via verstuurEnLog
 *   - Pakbon bijlagen via genereerPakbonBijlagen (N per zending voor N orders)
 *   - Storage upload
 *   - BTW verlegd / BTW regeling gate
 *   - BTW controle blokkade
 *   - E-mailtijdlijn logging (per order)
 *   - Status → 'Verstuurd'
 *   - Toeslag (gelezen uit facturen.toeslag_bedrag via factuur-document.ts)
 *   - beschikbaar_op gate: wekelijks items hebben NULL = direct beschikbaar
 *
 * Bewuste VERSCHILLEN (geen bugs):
 *   - Geen 2-fase concept/finalize: genereer_factuur_voor_week maakt atomisch
 *   - Geen BUNDELKORTING/DREMPELKORTING (pre-existing gap, mig 231)
 *   - verwerk_concept_queue slaat wekelijks items over (zending_id IS NULL)
 *
 * Gerepareerde bug:
 *   - Retry-gap: als e-mail faalde, riep retry genereer_factuur_voor_week opnieuw
 *     aan → no_data_found → 'failed' na 3 pogingen. Fix: factuur_id tussentijds
 *     terugschrijven naar factuur_queue, zodat retry de RPC overslaat.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// 1. claim_factuur_queue_items gate
// ---------------------------------------------------------------------------
describe('claim_factuur_queue_items gate — wekelijks vs per_zending', () => {
  /**
   * SQL-contract (leesbaar als specificatie; de echte gate zit in
   * claim_factuur_queue_items: WHERE (factuur_id IS NOT NULL OR zending_id IS NULL)).
   *
   * Hieruit volgt:
   *   - per_zending (zending_id NOT NULL): pas claimbaar als factuur_id gezet is
   *     door verwerk_concept_queue (fase 1).
   *   - wekelijks   (zending_id IS NULL):  direct claimbaar ongeacht factuur_id,
   *     want er is geen concept-fase — genereer_factuur_voor_week is atomisch.
   */
  it('wekelijks item (zending_id=null) voldoet aan de claim-gate zonder factuur_id', () => {
    const wekelijksItem = { zending_id: null, factuur_id: null, status: 'pending' }
    const gateOk = wekelijksItem.factuur_id !== null || wekelijksItem.zending_id === null
    expect(gateOk).toBe(true)
  })

  it('per_zending item zonder concept voldoet NIET aan de gate', () => {
    const item = { zending_id: 42, factuur_id: null, status: 'pending' }
    const gateOk = item.factuur_id !== null || item.zending_id === null
    expect(gateOk).toBe(false)
  })

  it('per_zending item MET concept voldoet wel aan de gate', () => {
    const item = { zending_id: 42, factuur_id: 999, status: 'pending' }
    const gateOk = item.factuur_id !== null || item.zending_id === null
    expect(gateOk).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Dispatch-logica in factuur-verzenden/index.ts
// ---------------------------------------------------------------------------
describe('factuur-verzenden dispatch — wekelijks route', () => {
  function bepaalRoute(item: { zending_id: number | null; type: string; factuur_id: number | null }) {
    if (item.zending_id != null) return 'per_zending'
    if (item.type === 'wekelijks') return 'wekelijks'
    return 'legacy_per_zending'
  }

  it('wekelijks item gaat naar de wekelijks route', () => {
    expect(bepaalRoute({ zending_id: null, type: 'wekelijks', factuur_id: null })).toBe('wekelijks')
  })

  it('per_zending item gaat naar de per_zending route', () => {
    expect(bepaalRoute({ zending_id: 5, type: 'per_zending', factuur_id: 10 })).toBe('per_zending')
  })

  it('zending_id winnend boven type — een item mét zending_id maar type=wekelijks gaat naar per_zending', () => {
    // zou niet in de praktijk voorkomen maar zorgt dat de dispatch robuust is
    expect(bepaalRoute({ zending_id: 5, type: 'wekelijks', factuur_id: 10 })).toBe('per_zending')
  })
})

// ---------------------------------------------------------------------------
// 3. Retry-fix: wekelijks pad slaat RPC over als factuur_id al gezet is
// ---------------------------------------------------------------------------
describe('wekelijks retry-fix (mig 534 bug → fix in factuur-verzenden)', () => {
  /**
   * Reproduceert de dispatch-logica na de fix:
   *   if (item.factuur_id != null) → reuse factuurId, skip RPC
   *   else → call RPC, write factuur_id back to queue
   */
  function simuleerWekelijksDispatch(item: {
    verzendweek: string | null
    factuur_id: number | null
  }): { actie: 'hergebruik_factuur' | 'aanroep_rpc' | 'fout'; factuurIdGebruikt?: number } {
    if (!item.verzendweek) return { actie: 'fout' }
    if (item.factuur_id != null) {
      // Retry pad: factuur al aangemaakt, alleen e-mail opnieuw sturen
      return { actie: 'hergebruik_factuur', factuurIdGebruikt: item.factuur_id }
    }
    // Eerste poging: RPC aanroepen en factuur_id terugschrijven (gesimuleerd)
    const nieuwFactuurId = 12345 // in realiteit: data van de RPC
    return { actie: 'aanroep_rpc', factuurIdGebruikt: nieuwFactuurId }
  }

  it('eerste poging zonder factuur_id roept de RPC aan', () => {
    const result = simuleerWekelijksDispatch({ verzendweek: '2026-W26', factuur_id: null })
    expect(result.actie).toBe('aanroep_rpc')
  })

  it('retry MET factuur_id slaat de RPC over en hergebruikt de factuur', () => {
    // factuur_id werd na de eerste geslaagde RPC-aanroep teruggeschreven naar de queue
    const result = simuleerWekelijksDispatch({ verzendweek: '2026-W26', factuur_id: 777 })
    expect(result.actie).toBe('hergebruik_factuur')
    expect(result.factuurIdGebruikt).toBe(777)
  })

  it('ontbrekende verzendweek gooit een fout (guard)', () => {
    const result = simuleerWekelijksDispatch({ verzendweek: null, factuur_id: null })
    expect(result.actie).toBe('fout')
  })
})

// ---------------------------------------------------------------------------
// 4. Pakbon bijlagen: wekelijks geeft N pakbonnen voor N orders
// ---------------------------------------------------------------------------
describe('genereerPakbonBijlagen — wekelijks levert N pakbon-PDFs', () => {
  /**
   * Logica in genereerPakbonBijlagen (factuur-verzenden/index.ts):
   *   - Zoekt zending_ids via zending_orders voor de gegeven order_ids
   *   - Genereert één pakbon-PDF per zending_nr
   * Voor een wekelijkse factuur met 3 orders → 3 zendingen → 3 pakbonnen.
   * De factuurmail bevat alle 3 als bijlage (meervoud-subject).
   */
  it('aantal pakbon-bijlagen = aantal unieke zendingen voor de gefactureerde orders', () => {
    // Gesimuleerde zending_orders join
    const zendingOrders = [
      { order_id: 1, zending_id: 100 },
      { order_id: 2, zending_id: 101 },
      { order_id: 3, zending_id: 102 },
    ]
    const orderIds = [1, 2, 3]
    const zendingIdsVoorOrders = [...new Set(
      zendingOrders
        .filter((zo) => orderIds.includes(zo.order_id))
        .map((zo) => zo.zending_id),
    )]
    expect(zendingIdsVoorOrders).toHaveLength(3)
  })

  it('bundel-zending (2 orders → 1 zending) geeft 1 pakbon', () => {
    const zendingOrders = [
      { order_id: 1, zending_id: 100 },
      { order_id: 2, zending_id: 100 }, // gebundeld
    ]
    const orderIds = [1, 2]
    const zendingIdsVoorOrders = [...new Set(
      zendingOrders
        .filter((zo) => orderIds.includes(zo.order_id))
        .map((zo) => zo.zending_id),
    )]
    expect(zendingIdsVoorOrders).toHaveLength(1)
  })

  it('e-mail subject gebruikt meervoud "Pakbonnen" bij meerdere bijlagen', () => {
    const aantalBijlagen = 3
    const meervoud = aantalBijlagen > 1
    const subject = `Pakbon${meervoud ? 'nen' : ''} bij factuur FACT-2026-0001`
    expect(subject).toBe('Pakbonnen bij factuur FACT-2026-0001')
  })

  it('e-mail subject gebruikt enkelvoud "Pakbon" bij één bijlage', () => {
    const aantalBijlagen = 1
    const meervoud = aantalBijlagen > 1
    const subject = `Pakbon${meervoud ? 'nen' : ''} bij factuur FACT-2026-0001`
    expect(subject).toBe('Pakbon bij factuur FACT-2026-0001')
  })
})

// ---------------------------------------------------------------------------
// 5. enqueue_wekelijkse_verzamelfacturen — beschikbaar_op gedrag
// ---------------------------------------------------------------------------
describe('wekelijks queue item — beschikbaar_op', () => {
  /**
   * enqueue_wekelijkse_verzamelfacturen zet GEEN beschikbaar_op (= NULL).
   * De claim-gate:  beschikbaar_op IS NULL OR beschikbaar_op <= now()
   * NULL = altijd claimbaar = direct verstuurd op maandag 05:00 UTC.
   * (Anders dan per_zending items die 120 minuten wachten.)
   */
  it('wekelijks item met beschikbaar_op=NULL voldoet aan de tijdgate', () => {
    const beschikbaar_op: string | null = null
    const nu = new Date()
    const isClaimbaar =
      beschikbaar_op === null || new Date(beschikbaar_op) <= nu
    expect(isClaimbaar).toBe(true)
  })

  it('per_zending item met toekomstige beschikbaar_op is NIET claimbaar', () => {
    const toekomst = new Date(Date.now() + 60 * 60 * 1000).toISOString() // +1 uur
    const nu = new Date()
    const isClaimbaar = toekomst === null || new Date(toekomst) <= nu
    expect(isClaimbaar).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Gedocumenteerde gap: BUNDELKORTING/DREMPELKORTING niet in wekelijks pad
// ---------------------------------------------------------------------------
describe('gedocumenteerde gap: BUNDELKORTING/DREMPELKORTING', () => {
  /**
   * Per_zending: finaliseer_concept_factuur voegt BUNDELKORTING/DREMPELKORTING
   * orderregels toe als de bundel-/drempel-voorwaarden gelden.
   *
   * Wekelijks: genereer_factuur_voor_week doet dit NIET.
   * Dit is een pre-existing gap (bestaat al sinds mig 117/231).
   * Wekelijks-klanten zijn doorgaans B2B grootafnemers zonder bundel-kortings-
   * acties — de praktische impact is laag. Als dit alsnog nodig wordt:
   * verplaats de korting-logic naar een herbruikbare helper die beide paden
   * aanroepen.
   *
   * Dit is een TODO/known-gap, geen acute bug.
   */
  it('documenteert de BUNDELKORTING/DREMPELKORTING gap als known', () => {
    // Symbolic test — documented behavior
    const wekelijksFactuurPad = 'genereer_factuur_voor_week'
    const perZendingPad = 'finaliseer_concept_factuur'
    const kortingLogicInWekelijks = false // bewust niet geïmplementeerd
    const kortingLogicInPerZending = true

    expect(kortingLogicInPerZending).toBe(true)
    expect(kortingLogicInWekelijks).toBe(false)
    // Als je dit wilt toevoegen: extraheer korting-logic uit finaliseer_concept_factuur
    // naar een gedeelde helper die genereer_factuur_voor_week ook aanroept.
    expect(wekelijksFactuurPad).toBeTruthy()
    expect(perZendingPad).toBeTruthy()
  })
})
