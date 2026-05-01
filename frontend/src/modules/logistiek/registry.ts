// Logistiek-vervoerder-registry: pure display-data per vervoerder.
//
// Géén berichttypen-registry — adapters bepalen zelf welke payloads ze sturen.
// HST gebruikt `hst_transportorders`, EDI-vervoerders (Rhenus/Verhoek) gebruiken
// bestaande `edi_berichten` met berichttype='verzendbericht'. Deze registry
// dient alleen voor UI-mapping (display-naam, badge-kleur).
//
// Bron-van-waarheid voor "is deze vervoerder geactiveerd?" blijft de tabel
// `vervoerders` (kolom `actief`). Dit registry-bestand wordt niet automatisch
// gesynchroniseerd; bij toevoegen van een nieuwe vervoerder moet code + DB
// allebei worden bijgewerkt.

export type VervoerderCode = 'hst_api' | 'edi_partner_a' | 'edi_partner_b'
export type VervoerderType = 'api' | 'edi'
export type VervoerderBadgeKleur = 'blauw' | 'oranje' | 'paars' | 'grijs'

export interface VervoerderDef {
  code: VervoerderCode
  displayNaam: string
  type: VervoerderType
  badgeKleur: VervoerderBadgeKleur
}

export const VERVOERDER_REGISTRY: Record<VervoerderCode, VervoerderDef> = {
  hst_api:       { code: 'hst_api',       displayNaam: 'HST',     type: 'api', badgeKleur: 'blauw'  },
  edi_partner_a: { code: 'edi_partner_a', displayNaam: 'Rhenus',  type: 'edi', badgeKleur: 'oranje' },
  edi_partner_b: { code: 'edi_partner_b', displayNaam: 'Verhoek', type: 'edi', badgeKleur: 'paars'  },
}

export function getVervoerderDef(code: string | null | undefined): VervoerderDef | null {
  if (!code) return null
  return (VERVOERDER_REGISTRY as Record<string, VervoerderDef>)[code] ?? null
}
