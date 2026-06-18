// Logistiek-vervoerder-registry: pure display-data per vervoerder.
//
// Géén berichttypen-registry — adapters bepalen zelf welke payloads ze sturen.
// Sinds mig 424 (ADR-0038) delen alle vervoerders (HST/Verhoek/Rhenus) één
// geconsolideerde tabel `verzend_wachtrij`, gediscrimineerd op `vervoerder_code`
// (verving de aparte `hst_transportorders`/`verhoek_transportorders`/
// `rhenus_transportorders`). Deze registry dient alleen voor UI-mapping
// (display-naam, badge-kleur).
//
// Bron-van-waarheid voor "is deze vervoerder geactiveerd?" blijft de tabel
// `vervoerders` (kolom `actief`). Dit registry-bestand wordt niet automatisch
// gesynchroniseerd; bij toevoegen van een nieuwe vervoerder moet code + DB
// allebei worden bijgewerkt. De mig 170-placeholders edi_partner_a/b zijn
// vervangen door rhenus_sftp/verhoek_sftp.

export type VervoerderCode = 'hst_api' | 'rhenus_sftp' | 'verhoek_sftp'
export type VervoerderType = 'api' | 'edi' | 'sftp'
export type VervoerderBadgeKleur = 'blauw' | 'oranje' | 'paars' | 'grijs'

export interface VervoerderDef {
  code: VervoerderCode
  displayNaam: string
  type: VervoerderType
  badgeKleur: VervoerderBadgeKleur
}

export const VERVOERDER_REGISTRY: Record<VervoerderCode, VervoerderDef> = {
  hst_api:      { code: 'hst_api',      displayNaam: 'HST',     type: 'api',  badgeKleur: 'blauw'  },
  rhenus_sftp:  { code: 'rhenus_sftp',  displayNaam: 'Rhenus',  type: 'sftp', badgeKleur: 'oranje' },
  verhoek_sftp: { code: 'verhoek_sftp', displayNaam: 'Verhoek', type: 'sftp', badgeKleur: 'paars'  },
}

export function getVervoerderDef(code: string | null | undefined): VervoerderDef | null {
  if (!code) return null
  return (VERVOERDER_REGISTRY as Record<string, VervoerderDef>)[code] ?? null
}
