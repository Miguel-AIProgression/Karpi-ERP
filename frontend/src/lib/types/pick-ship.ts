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

export interface PickShipRegel {
  snijplan_id: number
  snijplan_nr: string
  scancode: string | null
  product: string
  kleur: string | null
  maat_cm: string
  m2: number
  status: string
  locatie: string | null
}

export interface PickShipOrder {
  order_id: number
  order_nr: string
  klant_naam: string
  debiteur_nr: number
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
  bucket: BucketKey
  regels: PickShipRegel[]
  totaal_m2: number
  aantal_regels: number
}
