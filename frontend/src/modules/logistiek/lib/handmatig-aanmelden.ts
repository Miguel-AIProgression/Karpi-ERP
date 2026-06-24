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
 * Bundelt deze vervoerder op een PALLET? Dan kiest de operator bij het bundelen een
 * pallet-type. HST (mig 485): EP/SP → PackageUnitID. Rhenus (mig 489): PLTS/HPLT →
 * packageTypeCode + footprint-width. Beide vervoerders bundelen op pallet.
 */
export function bundelOpPallet(code: string | null | undefined): boolean {
  return code === 'hst_api' || code === 'rhenus_sftp'
}

/** Eén pallet-type-keuze in de bundel-UI. `value` gaat naar `maak_colli_bundel.p_pallet_type`
 *  (behalve de zak-sentinel hieronder, die → NULL). */
export interface PalletTypeOptie {
  value: string
  label: string
}

/** UI-sentinel voor de oorspronkelijke "zak"-bundel (geen pallet) — mapt naar
 *  pallet_type NULL in de RPC → RLEN, géén footprint/hoogte. */
export const RHENUS_GEEN_PALLET = 'ZAK'

/**
 * Pallet-type-opties per vervoerder. HST: EP/SP (PackageUnitID, mig 485). Rhenus:
 * "zak" (geen pallet, RLEN) + PLTS/HPLT (packageTypeCode + footprint, mig 489/490).
 * De zak-optie blijft bestaan zodat de operator óók een gewone bundel kan maken.
 */
export function palletTypeOpties(code: string | null | undefined): PalletTypeOptie[] {
  if (code === 'hst_api') {
    return [
      { value: 'EP', label: 'EP — Europallet' },
      { value: 'SP', label: 'SP — wegwerp pallet' },
    ]
  }
  if (code === 'rhenus_sftp') {
    return [
      { value: RHENUS_GEEN_PALLET, label: 'Geen pallet (zak)' },
      { value: 'PLTS', label: 'Volle pallet (80 × 120 cm)' },
      { value: 'HPLT', label: 'Halve pallet (80 × 60 cm)' },
    ]
  }
  return []
}

/**
 * Pallet-footprint (lengte×breedte in cm) per Rhenus-pallet-type, voor de UI-prefill
 * van de lengte/breedte-velden. Spiegelt de server-side default in `maak_colli_bundel`
 * (mig 489/490) — bewust 2 plekken (SQL kan geen TS importeren); ISO-pallet-standaard,
 * drift-risico nihil. De server blijft autoritatief voor wat opgeslagen wordt.
 */
export const PALLET_FOOTPRINT: Record<string, { lengteCm: number; breedteCm: number }> = {
  PLTS: { lengteCm: 80, breedteCm: 120 },
  HPLT: { lengteCm: 80, breedteCm: 60 },
}

export function palletFootprint(value: string | null | undefined): { lengteCm: number; breedteCm: number } | null {
  return value ? (PALLET_FOOTPRINT[value] ?? null) : null
}

/** Is dit een echte pallet (footprint + laadhoogte van toepassing)? Zak/'' = nee. */
export function isFootprintPallet(value: string | null | undefined): boolean {
  return value === 'PLTS' || value === 'HPLT'
}
