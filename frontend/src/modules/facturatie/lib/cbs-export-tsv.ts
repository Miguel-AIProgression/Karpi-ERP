import type { CbsExportRij } from '../queries/cbs-export'

// Kolomvolgorde + spelling matchen de Basta-export ("fbacbs") 1-op-1, incl.
// de trailing lege kolom — zodat de bestaande CBS-aangiftesoftware dit
// bestand ongewijzigd kan inlezen.
const KOLOM_HEADERS = [
  'Partner ID',
  'Land van herkomst/bestemming',
  'Land van oorsprong',
  'Transactie',
  'Vervoerswijze',
  'Leveringsvoorwaarden',
  'Goederencode',
  'Netto gewicht',
  'Bijzondere maatstaf',
  'Factuurwaarde',
  'Factuurvaluta',
  'Factuurwaarde vreemde valuta',
  'Eigen administratienummer',
  '',
] as const

export interface BuildOptions {
  rijen: CbsExportRij[]
  vanDatum: string // ISO YYYY-MM-DD
  totDatum: string
}

export interface BuildResultaat {
  bestandsnaam: string
  tekst: string
}

/** Numeriek veld, 10-cijferig zero-padded — exact het Basta-format. */
function pad10(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(10, '0')
}

export function buildCbsExportTsv(opts: BuildOptions): BuildResultaat {
  const regels: string[] = []
  regels.push(KOLOM_HEADERS.join('\t'))
  for (const r of opts.rijen) {
    regels.push(
      [
        r.partner_id ?? '',
        r.land_bestemming ?? '',
        r.land_oorsprong,
        r.transactie,
        r.vervoerswijze,
        r.leveringsvoorwaarden,
        r.goederencode ?? '',
        pad10(r.netto_gewicht_kg),
        pad10(r.bijzondere_maatstaf),
        pad10(r.factuurwaarde),
        r.factuurvaluta,
        '',
        r.eigen_administratienummer,
        '',
      ]
        .map(stripTabEnNewline)
        .join('\t'),
    )
  }
  // Basta-export gebruikt CRLF (DOS-stijl) — matchen voor compatibiliteit
  // met de bestaande CBS-aangiftesoftware.
  return {
    bestandsnaam: bouwBestandsnaam(opts.vanDatum, opts.totDatum),
    tekst: regels.join('\r\n') + '\r\n',
  }
}

export function downloadCbsExportTsv(opts: BuildOptions): void {
  const { bestandsnaam, tekst } = buildCbsExportTsv(opts)
  const blob = new Blob([tekst], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = bestandsnaam
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function bouwBestandsnaam(van: string, tot: string): string {
  const v = van.replace(/-/g, '')
  const t = tot.replace(/-/g, '')
  return `CBS_INTRASTAT_VAN_${v}_TOT_${t}.txt`
}

function stripTabEnNewline(s: string): string {
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}
