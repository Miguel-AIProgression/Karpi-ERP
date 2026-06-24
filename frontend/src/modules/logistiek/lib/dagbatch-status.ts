/**
 * Afgeleide "Aangemeld"-status voor zendingen die op hun dagbatch wachten (mig 484).
 *
 * Een dagbatch-vervoerder (nu alleen Rhenus, via `vervoerders.batch_cutoff_tijd`)
 * wordt na pickronde-voltooien automatisch ge-enqueued, maar pas om de cutoff
 * (16:00) verstuurd. In dat venster staat de ZENDING nog op 'Klaar voor verzending'
 * (de echte enum/state-machine blijft ongemoeid — bewust géén nieuwe status-waarde,
 * dat zou alle status-filters/views/pickronde-tellingen raken) terwijl de
 * verzend-wachtrij-rij 'Wachtrij' is met een geplande `beschikbaar_op`.
 *
 * Dit predicaat detecteert dat venster en stuurt enkel een UI-label. Carrier-
 * agnostisch: HST/Verhoek zetten geen `beschikbaar_op` (NULL → direct versturen),
 * dus alleen batch-zendingen krijgen het label.
 */
export const DAGBATCH_LABEL = 'Aangemeld'

export interface DagbatchWachtrijRij {
  status: string
  beschikbaar_op: string | null
}

/** True als de zending klaarstaat en op zijn dagbatch-moment wacht (nog niet verstuurd). */
export function wachtOpDagbatch(
  zendingStatus: string,
  wachtrij: DagbatchWachtrijRij[] | null | undefined,
): boolean {
  if (zendingStatus !== 'Klaar voor verzending') return false
  return (wachtrij ?? []).some((r) => r.status === 'Wachtrij' && r.beschikbaar_op != null)
}
