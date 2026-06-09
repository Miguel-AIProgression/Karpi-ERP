// Levertijd-wijziging-seam (mig 326): bepaalt of een order een onbevestigde
// levertijd-wijziging heeft die het gevolg is van een leverancier/Karpi
// ETA-update op een gekoppelde inkooporderregel (sync_order_afleverdatum_eta).
//
// Gate-conventie: orders.levertijd_wijziging_te_bevestigen_sinds wordt gezet
// (op now()) zodra de ISO-leverweek daadwerkelijk verschuift, en teruggezet op
// NULL door de operator via markeer_levertijd_herbevestigd. NULL = niets open.
// Eén nullable timestamp i.p.v. een gemeld_op/bevestigd_op-paar (zoals
// edi_gewenste_afleverdatum/edi_bevestigd_op): deze gate gaat — anders dan de
// eenmalige EDI-gate — herhaaldelijk open/dicht, en PostgREST kan niet filteren
// op kolom-vs-kolom-vergelijkingen. "IS NOT NULL" is hier zowel het filterbare
// predicaat als de weergavewaarde ("te bevestigen sinds <tijdstip>").

export interface LevertijdWijzigingOrderVelden {
  levertijd_wijziging_te_bevestigen_sinds?: string | null
  status?: string | null
}

/** True als deze order een levertijd-wijziging heeft die nog herbevestigd moet worden. */
export function isLevertijdWijzigingTeBevestigen(order: LevertijdWijzigingOrderVelden): boolean {
  if (!order.levertijd_wijziging_te_bevestigen_sinds) return false
  if (order.status === 'Verzonden' || order.status === 'Geannuleerd') return false
  return true
}
