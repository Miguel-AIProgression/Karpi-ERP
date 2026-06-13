// Bron van waarheid voor het 'Te koppelen'-predicaat (mig 306/307): een
// inkomend EDI-order-bericht dat (nog) geen order werd. Filtert op order_id
// IS NULL, NIET op status — de poll laat de status soms op 'Verwerkt' staan
// terwijl order-creatie faalde (geen GLN-match).

export interface TeKoppelenVelden {
  richting: string
  berichttype: string
  order_id: number | null
}

export function isTeKoppelen(b: TeKoppelenVelden): boolean {
  return b.richting === 'in' && b.berichttype === 'order' && b.order_id == null
}

// Minimaal structureel contract van de PostgREST-filterbuilder. Niet als
// generic-constraint gebonden (zou TS de Supabase-builder-typeketen oneindig
// diep laten instantiëren — TS2589); intern gecast. De builder muteert-en-
// retourneert `this`, dus de oorspronkelijke query houdt na de keten de filters.
interface PostgrestEqIs {
  eq(column: string, value: unknown): PostgrestEqIs
  is(column: string, value: unknown): PostgrestEqIs
}

/** Query-tegenhanger van isTeKoppelen. */
export function filterTeKoppelen<Q>(query: Q): Q {
  return (query as unknown as PostgrestEqIs)
    .eq('richting', 'in')
    .eq('berichttype', 'order')
    .is('order_id', null) as unknown as Q
}
