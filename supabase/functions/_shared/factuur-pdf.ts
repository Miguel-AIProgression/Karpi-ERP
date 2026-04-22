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
}

export interface FactuurPDFRegel {
  order_nr: string
  uw_referentie: string
  artikelnr: string
  aantal: number
  eenheid: string
  omschrijving: string
  omschrijving_2?: string
  prijs: number
  bedrag: number
}

export interface FactuurPDFInput {
  bedrijf: BedrijfsInfo
  factuur: FactuurHeader
  regels: FactuurPDFRegel[]
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

// Footer Y
const FOOTER_Y = 15 * MM

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
 * Draw the Karpi BV company header (top-right block) and "FACTUUR" title.
 * Appears on every page (first and continuation).
 */
function drawPageHeader(
  page: PDFPage,
  bedrijf: BedrijfsInfo,
  regular: PDFFont,
  bold: PDFFont,
) {
  const x = PAGE_W - 80 * MM

  // Company name — bold ~12pt
  drawText(page, bedrijf.bedrijfsnaam, x, HEADER_COMPANY_Y, bold, 12)

  // Address lines — 7pt regular
  const y2 = HEADER_COMPANY_Y - LINE_H
  const y3 = y2 - LINE_H
  const y4 = y3 - LINE_H
  const y5 = y4 - LINE_H

  drawText(page, bedrijf.adres, x, y2, regular, 7)
  drawText(page, `${bedrijf.postcode}  ${bedrijf.plaats}  (${bedrijf.land})`, x, y3, regular, 7)

  const telFax = bedrijf.fax
    ? `t ${bedrijf.telefoon}  |  f ${bedrijf.fax}`
    : `t ${bedrijf.telefoon}`
  drawText(page, telFax, x, y4, regular, 7)
  drawText(page, `e ${bedrijf.email}  |  i ${bedrijf.website}`, x, y5, regular, 7)

  // Horizontal rule
  drawHLine(page, HEADER_LINE_Y, MARGIN_L, PAGE_W - MARGIN_R)

  // "FACTUUR" title — bold 11pt, left margin
  drawText(page, 'FACTUUR', MARGIN_L, HEADER_TITLE_Y, bold, 11)
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
  // Klant-blok (left)
  let y = KLANT_BLOCK_Y
  drawText(page, factuur.fact_naam, MARGIN_L, y, bold, 10)
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
 * Draw the footer on every page (k.v.k., BTW, bank, IBAN, BIC).
 */
function drawFooter(
  page: PDFPage,
  bedrijf: BedrijfsInfo,
  regular: PDFFont,
) {
  const text = `k.v.k. ${bedrijf.kvk}  |  btw ${bedrijf.btw_nummer}  |  ${bedrijf.bank}  |  nr ${bedrijf.rekeningnummer}  |  BIC ${bedrijf.bic}  |  IBAN ${bedrijf.iban}`
  const SIZE = 6
  const w = regular.widthOfTextAtSize(text, SIZE)
  const x = (PAGE_W - w) / 2
  drawText(page, text, x, FOOTER_Y, regular, SIZE)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function genereerFactuurPDF(input: FactuurPDFInput): Promise<Uint8Array> {
  const { bedrijf, factuur, regels } = input

  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Courier)
  const bold    = await pdfDoc.embedFont(StandardFonts.CourierBold)

  // Helper: add a new page with the shared header + table header drawn in.
  // Returns { page, cursorY } ready for body content.
  function addPage(isContinuation: boolean): { page: PDFPage; cursorY: number } {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    drawPageHeader(page, bedrijf, regular, bold)
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

  // Helper: ensure there is room for `neededMM` mm of content.
  // If not, performs a page-break: draws TRANSPORTEREN on old page, creates new page,
  // draws TRANSPORT on new page below table header.
  function ensureRoom(neededMM: number): void {
    const neededPt = neededMM * MM
    if (cursorY - neededPt < BODY_STOP) {
      // Draw "TRANSPORTEREN BLAD" on old page
      const { page: newPage, cursorY: newCursorStart } = addPage(true)
      // Transport line goes on the old page just above BODY_STOP
      const transportY = BODY_STOP - LINE_H
      // Draw TRANSPORTEREN on the old page
      drawTextRight(page, `TRANSPORTEREN BLAD   ${formatBedrag(paginaTotaal)}`, COL_BEDRAG, transportY, bold, 10)

      // Draw TRANSPORT on new page, just below table header
      drawTextRight(newPage, `TRANSPORT BLAD   ${formatBedrag(paginaTotaal)}`, COL_BEDRAG, newCursorStart, bold, 10)

      page = newPage
      cursorY = newCursorStart - LINE_H
    }
  }

  for (const [orderNr, groepRegels] of groupMap.entries()) {
    // Each group needs: 1 blank + order header (2 lines) + 1 blank = 4 lines min before first body line
    const groepHeaderMM = 4 * (LINE_H / MM)  // 4 lines in mm = 16mm
    ensureRoom(groepHeaderMM)

    // Blank line
    cursorY -= LINE_H

    // Group header lines
    const uw_ref = groepRegels[0].uw_referentie
    drawText(page, `Ons Ordernummer : ${orderNr}`, MARGIN_L, cursorY, regular, 9)
    cursorY -= LINE_H
    drawText(page, `Uw Referentie   : ${uw_ref}`, MARGIN_L, cursorY, regular, 9)
    cursorY -= LINE_H

    // Blank line after group header
    cursorY -= LINE_H

    // Draw each regel in the group
    for (const r of groepRegels) {
      // Determine rows needed: 1 for main line, +1 if omschrijving_2
      const rowCount = r.omschrijving_2 ? 2 : 1
      const neededLineMM = rowCount * (LINE_H / MM)
      ensureRoom(neededLineMM)

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

      // Optional second omschrijving line
      if (r.omschrijving_2) {
        ensureRoom(LINE_H / MM)
        drawText(page, r.omschrijving_2, COL_OMSCHR, cursorY, regular, SIZE)
        cursorY -= LINE_H
      }
    }
  }

  // Draw BTW / payment block on last page
  drawBtwBlok(page, cursorY, factuur, bedrijf, regular, bold)

  return pdfDoc.save()
}
