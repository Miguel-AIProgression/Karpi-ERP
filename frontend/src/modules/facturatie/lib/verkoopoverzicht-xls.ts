import type { VerkoopoverzichtRij } from '../queries/verkoopoverzicht'

// Header in exact dezelfde volgorde + spelling als het oude ERP-export
// formaat. AFAS-import-mapping leunt op deze kolomnamen.
const KOLOM_HEADERS = [
  'Debiteur',
  'Naam1',
  'Naam2',
  'Adres',
  'Postcode',
  'Woonplaats',
  'Land',
  'Ordernummer',
  'Klant ref',
  'Factuurnr',
  'Datum',
  'Verv.datum',
  'Bedrag ex',
  'BTW bedrag',
  'Totaal',
] as const

export interface BuildOptions {
  rijen: VerkoopoverzichtRij[]
  vanDatum: string // ISO YYYY-MM-DD
  totDatum: string
}

export interface BuildResultaat {
  bestandsnaam: string
  bytes: Uint8Array
}

export function buildVerkoopoverzichtXls(opts: BuildOptions): BuildResultaat {
  const regels: string[] = []
  regels.push(KOLOM_HEADERS.join('\t'))
  for (const r of opts.rijen) {
    regels.push(
      [
        String(r.debiteur_nr),
        r.naam1 ?? '',
        r.naam2 ?? '',
        r.adres ?? '',
        padPostcode(r.postcode),
        r.plaats ?? '',
        formatLand(r.land),
        r.ordernummers ?? '',
        r.klant_refs ?? '',
        r.factuur_nr,
        formatDatum(r.factuurdatum),
        formatVervaldatum(r.vervaldatum),
        formatBedrag(r.bedrag_ex),
        formatBedrag(r.btw_bedrag),
        formatBedrag(r.totaal),
      ]
        .map(stripTab)
        .join('\t'),
    )
  }
  // Oude export had LF (geen CRLF) en eindigde zonder trailing newline na
  // de laatste regel; matchen we voor bit-identieke output.
  const tekst = regels.join('\n')
  return {
    bestandsnaam: bouwBestandsnaam(opts.vanDatum, opts.totDatum),
    bytes: encodeIso88591(tekst),
  }
}

export function downloadVerkoopoverzichtXls(opts: BuildOptions): void {
  const { bestandsnaam, bytes } = buildVerkoopoverzichtXls(opts)
  // application/vnd.ms-excel zodat Excel het bestand direct herkent als
  // sheet (matched oude .XLS-MIME); content is feitelijk TSV maar Excel
  // opent het correct vanwege de tab-separator.
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.ms-excel' })
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
  // ISO YYYY-MM-DD → YYYYMMDD
  const v = van.replace(/-/g, '')
  const t = tot.replace(/-/g, '')
  return `VERK_OVERZICHT_VAN_${v}_TOT_${t}.XLS`
}

function padPostcode(pc: string | null): string {
  if (!pc) return ''
  // Oud systeem padde postcode tot 7 chars (NL "1234 AB" past al, BE "2440"
  // wordt "2440   "). Behoud trailing spaces voor bit-identieke output.
  return pc.length >= 7 ? pc : pc + ' '.repeat(7 - pc.length)
}

function formatLand(land: string | null): string {
  if (!land) return ''
  const code = land.trim().toUpperCase()
  if (code === '' || code === 'NL' || code === 'NEDERLAND') return ''
  if (code === 'BE' || code === 'BELGIE' || code === 'BELGIË') return 'België'
  if (code === 'DE' || code === 'DUITSLAND') return 'Duitsland'
  if (code === 'FR' || code === 'FRANKRIJK') return 'Frankrijk'
  if (code === 'LU' || code === 'LUXEMBURG') return 'Luxemburg'
  if (code === 'GB' || code === 'UK') return 'Verenigd Koninkrijk'
  // Fallback: letterlijke waarde uit de database.
  return land
}

function formatDatum(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}-${m[2]}-${m[1]}`
}

function formatVervaldatum(iso: string | null): string {
  // Oud systeem toonde "Onbekend!" bij ontbrekende vervaldatum. In RugFlow
  // is `vervaldatum` NOT NULL — maar voor robuustheid behouden we de
  // fallback (bv. legacy import-data).
  if (!iso) return 'Onbekend!'
  return formatDatum(iso)
}

export function formatBedrag(n: number): string {
  // Match oud format: rond getal → puur integer ("316"), anders 2
  // decimalen met komma als scheidingsteken ("1621,11"). Negatieve
  // bedragen krijgen een minteken: "-356,95".
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n))
  return n.toFixed(2).replace('.', ',')
}

function stripTab(s: string): string {
  // Defensief: tab-tekens in vrije velden zouden de kolommen verschuiven.
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

function encodeIso88591(s: string): Uint8Array {
  // ISO-8859-1: codepoint == byte voor U+0000..U+00FF. Hogere codepoints
  // (emoji, CJK) komen niet voor in factuurdata, maar voor robuustheid
  // mappen we ze naar '?'. Windows-1252 (de feitelijke encoding van het
  // oude .XLS) is een superset met enkele extra chars in 0x80..0x9F —
  // die mappen we apart voor "€", "—", etc.
  const buf = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 0xff) {
      buf[i] = c
      continue
    }
    // Windows-1252 high-range mapping voor karakters die regelmatig
    // voorkomen in NL teksten.
    switch (c) {
      case 0x20ac: buf[i] = 0x80; break // €
      case 0x201a: buf[i] = 0x82; break // ‚
      case 0x0192: buf[i] = 0x83; break // ƒ
      case 0x201e: buf[i] = 0x84; break // „
      case 0x2026: buf[i] = 0x85; break // …
      case 0x2020: buf[i] = 0x86; break // †
      case 0x2021: buf[i] = 0x87; break // ‡
      case 0x02c6: buf[i] = 0x88; break // ˆ
      case 0x2030: buf[i] = 0x89; break // ‰
      case 0x0160: buf[i] = 0x8a; break // Š
      case 0x2039: buf[i] = 0x8b; break // ‹
      case 0x0152: buf[i] = 0x8c; break // Œ
      case 0x017d: buf[i] = 0x8e; break // Ž
      case 0x2018: buf[i] = 0x91; break // '
      case 0x2019: buf[i] = 0x92; break // '
      case 0x201c: buf[i] = 0x93; break // "
      case 0x201d: buf[i] = 0x94; break // "
      case 0x2022: buf[i] = 0x95; break // •
      case 0x2013: buf[i] = 0x96; break // –
      case 0x2014: buf[i] = 0x97; break // —
      case 0x02dc: buf[i] = 0x98; break // ˜
      case 0x2122: buf[i] = 0x99; break // ™
      case 0x0161: buf[i] = 0x9a; break // š
      case 0x203a: buf[i] = 0x9b; break // ›
      case 0x0153: buf[i] = 0x9c; break // œ
      case 0x017e: buf[i] = 0x9e; break // ž
      case 0x0178: buf[i] = 0x9f; break // Ÿ
      default: buf[i] = 0x3f // '?'
    }
  }
  return buf
}
