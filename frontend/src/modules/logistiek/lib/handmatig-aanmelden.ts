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

/**
 * Vervoerders die colli-bundeling TIJDENS de pickronde ondersteunen (de "Colli
 * bundelen"-knop op de Verzendset-pagina). Bredere set dan `isHandmatigAanmeldenVervoerder`:
 * HST bundelt ook (mig 485, op pallet), maar meldt — anders dan Rhenus' 16:00-batch —
 * direct na 'Voltooi pickronde' aan, dus zónder de post-voltooi-bundel-sectie/hold.
 * De DB-vlag `vervoerders.handmatig_aanmelden` (TRUE voor beide) is de bron-van-waarheid.
 */
export const COLLI_BUNDEL_VERVOERDERS = ['rhenus_sftp', 'hst_api'] as const

export function ondersteuntColliBundelen(code: string | null | undefined): boolean {
  return code != null && (COLLI_BUNDEL_VERVOERDERS as readonly string[]).includes(code)
}

/**
 * Bundelt deze vervoerder op een PALLET (EP=Europallet / SP=wegwerp pallet, mig 485)?
 * Dan moet de operator bij het bundelen een pallet-type kiezen → HST PackageUnitID.
 * Rhenus bundelt in een zak (geen pallet-type).
 */
export function bundelOpPallet(code: string | null | undefined): boolean {
  return code === 'hst_api'
}
