// PDF-generator voor Karpi BV facturen.
// Gebruik: `genereerFactuurPDF(input)` → Uint8Array (PDF-bytes).
// Runtime: Deno Edge Function (pdf-lib via esm.sh).
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1'

// ---------------------------------------------------------------------------
// Types (exported — re-used by factuur-verzenden edge function)
// ---------------------------------------------------------------------------

export interface BedrijfsBank {
  bank: string
  rekeningnummer: string
  bic: string
  iban: string
  blz?: string  // Duitse Bankleitzahl, alleen relevant voor 2e bank
}

export interface BedrijfsInfo {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  fax?: string
  email: string
  website: string
  kvk: string
  btw_nummer: string
  iban: string
  bic: string
  bank: string
  rekeningnummer: string
  betalingscondities_tekst: string
  // Tweede bank (bv. Commerzbank AG Bocholt). Optioneel — als gevuld, krijgt elke
  // pagina-footer een tweede regel onder de hoofd-bankregel.
  bank2?: BedrijfsBank
  // Drie-talige algemene voorwaarden-tekst voor de footer.
  // Als opgegeven, wordt onderaan elke pagina een 3-koloms tekstblok afgedrukt.
  voorwaarden_nl?: string
  voorwaarden_de?: string
  voorwaarden_en?: string
}

// Logo bytes (JPG of PNG) en gewenste afmeting in punten.
export interface LogoOptie {
  bytes: Uint8Array
  format: 'jpg' | 'png'
  // Hoogte in mm waarop het logo gerenderd wordt; breedte volgt uit aspect ratio.
  hoogte_mm: number
}

export interface FactuurHeader {
  factuur_nr: string
  factuurdatum: string // ISO: YYYY-MM-DD
  debiteur_nr: number
  vertegenwoordiger: string
  fact_naam: string
  fact_adres: string
  fact_postcode: string
  fact_plaats: string
  subtotaal: number
  btw_percentage: number
  btw_bedrag: number
  totaal: number
  totaal_m2?: number
  totaal_gewicht_kg?: number
}

export interface FactuurAfleveradres {
  naam: string
  naam_2?: string
  adres: string
  postcode: string
  plaats: string
}

export interface FactuurPDFRegel {
  order_nr: string
  uw_referentie: string
  artikelnr: string
  aantal: number
  eenheid: string
  omschrijving: string
  // Multi-line: "BANGKOK KLEUR 21 ca: 230x260 cm\nBand: PE21\nUw model:DESTINO"
  // Elke regel wordt apart onder de hoofdregel afgedrukt.
  omschrijving_2?: string
  prijs: number
  bedrag: number
  // Per order in de groep: alleen op de eerste regel van een order-groep getoond.
  // Wanneer afleveradres = factuuradres laat de caller dit weg.
  afleveradres?: FactuurAfleveradres
}

export interface FactuurPDFInput {
  bedrijf: BedrijfsInfo
  factuur: FactuurHeader
  regels: FactuurPDFRegel[]
  logo?: LogoOptie
}

// ---------------------------------------------------------------------------
// Constants (mm → pt: 1mm = 2.8346457 pt)
// ---------------------------------------------------------------------------

const MM = 2.8346457

const PAGE_W = 210 * MM  // 595.28 pt (A4 portrait width)
const PAGE_H = 297 * MM  // 841.89 pt (A4 portrait height)

const MARGIN_L = 20 * MM   //  56.69 pt
const MARGIN_R = 20 * MM   //  56.69 pt
const MARGIN_B = 25 * MM   //  70.87 pt

const LINE_H = 4 * MM      //  11.34 pt (normal line height)

// Overflow check: stop drawing body when cursorY drops below this
const BODY_STOP = MARGIN_B + 15 * MM   // 40mm from bottom = 113.39 pt

// Y-positions (measured from bottom of page, pdf-lib convention)
const HEADER_COMPANY_Y   = PAGE_H - 15 * MM   // top-right company block start
const HEADER_LINE_Y      = PAGE_H - 35 * MM   // thin horizontal rule
const HEADER_TITLE_Y     = PAGE_H - 30 * MM   // "FACTUUR" label
const KLANT_BLOCK_Y      = PAGE_H - 55 * MM   // customer address block (page 1)
const INFO_BLOCK_Y       = PAGE_H - 55 * MM   // right info block (page 1)
const TABLE_HEADER_Y_P1  = PAGE_H - 90 * MM   // table header, page 1
const TABLE_HEADER_Y_CN  = PAGE_H - 45 * MM   // table header, continuation pages

// Column X positions
const COL_ARTIKEL   = MARGIN_L
const COL_AANTAL    = MARGIN_L + 45 * MM   // right-aligned within 10mm width
const COL_AANTAL_W  = 10 * MM
const COL_EH        = MARGIN_L + 60 * MM
const COL_OMSCHR    = MARGIN_L + 68 * MM
const COL_PRIJS     = PAGE_W - MARGIN_R - 45 * MM  // right-aligned
const COL_BEDRAG    = PAGE_W - MARGIN_R             // right-aligned

// Transport-regel: 3 right-aligned posities binnen het tabel-gebied.
// Visueel: "TRANSPORTEREN     BLAD     762.49"
const COL_TRANSP_LABEL = COL_PRIJS - 5 * MM   // right-edge van "TRANSPORTEREN" / "TRANSPORT"
const COL_TRANSP_BLAD  = COL_PRIJS + 8 * MM   // right-edge van "BLAD"
// bedrag eindigt op COL_BEDRAG

// Order-header labels uitlijnen op vaste prefix-breedte (Courier monospace).
// "Ons Ordernummer ", "Uw Referentie   ", "Afleveradres    " — alle 16 chars vóór ":".
const ORDER_LABEL_BREEDTE = 16

// Footer Y
const FOOTER_Y = 15 * MM
const FOOTER_BANK1_Y = 15 * MM
const FOOTER_BANK2_Y = 11 * MM
const FOOTER_VOORWAARDEN_TOP_Y = 8 * MM    // bovenkant van het 3-koloms voorwaarden-blok
const FOOTER_VOORWAARDEN_HOOGTE = 6 * MM   // beschikbare hoogte voor de 3 kolommen

// Karpi-oranje (afgeleid uit het logo: gouden lijn-kleur)
const KARPI_ORANJE = { r: 0.76, g: 0.53, b: 0.22 }

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBedrag(n: number): string {
  return n.toFixed(2)
}

function formatDatumNL(iso: string): string {
  // YYYY-MM-DD → DD-MM-YYYY
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}-${parts[1]}-${parts[0]}`
}

function padLabel(label: string, breedte: number): string {
  if (label.length >= breedte) return label
  return label + ' '.repeat(breedte - label.length)
}

// ---------------------------------------------------------------------------
// Low-level draw helpers
// ---------------------------------------------------------------------------

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
) {
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })
}

function drawTextRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightX - w, y, size, font, color: rgb(0, 0, 0) })
}

function drawHLine(page: PDFPage, y: number, x1: number = MARGIN_L, x2: number = PAGE_W - MARGIN_R) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  })
}

// ---------------------------------------------------------------------------
// Page-level drawing blocks
// ---------------------------------------------------------------------------

/**
 * Draw the Karpi BV company header on every page:
 *   - "FACTUUR" links (bold)
 *   - KARPI GROUP-logo gecentreerd (alleen als logoImage gevuld is)
 *   - KARPI BV in oranje rechts + adres + contact in zwart
 */
function drawPageHeader(
  page: PDFPage,
  bedrijf: BedrijfsInfo,
  regular: PDFFont,
  bold: PDFFont,
  logoImage: { width: number; height: number; draw: (x: number, y: number, w: number, h: number) => void } | null,
) {
  // Logo gecentreerd (boven HEADER_LINE_Y)
  if (logoImage) {
    const logoH = 18 * MM
    const logoW = (logoImage.width / logoImage.height) * logoH
    const logoX = (PAGE_W - logoW) / 2
    const logoY = PAGE_H - 10 * MM - logoH
    logoImage.draw(logoX, logoY, logoW, logoH)
  }

  // KARPI BV (rechtsboven, oranje)
  const x = PAGE_W - 80 * MM
  page.drawText(bedrijf.bedrijfsnaam, {
    x,
    y: HEADER_COMPANY_Y,
    size: 8,
    font: bold,
    color: rgb(KARPI_ORANJE.r, KARPI_ORANJE.g, KARPI_ORANJE.b),
  })

  // Adres + contact (zwart, 7pt regular)
  const y2 = HEADER_COMPANY_Y - LINE_H
  const y3 = y2 - LINE_H
  const y4 = y3 - LINE_H

  drawText(page, `${bedrijf.adres}, ${bedrijf.postcode} ${bedrijf.plaats} (${bedrijf.land})`, x, y2, regular, 7)

  const telFax = bedrijf.fax
    ? `t ${bedrijf.telefoon}  |  f ${bedrijf.fax}`
    : `t ${bedrijf.telefoon}`
  drawText(page, telFax, x, y3, regular, 7)
  drawText(page, `e ${bedrijf.email}  |  i ${bedrijf.website}`, x, y4, regular, 7)

  // "FACTUUR" links (klein, bold). De zware horizontale rule uit de oude layout
  // is in het Karpi-template vervangen door de gouden lijn IN het logo.
  drawText(page, 'FACTUUR', MARGIN_L, HEADER_TITLE_Y, bold, 9)
}

/**
 * Draw customer address block (left) and invoice info block (right).
 * Only on the first page.
 */
function drawFirstPageBlocks(
  page: PDFPage,
  factuur: FactuurHeader,
  regular: PDFFont,
  bold: PDFFont,
) {
  // Klant-blok (left) — Karpi-template: alle regels regular (geen bold op naam)
  let y = KLANT_BLOCK_Y
  drawText(page, factuur.fact_naam, MARGIN_L, y, regular, 10)
  y -= LINE_H  // blank line
  y -= LINE_H
  drawText(page, factuur.fact_adres, MARGIN_L, y, regular, 10)
  y -= LINE_H
  drawText(page, `${factuur.fact_postcode}  ${factuur.fact_plaats}`, MARGIN_L, y, regular, 10)

  // Info-blok (right) — labels 9pt
  const infoX = PAGE_W - 90 * MM
  const SIZE = 9
  let iy = INFO_BLOCK_Y

  drawText(page, `Uw debiteurnummer: ${factuur.debiteur_nr}`, infoX, iy, regular, SIZE)
  iy -= LINE_H
  drawText(page, `Factuurnummer    : ${factuur.factuur_nr}`, infoX, iy, regular, SIZE)
  iy -= LINE_H
  drawText(page, `Factuurdatum     : ${formatDatumNL(factuur.factuurdatum)}`, infoX, iy, regular, SIZE)
  iy -= LINE_H
  drawText(page, `Vertegenwoordiger: ${factuur.vertegenwoordiger}`, infoX, iy, regular, SIZE)
}

/**
 * Draw the table header row (column labels + underline).
 * Used on every page at the given y-position.
 * Returns the y-position after the header row (cursor for first body row).
 */
function drawTableHeader(
  page: PDFPage,
  y: number,
  regular: PDFFont,
  bold: PDFFont,
): number {
  const SIZE = 9
  drawText(page, 'Artikel',       COL_ARTIKEL,        y, bold, SIZE)
  drawTextRight(page, 'Aantal',   COL_AANTAL + COL_AANTAL_W, y, bold, SIZE)
  drawText(page, 'Eh',            COL_EH,             y, bold, SIZE)
  drawText(page, 'Omschrijving',  COL_OMSCHR,         y, bold, SIZE)
  drawTextRight(page, 'Prijs',    COL_PRIJS,          y, bold, SIZE)
  drawTextRight(page, 'Bedrag',   COL_BEDRAG,         y, bold, SIZE)

  const lineY = y - 1 * MM
  drawHLine(page, lineY)

  return y - LINE_H - 1 * MM
}

/**
 * Draw the BTW / payment block at the bottom of the last page.
 * Returns the y after the block (informational, not used further).
 */
function drawBtwBlok(
  page: PDFPage,
  y: number,
  factuur: FactuurHeader,
  bedrijf: BedrijfsInfo,
  regular: PDFFont,
  bold: PDFFont,
): number {
  y -= LINE_H  // blank line before block

  // Optionele "Totaal m2 / Totaal gewicht"-regel boven het BTW-blok
  if (factuur.totaal_m2 !== undefined || factuur.totaal_gewicht_kg !== undefined) {
    const m2Str = factuur.totaal_m2 !== undefined
      ? `Totaal m2: ${factuur.totaal_m2.toFixed(2)}`
      : ''
    const gewichtStr = factuur.totaal_gewicht_kg !== undefined
      ? `Totaal gewicht (kg): ${factuur.totaal_gewicht_kg.toFixed(2)}`
      : ''
    const samen = [m2Str, gewichtStr].filter(Boolean).join('   ')
    drawText(page, samen, MARGIN_L + 5 * MM, y, regular, 9)
    y -= LINE_H
    y -= LINE_H  // blank line
  }

  // Top horizontal rule
  drawHLine(page, y)
  y -= LINE_H

  // Header row: labels
  const SIZE_BOLD = 9
  drawText(page, 'Grondsl.', MARGIN_L, y, bold, SIZE_BOLD)
  drawText(page, 'BTW %', MARGIN_L + 30 * MM, y, bold, SIZE_BOLD)
  drawText(page, 'BTWbedrag', MARGIN_L + 50 * MM, y, bold, SIZE_BOLD)
  drawTextRight(page, 'Te Betalen', COL_BEDRAG, y, bold, SIZE_BOLD)

  y -= 1 * MM
  drawHLine(page, y)
  y -= LINE_H

  // Values row
  const SIZE = 10
  drawText(page, formatBedrag(factuur.subtotaal), MARGIN_L, y, regular, SIZE)
  drawText(page, `${factuur.btw_percentage}`, MARGIN_L + 30 * MM, y, regular, SIZE)
  drawText(page, formatBedrag(factuur.btw_bedrag), MARGIN_L + 50 * MM, y, regular, SIZE)
  drawTextRight(page, `${formatBedrag(factuur.totaal)} EUR`, COL_BEDRAG, y, regular, SIZE)

  y -= LINE_H  // blank line
  y -= LINE_H

  // Payment conditions
  drawText(page, `Betalingscond.: ${bedrijf.betalingscondities_tekst}`, MARGIN_L, y, regular, 8)

  return y
}

/**
 * Draw the footer on every page:
 *   - Eerste bankregel (NL): k.v.k., BTW, hoofd-bank
 *   - Optionele tweede bankregel (DE): Commerzbank etc.
 *   - Optionele 3-koloms voorwaarden-tekst (NL/DE/EN)
 */
function drawFooter(
  page: PDFPage,
  bedrijf: BedrijfsInfo,
  regular: PDFFont,
) {
  const SIZE_BANK = 6
  const bank1 = `k.v.k. ${bedrijf.kvk}  |  btw ${bedrijf.btw_nummer}  |  ${bedrijf.bank}  |  nr ${bedrijf.rekeningnummer}  |  BIC ${bedrijf.bic}  |  IBAN ${bedrijf.iban}`
  const w1 = regular.widthOfTextAtSize(bank1, SIZE_BANK)
  drawText(page, bank1, (PAGE_W - w1) / 2, FOOTER_BANK1_Y, regular, SIZE_BANK)

  if (bedrijf.bank2) {
    const b2 = bedrijf.bank2
    const blzPart = b2.blz ? `  |  Blz ${b2.blz}` : ''
    const bank2 = `${b2.bank}  |  Konto ${b2.rekeningnummer}${blzPart}  |  BIC ${b2.bic}  |  IBAN ${b2.iban}`
    const w2 = regular.widthOfTextAtSize(bank2, SIZE_BANK)
    drawText(page, bank2, (PAGE_W - w2) / 2, FOOTER_BANK2_Y, regular, SIZE_BANK)
  }

  // 3-koloms voorwaarden-tekst (NL / DE / EN). Alleen renderen als minstens
  // één taal opgegeven is; lege talen krijgen een lege kolom.
  const heeftVoorwaarden = bedrijf.voorwaarden_nl || bedrijf.voorwaarden_de || bedrijf.voorwaarden_en
  if (heeftVoorwaarden) {
    const SIZE_VW = 4
    const kolomBreedte = (PAGE_W - 2 * MARGIN_L) / 3 - 2 * MM
    const xNL = MARGIN_L
    const xDE = MARGIN_L + (PAGE_W - 2 * MARGIN_L) / 3
    const xEN = MARGIN_L + 2 * (PAGE_W - 2 * MARGIN_L) / 3

    drawWrappedText(page, bedrijf.voorwaarden_nl ?? '', xNL, FOOTER_VOORWAARDEN_TOP_Y, kolomBreedte, regular, SIZE_VW)
    drawWrappedText(page, bedrijf.voorwaarden_de ?? '', xDE, FOOTER_VOORWAARDEN_TOP_Y, kolomBreedte, regular, SIZE_VW)
    drawWrappedText(page, bedrijf.voorwaarden_en ?? '', xEN, FOOTER_VOORWAARDEN_TOP_Y, kolomBreedte, regular, SIZE_VW)
  }
}

/**
 * Eenvoudige word-wrap renderer: tekent `text` in regels die binnen `maxWidth` blijven,
 * te beginnen op (x, yTop) en aflopend per regel. Stopt zodra ruimte op is.
 */
function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  yTop: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
): void {
  if (!text) return
  const woorden = text.replace(/\s+/g, ' ').trim().split(' ')
  const lineHeight = size * 1.15
  let regel = ''
  let y = yTop
  const yMin = MARGIN_B - 5 * MM  // niet te ver naar de bodem

  for (const woord of woorden) {
    const kandidaat = regel.length === 0 ? woord : `${regel} ${woord}`
    const breedte = font.widthOfTextAtSize(kandidaat, size)
    if (breedte > maxWidth && regel.length > 0) {
      drawText(page, regel, x, y, font, size)
      y -= lineHeight
      if (y < yMin) return
      regel = woord
    } else {
      regel = kandidaat
    }
  }
  if (regel.length > 0 && y >= yMin) {
    drawText(page, regel, x, y, font, size)
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function genereerFactuurPDF(input: FactuurPDFInput): Promise<Uint8Array> {
  const { bedrijf, factuur, regels, logo } = input

  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Courier)
  const bold    = await pdfDoc.embedFont(StandardFonts.CourierBold)

  // Embed logo één keer voor de hele PDF; pdf-lib laat hetzelfde image-object
  // op meerdere pagina's tekenen, dus we hergebruiken via closure in addPage.
  const logoCache = logo
    ? (logo.format === 'png'
        ? await pdfDoc.embedPng(logo.bytes)
        : await pdfDoc.embedJpg(logo.bytes))
    : null

  function addPage(isContinuation: boolean): { page: PDFPage; cursorY: number } {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])

    const pageLogoImage = logoCache
      ? {
          width: logoCache.width,
          height: logoCache.height,
          draw: (x: number, y: number, w: number, h: number) =>
            page.drawImage(logoCache, { x, y, width: w, height: h }),
        }
      : null

    drawPageHeader(page, bedrijf, regular, bold, pageLogoImage)
    drawFooter(page, bedrijf, regular)

    if (!isContinuation) {
      drawFirstPageBlocks(page, factuur, regular, bold)
      const cursorY = drawTableHeader(page, TABLE_HEADER_Y_P1, regular, bold)
      return { page, cursorY }
    } else {
      const cursorY = drawTableHeader(page, TABLE_HEADER_Y_CN, regular, bold)
      return { page, cursorY }
    }
  }

  // Start first page
  let { page, cursorY } = addPage(false)

  // Group regels by order_nr (preserve order)
  const groupMap = new Map<string, FactuurPDFRegel[]>()
  for (const regel of regels) {
    const group = groupMap.get(regel.order_nr)
    if (group) {
      group.push(regel)
    } else {
      groupMap.set(regel.order_nr, [regel])
    }
  }

  // Running page subtotal for TRANSPORT lines
  let paginaTotaal = 0

  // Helper: 3-koloms transport-regel zoals Karpi-template:
  // "TRANSPORTEREN     BLAD     762.49"  → label rechts, BLAD rechts, bedrag rechts.
  function drawTransportRegel(targetPage: PDFPage, y: number, label: 'TRANSPORTEREN' | 'TRANSPORT', bedrag: number): void {
    drawTextRight(targetPage, label, COL_TRANSP_LABEL, y, bold, 9)
    drawTextRight(targetPage, 'BLAD', COL_TRANSP_BLAD, y, bold, 9)
    drawTextRight(targetPage, formatBedrag(bedrag), COL_BEDRAG, y, bold, 9)
  }

  // Helper: ensure there is room for `neededMM` mm of content.
  // If not, performs a page-break: draws TRANSPORTEREN on old page, creates new page,
  // draws TRANSPORT on new page below table header.
  function ensureRoom(neededMM: number): void {
    const neededPt = neededMM * MM
    if (cursorY - neededPt < BODY_STOP) {
      const { page: newPage, cursorY: newCursorStart } = addPage(true)
      const transportY = BODY_STOP - LINE_H

      drawTransportRegel(page, transportY, 'TRANSPORTEREN', paginaTotaal)
      drawTransportRegel(newPage, newCursorStart, 'TRANSPORT', paginaTotaal)

      page = newPage
      cursorY = newCursorStart - LINE_H
    }
  }

  for (const [orderNr, groepRegels] of groupMap.entries()) {
    const eersteRegel = groepRegels[0]
    const aflever = eersteRegel.afleveradres
    // 1 blank + Ons Ordernummer + Uw Referentie + (afleveradres: naam + opt. naam_2 + adres + plaats) + 1 blank
    const aflRegels = aflever
      ? 1 + (aflever.naam_2 ? 1 : 0) + 1 + 1 // naam (+naam_2) + adres + postcode/plaats
      : 0
    const groepHeaderRegels = 1 + 2 + aflRegels + 1
    ensureRoom(groepHeaderRegels * (LINE_H / MM))

    // Blank line
    cursorY -= LINE_H

    // Group header lines — labels op vaste prefix-breedte zodat alle ":" uitlijnen.
    drawText(page, `${padLabel('Ons Ordernummer', ORDER_LABEL_BREEDTE)}: ${orderNr}`, MARGIN_L, cursorY, regular, 9)
    cursorY -= LINE_H
    drawText(page, `${padLabel('Uw Referentie', ORDER_LABEL_BREEDTE)}: ${eersteRegel.uw_referentie}`, MARGIN_L, cursorY, regular, 9)
    cursorY -= LINE_H

    if (aflever) {
      // "Afleveradres    : <naam>"
      drawText(page, `${padLabel('Afleveradres', ORDER_LABEL_BREEDTE)}: ${aflever.naam}`, MARGIN_L, cursorY, regular, 9)
      cursorY -= LINE_H
      // Vervolgregels op dezelfde indent als de waarde (na ": ")
      const indentX = MARGIN_L + (regular.widthOfTextAtSize(`${padLabel('Afleveradres', ORDER_LABEL_BREEDTE)}: `, 9))
      if (aflever.naam_2) {
        drawText(page, aflever.naam_2, indentX, cursorY, regular, 9)
        cursorY -= LINE_H
      }
      drawText(page, aflever.adres, indentX, cursorY, regular, 9)
      cursorY -= LINE_H
      drawText(page, `${aflever.postcode}  ${aflever.plaats}`, indentX, cursorY, regular, 9)
      cursorY -= LINE_H
    }

    // Blank line after group header
    cursorY -= LINE_H

    // Draw each regel in the group
    for (const r of groepRegels) {
      const extraRegels = r.omschrijving_2 ? r.omschrijving_2.split('\n').filter(s => s.length > 0) : []
      const rowCount = 1 + extraRegels.length
      ensureRoom(rowCount * (LINE_H / MM))

      // Main regel line (9pt)
      const SIZE = 9
      drawText(page, r.artikelnr, COL_ARTIKEL, cursorY, regular, SIZE)
      drawTextRight(page, String(r.aantal), COL_AANTAL + COL_AANTAL_W, cursorY, regular, SIZE)
      drawText(page, r.eenheid, COL_EH, cursorY, regular, SIZE)
      drawText(page, r.omschrijving, COL_OMSCHR, cursorY, regular, SIZE)
      drawTextRight(page, formatBedrag(r.prijs), COL_PRIJS, cursorY, regular, SIZE)
      drawTextRight(page, formatBedrag(r.bedrag), COL_BEDRAG, cursorY, regular, SIZE)

      paginaTotaal += r.bedrag
      cursorY -= LINE_H

      // Vervolgregels (BANGKOK KLEUR ..., Band: ..., Uw model:..., MEERWERKKOSTEN ...)
      for (const extra of extraRegels) {
        ensureRoom(LINE_H / MM)
        drawText(page, extra, COL_OMSCHR, cursorY, regular, SIZE)
        cursorY -= LINE_H
      }
    }
  }

  // Draw BTW / payment block on last page
  drawBtwBlok(page, cursorY, factuur, bedrijf, regular, bold)

  return pdfDoc.save()
}
