// Logistiek-vervoerder-registry: pure display-data per vervoerder.
//
// Géén berichttypen-registry — adapters bepalen zelf welke payloads ze sturen.
// HST gebruikt `hst_transportorders`; Verhoek en Rhenus hebben eigen
// SFTP-adapter-tabellen (`verhoek_transportorders` mig 375 / ADR-0031,
// `rhenus_transportorders` mig 380 / ADR-0032). Deze registry dient alleen
// voor UI-mapping (display-naam, badge-kleur).
//
// Bron-van-waarheid voor "is deze vervoerder geactiveerd?" blijft de tabel
// `vervoerders` (kolom `actief`). Dit registry-bestand wordt niet automatisch
// gesynchroniseerd; bij toevoegen van een nieuwe vervoerder moet code + DB
// allebei worden bijgewerkt. De mig 170-placeholders edi_partner_a/b zijn
// vervangen door rhenus_sftp/verhoek_sftp.

export type VervoerderCode = 'hst_api' | 'rhenus_sftp' | 'verhoek_sftp' | 'eigen_vervoer'
export type VervoerderType = 'api' | 'edi' | 'sftp' | 'eigen'
export type VervoerderBadgeKleur = 'blauw' | 'oranje' | 'paars' | 'grijs'

export interface VervoerderDef {
  code: VervoerderCode
  displayNaam: string
  type: VervoerderType
  badgeKleur: VervoerderBadgeKleur
}

export const VERVOERDER_REGISTRY: Record<VervoerderCode, VervoerderDef> = {
  hst_api:       { code: 'hst_api',       displayNaam: 'HST',           type: 'api',   badgeKleur: 'blauw'  },
  rhenus_sftp:   { code: 'rhenus_sftp',   displayNaam: 'Rhenus',        type: 'sftp',  badgeKleur: 'oranje' },
  verhoek_sftp:  { code: 'verhoek_sftp',  displayNaam: 'Verhoek',       type: 'sftp',  badgeKleur: 'paars'  },
  // Eigen vervoer (mig 424): geen externe koppeling, alleen colli/label/pakbon.
  eigen_vervoer: { code: 'eigen_vervoer', displayNaam: 'Eigen vervoer', type: 'eigen', badgeKleur: 'grijs'  },
}

export function getVervoerderDef(code: string | null | undefined): VervoerderDef | null {
  if (!code) return null
  return (VERVOERDER_REGISTRY as Record<string, VervoerderDef>)[code] ?? null
}
