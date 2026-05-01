// frontend/src/lib/types/pick-ship.ts

export type BucketKey =
  | 'achterstallig'
  | 'vandaag'
  | 'morgen'
  | 'deze_week'
  | 'volgende_week'
  | 'later'
  | 'geen_datum'

export const BUCKET_VOLGORDE: BucketKey[] = [
  'achterstallig',
  'vandaag',
  'morgen',
  'deze_week',
  'volgende_week',
  'later',
  'geen_datum',
]

export const BUCKET_LABEL: Record<BucketKey, string> = {
  achterstallig: 'Achterstallig',
  vandaag: 'Vandaag',
  morgen: 'Morgen',
  deze_week: 'Deze week',
  volgende_week: 'Volgende week',
  later: 'Later',
  geen_datum: 'Geen datum',
}

export type PickShipBron = 'snijplan' | 'rol' | 'producten_default' | null
export type PickShipWachtOp = 'snijden' | 'confectie' | 'inpak' | 'inkoop' | null
export type VervoerderSelectieStatus =
  | 'selecteerbaar'
  | 'geen_actieve_vervoerder'
  | 'meerdere_actieve_vervoerders'

export interface PickShipRegel {
  order_regel_id: number
  artikelnr: string | null
  is_maatwerk: boolean
  product: string
  kleur: string | null
  maat_cm: string
  m2: number
  orderaantal: number
  is_pickbaar: boolean
  bron: PickShipBron
  fysieke_locatie: string | null
  wacht_op: PickShipWachtOp
  totaal_stuks?: number | null
  pickbaar_stuks?: number | null
}

export interface PickShipOrder {
  order_id: number
  order_nr: string
  status: string
  klant_naam: string
  debiteur_nr: number
  vervoerder_code: string | null
  vervoerder_naam: string | null
  vervoerder_actief: boolean | null
  vervoerder_selectie_status: VervoerderSelectieStatus
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
  bucket: BucketKey
  regels: PickShipRegel[]
  totaal_m2: number
  aantal_regels: number
}
