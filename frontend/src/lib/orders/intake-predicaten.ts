// Bron van waarheid voor het 'Debiteur te bevestigen'-predicaat (mig 322):
// orders met een onzekere fuzzy debiteur-match die nog bevestigd moet worden.
// env_fallback (verzameldebiteur) is bewust GEEN fout en valt af. NULL-safe:
// alleen expliciet env_fallback wordt uitgesloten — een onzekere order zonder
// vastgelegde bron telt mee, anders valt hij stil uit beeld.
//
// Twee adapters die exact dezelfde voorwaarde uitdrukken:
//   - isDebiteurTeBevestigen(order): pure JS-check (order-detail, client-side).
//   - filterDebiteurTeBevestigen(query): PostgREST-filterketen (fetchOrders + count).
// Wijzig de definitie HIER; beide callers volgen automatisch.

export interface DebiteurBevestigVelden {
  debiteur_zeker?: boolean | null
  debiteur_match_bron?: string | null
  status?: string | null
}

export function isDebiteurTeBevestigen(order: DebiteurBevestigVelden): boolean {
  return (
    order.debiteur_zeker === false &&
    order.debiteur_match_bron !== 'env_fallback' &&
    order.status !== 'Geannuleerd'
  )
}

// Minimaal structureel contract van de PostgREST-filterbuilder dat we hier
// gebruiken. We binden dit NIET als generic-constraint op de builder: dat laat TS
// de volledige Supabase-builder-typeketen oneindig diep instantiëren (TS2589),
// met name in array-inferentie-context (Promise.all). In plaats daarvan casten we
// intern. De builder muteert-en-retourneert `this` at runtime, dus de oorspronkelijke
// `query` heeft na de keten dezelfde filters — Q blijft het exacte caller-type.
interface PostgrestEqOrNeq {
  eq(column: string, value: unknown): PostgrestEqOrNeq
  or(filter: string): PostgrestEqOrNeq
  neq(column: string, value: unknown): PostgrestEqOrNeq
}

/** Past de drie 'Debiteur te bevestigen'-filters toe op een query-builder. */
export function filterDebiteurTeBevestigen<Q>(query: Q): Q {
  return (query as unknown as PostgrestEqOrNeq)
    .eq('debiteur_zeker', false)
    .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
    .neq('status', 'Geannuleerd') as unknown as Q
}
