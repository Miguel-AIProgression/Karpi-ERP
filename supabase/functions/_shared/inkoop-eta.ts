import { isoDatum } from './werkagenda.ts'

/** Een inkoop-ETA die al verstreken is zonder dat de regel (volledig) geleverd is.
 *  Puur zichtbaarheid — verandert niets aan matching/koppeling (de inkoop komt
 *  alsnog, alleen de datum klopt niet meer en moet bijgewerkt worden). */
export function isAchterstalligeEta(verwachtDatum: string | null, vandaag: string = isoDatum(new Date())): boolean {
  return verwachtDatum != null && verwachtDatum < vandaag
}
