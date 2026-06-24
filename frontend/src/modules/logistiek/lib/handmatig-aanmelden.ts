/**
 * Vervoerders met colli-bundeling (de operator kan meerdere colli samenpakken
 * onder één nieuwe SSCC — mig 420/421). De DB-vlag `vervoerders.handmatig_aanmelden`
 * is de bron-van-waarheid; deze frontend-spiegel stuurt alleen UI-zichtbaarheid
 * van de bundel-sectie + de doorverwijzing vanaf de Verzendset-pagina.
 *
 * NB sinds mig 465: Rhenus wordt na voltooien AUTOMATISCH aangemeld (in de
 * dagbatch om 16:00, via `vervoerders.batch_cutoff_tijd`) — de oude handmatige
 * "Aanmelden bij Rhenus"-stap is vervangen. Deze vlag stuurt nu enkel nog
 * colli-bundeling, niet meer een hold.
 */
export const HANDMATIG_AANMELDEN_VERVOERDERS = ['rhenus_sftp'] as const

export function isHandmatigAanmeldenVervoerder(code: string | null | undefined): boolean {
  return code != null && (HANDMATIG_AANMELDEN_VERVOERDERS as readonly string[]).includes(code)
}
