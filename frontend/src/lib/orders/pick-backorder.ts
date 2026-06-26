// Bron van waarheid voor het 'Pick-backorder'-predicaat (mig 465): orderregels
// die tijdens een Pickronde niet gevonden zijn en wachten op beoordeling op de
// Backorder-tab. Open = pick_backorder_sinds gezet EN nog niet geannuleerd.
//
// Twee adapters die exact dezelfde voorwaarde uitdrukken (patroon
// intake-predicaten.ts):
//   - isPickBackorder(regel): pure JS-check (client-side, regel-niveau).
//   - filterPickBackorder(query): PostgREST-filterketen (fetchBackorderRegels + count).
// Wijzig de definitie HIER; beide callers volgen automatisch.

export interface PickBackorderVelden {
  pick_backorder_sinds?: string | null
  pick_backorder_geannuleerd_op?: string | null
}

export function isPickBackorder(regel: PickBackorderVelden): boolean {
  return regel.pick_backorder_sinds != null && regel.pick_backorder_geannuleerd_op == null
}

// Minimaal structureel contract van de PostgREST-filterbuilder dat we hier
// gebruiken. We binden dit NIET als generic-constraint op de builder: dat laat TS
// de volledige Supabase-builder-typeketen oneindig diep instantiëren (TS2589),
// met name in array-inferentie-context. In plaats daarvan casten we intern. De
// builder muteert-en-retourneert `this` at runtime, dus de oorspronkelijke
// `query` heeft na de keten dezelfde filters — Q blijft het exacte caller-type.
interface PostgrestIs {
  not(column: string, op: string, value: unknown): PostgrestIs
  is(column: string, value: unknown): PostgrestIs
}

/** Filtert order_regels op open backorder (sinds gezet, nog niet geannuleerd). */
export function filterPickBackorder<Q>(query: Q): Q {
  return (query as unknown as PostgrestIs)
    .not('pick_backorder_sinds', 'is', null)
    .is('pick_backorder_geannuleerd_op', null) as unknown as Q
}
