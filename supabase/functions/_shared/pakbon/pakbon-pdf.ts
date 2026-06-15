// PDF-renderer voor de Karpi-pakbon. Dunne lay-out-laag bovenop het canonieke
// `PakbonDocument` (alle presentatie-beslissingen zitten al in dat document).
// Runtime: Deno Edge Function (pdf-lib via esm.sh). Spiegelt de stijl van
// factuur-pdf.ts / orderbevestiging-pdf.ts zodat de pakbon dezelfde Karpi-
// huisstijl draagt als de andere uitgaande documenten.

import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1'
import type { PakbonBedrijf, PakbonDocument } from './types.ts'
import { nlGewicht } from './pakbon-document.ts'

const PT_PER_MM = 72 / 25.4
function mm(v: number) { return v * PT_PER_MM }

const BLACK = rgb(0, 0, 0)
const SLATE = rgb(0.35, 0.4, 0.45)
const KARPI_ORANJE = rgb(0.76, 0.53, 0.22)

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = BLACK) {
  page.drawText(text ?? '', { x, y, font, size, color })
}

function drawTextRight(page: PDFPage, text: string, rightX: number, y: number, font: PDFFont, size: number, color = BLACK) {
  const w = font.widthOfTextAtSize(text ?? '', size)
  page.drawText(text ?? '', { x: rightX - w, y, font, size, color })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text ?? '').split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

export interface PakbonPdfLogo {
  bytes: Uint8Array
  format: 'jpg' | 'png'
}

/** Genereert de pakbon-PDF (A4) uit het canonieke document. */
export async function genereerPakbonPDF(
  doc: PakbonDocument,
  bedrijf: PakbonBedrijf,
  logo?: PakbonPdfLogo,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fontR = await pdf.embedFont(StandardFonts.Helvetica)
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = mm(210)
  const pageH = mm(297)
  const mL = mm(15)
  const mR = mm(15)
  const mT = mm(15)

  let logoImg: PDFImage | null = null
  if (logo) {
    try {
      logoImg = logo.format === 'png'
        ? await pdf.embedPng(logo.bytes)
        : await pdf.embedJpg(logo.bytes)
    } catch {
      logoImg = null
    }
  }

  let page = pdf.addPage([pageW, pageH])

  // ── Kolommen voor de artikeltabel (tellen op tot pageW - mL - mR = 180mm) ──
  const colRgl = { x: mL, w: mm(10) }
  const colArt = { x: mL + mm(10), w: mm(32) }
  const colOms = { x: mL + mm(42), w: mm(96) }
  const colBes = { x: mL + mm(138), w: mm(21) }
  const colGel = { x: mL + mm(159), w: mm(21) }

  const tekenHeader = (): number => {
    let y = pageH - mm(8)
    // Logo gecentreerd, of "KARPI GROUP"-tekstmerk.
    if (logoImg) {
      const logoH = mm(16)
      const logoW = logoImg.width * (logoH / logoImg.height)
      page.drawImage(logoImg, { x: (pageW - logoW) / 2, y: y - logoH, width: logoW, height: logoH })
    } else {
      drawTextRight(page, 'KARPI', pageW / 2 + mm(12), y - mm(8), fontB, 22)
    }
    // Bedrijfsgegevens rechts.
    const rightX = pageW - mR
    drawTextRight(page, bedrijf.bedrijfsnaam, rightX, pageH - mm(8), fontB, 8, KARPI_ORANJE)
    drawTextRight(page, `${bedrijf.adres}, ${bedrijf.postcode} ${bedrijf.plaats}`, rightX, pageH - mm(12), fontR, 6, SLATE)
    if (bedrijf.telefoon) drawTextRight(page, `t ${bedrijf.telefoon}`, rightX, pageH - mm(15.5), fontR, 6, SLATE)
    drawTextRight(page, `e ${bedrijf.email} | i ${bedrijf.website}`, rightX, pageH - mm(19), fontR, 6, SLATE)
    return y - mm(22)
  }

  const tekenFooter = (p: PDFPage) => {
    const parts = [
      `KvK ${bedrijf.kvk}`,
      `BTW ${bedrijf.btw_nummer}`,
      bedrijf.iban ? `IBAN ${bedrijf.iban}` : null,
      bedrijf.bic ? `BIC ${bedrijf.bic}` : null,
    ].filter(Boolean) as string[]
    drawText(p, parts.join('   |   '), mL, mm(10), fontR, 6.5, SLATE)
  }

  let y = tekenHeader()

  // ── Titel + pakbonnr/datum ────────────────────────────────────────────────
  drawText(page, 'PAKBON', mL, y, fontB, 16)
  const metaX = mL + mm(120)
  drawText(page, 'Pakbonnr:', metaX, y, fontB, 8)
  drawText(page, doc.pakbonnr, metaX + mm(22), y, fontR, 8)
  drawText(page, 'Datum:', metaX, y - mm(5), fontB, 8)
  drawText(page, doc.datum, metaX + mm(22), y - mm(5), fontR, 8)
  y -= mm(16)

  // ── Afleveradres (rechterkolom) ───────────────────────────────────────────
  const adresX = mL + mm(110)
  drawText(page, 'Afleveradres:', adresX, y, fontB, 8, SLATE)
  let ay = y - mm(5)
  for (const regel of doc.afleveradres) {
    drawText(page, regel.toUpperCase(), adresX, ay, fontR, 8)
    ay -= mm(4.5)
  }
  if (doc.afleverTelefoon) {
    ay -= mm(1)
    drawText(page, doc.afleverTelefoon, adresX, ay, fontR, 8)
    ay -= mm(4.5)
  }

  // ── Referentieblok (linkerkolom) ──────────────────────────────────────────
  let ly = y
  const labelWaarde = (label: string, waarde: string) => {
    drawText(page, label, mL, ly, fontB, 8)
    drawText(page, waarde, mL + mm(32), ly, fontR, 8)
    ly -= mm(5)
  }
  if (doc.isBundel) {
    labelWaarde('Vertegenw.:', doc.vertegenwoordiger)
    labelWaarde('Debiteur:', doc.debiteur)
    labelWaarde('Orders:', `${doc.bundelRegels.length} orders gebundeld`)
    for (const br of doc.bundelRegels) {
      drawText(page, br, mL + mm(3), ly, fontR, 7.5, SLATE)
      ly -= mm(4.5)
    }
  } else {
    labelWaarde('Uw referentie:', doc.referentieRegel)
    labelWaarde('Vertegenw.:', doc.vertegenwoordiger)
    labelWaarde('Order/Debiteur:', doc.orderDebiteur)
  }
  if (doc.routecode) {
    drawTextRight(page, `Routecode: ${doc.routecode}`, pageW - mR, y, fontR, 8)
  }

  y = Math.min(ly, ay) - mm(4)

  // ── Factuuradres in de body ───────────────────────────────────────────────
  drawText(page, 'Factuuradres:', mL, y, fontB, 8)
  let fx = mL + mm(32)
  drawText(page, doc.factuuradres.join('  '), fx, y, fontR, 8)
  y -= mm(8)

  // ── Tabelheader ───────────────────────────────────────────────────────────
  const tekenTabelHeader = (yy: number): number => {
    page.drawLine({ start: { x: mL, y: yy }, end: { x: pageW - mR, y: yy }, thickness: 0.5, color: BLACK })
    const ty = yy - mm(4)
    drawText(page, 'Rgl.', colRgl.x, ty, fontB, 7)
    drawText(page, 'Artikel', colArt.x, ty, fontB, 7)
    drawText(page, 'Omschrijving', colOms.x, ty, fontB, 7)
    drawTextRight(page, 'Besteld', colBes.x + colBes.w, ty, fontB, 7)
    drawTextRight(page, 'Geleverd', colGel.x + colGel.w, ty, fontB, 7)
    const lijnY = yy - mm(6)
    page.drawLine({ start: { x: mL, y: lijnY }, end: { x: pageW - mR, y: lijnY }, thickness: 0.5, color: BLACK })
    return lijnY - mm(3)
  }
  y = tekenTabelHeader(y)

  const EXTRA_LINE_H = mm(4)
  const ROW_GAP = mm(2)

  const nieuwePaginaIndienNodig = (benodigdeH: number) => {
    if (y - benodigdeH < mm(28)) {
      tekenFooter(page)
      page = pdf.addPage([pageW, pageH])
      y = tekenHeader()
      y = tekenTabelHeader(y)
    }
  }

  // ── Regels per bron-order ─────────────────────────────────────────────────
  for (const groep of doc.groepen) {
    if (doc.isBundel && groep.orderNr) {
      nieuwePaginaIndienNodig(mm(8))
      y -= mm(2)
      drawText(page, `Order ${groep.orderNr}`, mL, y, fontB, 8)
      y -= mm(5)
    }
    for (const regel of groep.regels) {
      const omsLines = wrapText(`St  ${regel.hoofdNaam}`, fontR, 7.5, colOms.w - mm(2))
      const subRegels = [regel.maatRegel, regel.uwNaam ? `Uw naam: ${regel.uwNaam}` : null].filter(Boolean) as string[]
      const totaalH = omsLines.length * EXTRA_LINE_H + subRegels.length * EXTRA_LINE_H + ROW_GAP
      nieuwePaginaIndienNodig(totaalH)

      const topY = y
      drawText(page, regel.regelnummer, colRgl.x, topY, fontR, 7.5)
      drawText(page, regel.artikelnr, colArt.x, topY, fontR, 7)
      omsLines.forEach((line, i) => drawText(page, line, colOms.x, topY - i * EXTRA_LINE_H, fontR, 7.5))
      let subY = topY - omsLines.length * EXTRA_LINE_H
      for (const sr of subRegels) {
        drawText(page, sr, colOms.x, subY, fontR, 7, SLATE)
        subY -= EXTRA_LINE_H
      }
      drawTextRight(page, regel.besteld, colBes.x + colBes.w, topY, fontR, 7.5)
      drawTextRight(page, regel.geleverd, colGel.x + colGel.w, topY, fontR, 7.5)

      y = topY - omsLines.length * EXTRA_LINE_H - subRegels.length * EXTRA_LINE_H - ROW_GAP
    }
  }

  // ── Totalen ───────────────────────────────────────────────────────────────
  nieuwePaginaIndienNodig(mm(20))
  y -= mm(4)
  drawText(page, 'Kolli', mL, y, fontB, 8)
  drawText(page, `: ${doc.kolli}`, mL + mm(22), y, fontR, 8)
  y -= mm(5)
  if (doc.totaalGewichtKg > 0) {
    drawText(page, 'Gewicht', mL, y, fontB, 8)
    drawText(page, `: ${nlGewicht.format(doc.totaalGewichtKg)} kg`, mL + mm(22), y, fontR, 8)
    y -= mm(5)
  }

  // ── Disclaimer ────────────────────────────────────────────────────────────
  nieuwePaginaIndienNodig(mm(16))
  y -= mm(6)
  drawText(page, 'EEN KLEINE MAATAFWIJKING (+/- 3%) EN KLEURAFWIJKINGEN KUNNEN OPTREDEN', mL, y, fontR, 7, SLATE)

  // ── Footer op alle pagina's ───────────────────────────────────────────────
  tekenFooter(page)

  return pdf.save()
}
