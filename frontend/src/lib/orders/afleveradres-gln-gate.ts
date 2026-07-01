// Afleveradres-GLN-gate-seam (mig 535): bepaalt of een EDI-order geblokkeerd is
// doordat de aflever-GLN geen vestiging matcht (create_edi_order viel stil terug
// op het debiteur-hoofdadres, mig 357) en het adres nog niet bewust is vrijgegeven.
//
// Twee nullable timestamps op orders (zoals de prijs-gate, mig 396):
//   afl_gln_ongekoppeld_sinds  — AUTO (trigger): GLN matcht geen vestiging
//   afl_gln_gecontroleerd_op   — HANDMATIG (markeer_afleveradres_gecontroleerd)
// BLOK = ongekoppeld_sinds gezet EN gecontroleerd_op nog NULL. GLN koppelen aan
// een vestiging wist ongekoppeld_sinds automatisch (afleveradressen-trigger).
// Eindstatussen tellen niet mee.

export interface AfleveradresGlnGateVelden {
  afl_gln_ongekoppeld_sinds?: string | null
  afl_gln_gecontroleerd_op?: string | null
  status?: string | null
}

/** True als deze order geblokkeerd is op de aflever-GLN-gate (niet gekoppeld én niet vrijgegeven). */
export function isAfleveradresGlnGeblokkeerd(order: AfleveradresGlnGateVelden): boolean {
  if (!order.afl_gln_ongekoppeld_sinds) return false
  if (order.afl_gln_gecontroleerd_op) return false
  if (order.status === 'Verzonden' || order.status === 'Geannuleerd') return false
  return true
}
