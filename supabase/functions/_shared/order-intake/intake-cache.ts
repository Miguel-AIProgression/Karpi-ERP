// Per-order memoization voor de intake-matching (N+1-fix, perf/n1-intake-allocator).
//
// Vóór deze module deed `matchProduct` een verse `klanteigen_namen`-query
// per orderregel, terwijl alle regels van één order dezelfde debiteur_nr
// delen — bij een order met 10 regels dus 10x dezelfde rijenset. Een
// `IntakeCache`-instantie leeft per order (aangemaakt in buildRegels/
// buildLightspeedRegels) en wordt door de regel-loop heen doorgegeven.
// ponytail: cache is per order, niet per batch-run — import-lightspeed-orders
// maakt per order een verse cache; optil naar batch-niveau kan als de
// Floorpassion-poll ooit te veel queries doet.
//
// BEWUST GEEN module-globale cache: edge functions kunnen warm blijven
// tussen requests/orders, dus een module-level Map zou stale
// klanteigen_namen-data laten lekken tussen orders/debiteuren.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface KlanteigenNaamRow {
  benaming: string
  kwaliteit_code: string
}

export interface IntakeCache {
  /** debiteur_nr → alle klanteigen_namen-rijen voor die debiteur (ongefilterd op naam-inhoud). */
  klanteigenNamen: Map<number, Promise<KlanteigenNaamRow[]>>
}

export function createIntakeCache(): IntakeCache {
  return { klanteigenNamen: new Map() }
}

/**
 * Haalt alle `klanteigen_namen` voor een debiteur op — één keer per
 * `IntakeCache`-instantie, ongeacht hoeveel orderregels ernaar vragen.
 * (Was: 1 query per orderregel in `matchProduct`.)
 */
export function getKlanteigenNamen(
  supabase: SupabaseClient,
  cache: IntakeCache,
  debiteurNr: number,
): Promise<KlanteigenNaamRow[]> {
  let pending = cache.klanteigenNamen.get(debiteurNr)
  if (!pending) {
    // Expliciet naar een `Promise` wrappen i.p.v. rechtstreeks de (thenable,
    // maar niet gegarandeerd Promise-vormige) query-builder cachen — anders
    // kan een tweede `.then()`-aanroep op hetzelfde object de query opnieuw
    // triggeren i.p.v. het gecachte resultaat herbruiken.
    pending = (async () => {
      const { data, error } = await supabase
        .from('klanteigen_namen')
        .select('benaming, kwaliteit_code')
        .eq('debiteur_nr', debiteurNr)
      if (error) {
        // Gefaalde fetch NIET cachen: anders zou één transient error álle
        // volgende regels van deze order stil van alias-matching uitsluiten.
        cache.klanteigenNamen.delete(debiteurNr)
        console.error(`getKlanteigenNamen: query gefaald voor debiteur ${debiteurNr}: ${error.message}`)
      }
      return (data ?? []) as KlanteigenNaamRow[]
    })()
    cache.klanteigenNamen.set(debiteurNr, pending)
  }
  return pending
}
