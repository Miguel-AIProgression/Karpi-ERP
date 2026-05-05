/**
 * Fixture: verzendkosten gaan naar het duurste sub-order bij splitsing (T007)
 *
 * Scenario: maatwerk-deel (€ 450) > standaard-deel (€ 120)
 * → verzendkosten-regel staat op het maatwerk-deel
 *
 * Business-rule (mig 0182): bij gesplitste orders bepaalt kies_duurste_suborder()
 * op welk sub-order de verzendkosten-regel belandt. Huidig gedrag is passief
 * (was_split = false), maar de routing is verankerd via 'verzendkosten_routing'
 * in het commit-resultaat.
 *
 * Dit is een TypeScript-only fixture (geen runtime DB-test).
 */
import type { CommitOrderVoorstelResult } from '../../hooks/use-order-voorstel'

export const fixtureVerzendkostenDuursteDeel = {
  scenario: 'maatwerk_duurder_dan_standaard',
  maatwerk_totaal_eur: 450,
  standaard_totaal_eur: 120,
  verwacht: 'verzendkosten_op_maatwerk_deel',

  /**
   * Het commit-resultaat dat de DB retourneert na mig 0182.
   * 'verzendkosten_routing' is altijd aanwezig en geeft aan welke strategie
   * actief is. Bij was_split=true (toekomstige splitsing) wordt de routing
   * ook daadwerkelijk doorgevoerd.
   */
  verwachte_commit_result: {
    order_id: 1001,
    was_split: true,
    split_reason: 'maatwerk_apart',
    verzendkosten_routing: 'duurste_suborder',
  } satisfies Partial<CommitOrderVoorstelResult & { verzendkosten_routing: string }>,
} as const

// ─── Compileer-tijd assertions ───────────────────────────────────────────────

// verzendkosten_routing veld moet aanwezig zijn in CommitOrderVoorstelResult
type _HasVerzendkostenRouting = CommitOrderVoorstelResult['verzendkosten_routing']
const _assertOptionalString: _HasVerzendkostenRouting = 'duurste_suborder'
void _assertOptionalString

// Huidig passief gedrag (was_split = false) — dit is wat de DB nu teruggeeft
export const passieveCommitResult: CommitOrderVoorstelResult = {
  order_id: 1001,
  was_split: false,
  split_reason: null,
  verzendkosten_routing: 'duurste_suborder',
  claim_summary: {
    totaal: 2,
    voorraad: 3,
    op_inkoop: 0,
    uitwisselbaar: 0,
    wacht: 0,
  },
  afwijking_t_o_v_voorstel: [],
}
