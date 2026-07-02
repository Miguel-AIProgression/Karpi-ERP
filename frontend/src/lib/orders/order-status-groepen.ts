// Twee assen voor het orders-overzicht (zie ook ADR-0016):
//  • FASE = de order-status zelf — waar zit de order in de flow. Voedt de
//    status-dropdown (compact, geen scrollbalk).
//  • AANDACHT = afgeleide, status-overstijgende vlaggen die om een menselijke
//    actie vragen. Voeden de 'Vereist actie'-meldingenkaart; een vlag wordt
//    alleen getoond als z'n teller > 0.
//
// Betekenis van de aandacht-vlaggen:
// 'Actie vereist'          = Wacht op voorraad ∪ Wacht op inkoop ∪ heeft_unmatched_regels.
// 'Manco'                  = open manco-werklijst (mig 518) — rendert de MancoTab.
// 'Te bevestigen'          = EDI-orders met onbevestigde leverweek (edi_bevestigd_op IS NULL).
// 'Debiteur te bevestigen' = onzekere fuzzy debiteur-match (mig 322).
// 'Levertijd gewijzigd'    = leverweek verschoven door een ETA-update (mig 326).
// 'Afleveradres ontbreekt' = onvolledig afleveradres-snapshot (mig 395).
// 'Prijs ontbreekt'        = ≥1 regel zonder prijs (mig 396).
// 'Geen verzendweek'       = order zonder afleverdatum (geen weekindeling in Pick & Ship).
// 'Verzendweek verstreken' = afleverdatum in het verleden maar nog niet (deels) verzonden
//                            (achterstallige verzending; langst over tijd bovenaan).
// 'Had mankement'          = order waarop ooit een manco gedetecteerd is (mig 518).

export const ALLE_STATUS = 'Alle'

export const FASE_STATUSES = [
  'Klaar voor picken',
  'Wacht op voorraad',
  'Wacht op inkoop',
  'Wacht op maatwerk',
  'Wacht op combi-levering',
  'In pickronde',
  'Deels verzonden',
  'Verzonden',
  'Geannuleerd',
] as const

export const AANDACHT_STATUSES = [
  'Manco',
  'Te bevestigen',
  'Debiteur te bevestigen',
  'Levertijd gewijzigd',
  'Afleveradres ontbreekt',
  'Prijs ontbreekt',
  'Geen verzendweek',
  'Verzendweek verstreken',
] as const

// Informatieve filters: geen direct oplosbare actie, wél handig om op te kunnen
// filteren. Verschijnen onderaan de status-dropdown (niet in de meldingenkaart).
// 'Actie vereist' = Wacht op voorraad ∪ Wacht op inkoop ∪ unmatched — grotendeels
//   wachten op inkoop, daar valt niks aan te doen; de wacht-statussen staan
//   bovendien al los in de dropdown.
// 'Had mankement' = order waarop ooit een manco gedetecteerd is (mig 518) —
//   historisch; 'Manco' (de open werklijst) hoort wél bij de aandacht-vlaggen.
export const FILTER_STATUSES = ['Actie vereist', 'Had mankement'] as const
