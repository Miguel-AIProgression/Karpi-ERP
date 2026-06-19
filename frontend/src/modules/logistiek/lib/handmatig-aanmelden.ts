/**
 * Vervoerders die een multi-colli-zending NIET automatisch aanmelden, maar
 * na pickronde-voltooiing vasthouden op 'Klaar voor verzending' tot de operator
 * handmatig vrijgeeft — zodat hij eerst colli kan samenpakken (colli-bundeling,
 * mig 420). De DB-vlag `vervoerders.handmatig_aanmelden` is de bron-van-waarheid;
 * deze frontend-spiegel stuurt alleen UI-zichtbaarheid en de doorverwijzing
 * vanaf de Verzendset-pagina naar de zending-detailpagina (waar de bundel-sectie
 * en "Aanmelden bij Rhenus" staan).
 */
export const HANDMATIG_AANMELDEN_VERVOERDERS = ['rhenus_sftp'] as const

export function isHandmatigAanmeldenVervoerder(code: string | null | undefined): boolean {
  return code != null && (HANDMATIG_AANMELDEN_VERVOERDERS as readonly string[]).includes(code)
}
