// PDF-generator voor Karpi orderbevestigingen.
// Gebruik: `genereerOrderbevestigingPDF(input)` → Uint8Array
// Runtime: Deno Edge Function (pdf-lib via esm.sh).

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1'

export interface OrderbevestigingBedrijf {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  telefoon: string
  email: string
  website: string
  kvk: string
  btw_nummer: string
  iban: string
  bic: string
}

export interface OrderbevestigingRegel {
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  prijs: number | null
  korting_pct: number | null
  bedrag: number | null
}

export interface OrderbevestigingInput {
  bedrijf: OrderbevestigingBedrijf
  logo_bytes?: Uint8Array
  order_nr: string
  orderdatum: string        // YYYY-MM-DD
  debiteur_nr: number
  vertegenwoordiger: string | null
  klant_referentie: string | null
  verzendweek: string | null
  afleverdatum: string | null
  klant_naam: string
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_stad: string | null
  afl_land: string | null
  regels: OrderbevestigingRegel[]
  subtotaal: number
  btw_percentage: number
  btw_bedrag: number
  totaal: number
  betaalconditie: string | null
  opmerkingen?: string | null
}

// Vaste juridische tekst over maatafwijkingen — letterlijk overgenomen van de
// orderbevestigingen uit het oude systeem (zie ob26485640.pdf / ob26499970.pdf).
const MAATAFWIJKING_DISCLAIMER =
  'Een geringe maatafwijking van +/- 3% alsmede een kleurafwijking kan optreden.'

// Betaalconditie wordt opgeslagen met een leidende numerieke code, bv.
// "31 - 30 dagen netto" — voor de klant tonen we alleen de leesbare omschrijving.
function strippedBetaalconditie(raw: string | null): string | null {
  if (!raw) return null
  const zonderCode = raw.replace(/^\s*\d+\s*-\s*/, '').trim()
  return zonderCode || raw
}

function formatKorting(pct: number | null): string | null {
  if (pct == null || Number(pct) === 0) return null
  return `${Number(pct).toFixed(2)}%`
}

function formatBtwPercentage(pct: number): string {
  return Number(pct).toFixed(2)
}

// ─── Hulp ────────────────────────────────────────────────────────────────────

const PT_PER_MM = 72 / 25.4
function mm(v: number) { return v * PT_PER_MM }

function formatBedrag(v: number | null | undefined): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v)
}

function formatDatum(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0, 0, 0),
) {
  page.drawText(text ?? '', { x, y, font, size, color })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ')
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
  return lines
}

// ─── Hoofd-generator ─────────────────────────────────────────────────────────

export async function genereerOrderbevestigingPDF(input: OrderbevestigingInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fontR  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB  = await doc.embedFont(StandardFonts.HelveticaBold)

  const pageW = mm(210)
  const pageH = mm(297)
  const mL = mm(20), mR = mm(20), mT = mm(20)

  const TERRACOTTA = rgb(0.73, 0.29, 0.18)
  const SLATE      = rgb(0.35, 0.40, 0.45)
  const BLACK      = rgb(0, 0, 0)
  const WHITE      = rgb(1, 1, 1)
  const LIGHT_GRAY = rgb(0.95, 0.95, 0.95)

  let page = doc.addPage([pageW, pageH])
  let y = pageH - mT

  // ── Logo ──────────────────────────────────────────────────────────────────
  if (input.logo_bytes) {
    try {
      const img = await doc.embedJpg(input.logo_bytes)
      const logoH = mm(18)
      const logoW = img.width * (logoH / img.height)
      page.drawImage(img, { x: mL, y: y - logoH, width: logoW, height: logoH })
    } catch { /* logo optioneel */ }
  }

  // ── Bedrijfsgegevens rechts ───────────────────────────────────────────────
  const bX = pageW - mR - mm(75)
  let bY = y
  drawText(page, input.bedrijf.bedrijfsnaam, bX, bY, fontB, 8, SLATE)
  bY -= 11
  drawText(page, input.bedrijf.adres, bX, bY, fontR, 7, SLATE)
  bY -= 10
  drawText(page, `${input.bedrijf.postcode}  ${input.bedrijf.plaats}`, bX, bY, fontR, 7, SLATE)
  bY -= 10
  drawText(page, `Tel: ${input.bedrijf.telefoon}`, bX, bY, fontR, 7, SLATE)
  bY -= 10
  drawText(page, input.bedrijf.email, bX, bY, fontR, 7, SLATE)
  bY -= 10
  drawText(page, `KvK: ${input.bedrijf.kvk}   BTW: ${input.bedrijf.btw_nummer}`, bX, bY, fontR, 7, SLATE)
  bY -= 10
  drawText(page, `IBAN: ${input.bedrijf.iban}`, bX, bY, fontR, 7, SLATE)

  y -= mm(28)

  // ── Titel ─────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: mL, y: y - mm(8), width: pageW - mL - mR, height: mm(8), color: TERRACOTTA })
  drawText(page, 'ORDERBEVESTIGING', mL + 4, y - mm(5.5), fontB, 11, WHITE)
  y -= mm(12)

  // ── Order info blok ───────────────────────────────────────────────────────
  const col2 = mL + mm(95)
  drawText(page, 'Ordernummer:', mL, y, fontB, 8)
  drawText(page, input.order_nr, mL + mm(35), y, fontR, 8)
  drawText(page, 'Datum:', col2, y, fontB, 8)
  drawText(page, formatDatum(input.orderdatum), col2 + mm(25), y, fontR, 8)
  y -= 13

  drawText(page, 'Uw debiteurnr.:', mL, y, fontB, 8)
  drawText(page, String(input.debiteur_nr), mL + mm(35), y, fontR, 8)
  if (input.vertegenwoordiger) {
    drawText(page, 'Vertegenwoordiger:', col2, y, fontB, 8)
    drawText(page, input.vertegenwoordiger, col2 + mm(33), y, fontR, 8)
  }
  y -= 13

  if (input.klant_referentie) {
    drawText(page, 'Uw referentie:', mL, y, fontB, 8)
    drawText(page, input.klant_referentie, mL + mm(35), y, fontR, 8)
  }
  if (input.verzendweek) {
    drawText(page, 'Verzendweek:', col2, y, fontB, 8)
    drawText(page, input.verzendweek, col2 + mm(25), y, fontR, 8)
  } else if (input.afleverdatum) {
    drawText(page, 'Afleverdatum:', col2, y, fontB, 8)
    drawText(page, formatDatum(input.afleverdatum), col2 + mm(25), y, fontR, 8)
  }
  y -= 18

  // ── Adresblok ─────────────────────────────────────────────────────────────
  drawText(page, 'Klant', mL, y, fontB, 8, SLATE)
  drawText(page, 'Afleveradres', col2, y, fontB, 8, SLATE)
  y -= 12

  drawText(page, input.klant_naam, mL, y, fontB, 8)
  if (input.afl_naam && input.afl_naam !== input.klant_naam) {
    drawText(page, input.afl_naam, col2, y, fontB, 8)
  }
  y -= 11

  if (input.afl_adres) {
    drawText(page, input.afl_adres, col2, y, fontR, 8)
    y -= 10
  }
  if (input.afl_postcode || input.afl_stad) {
    drawText(page, [input.afl_postcode, input.afl_stad].filter(Boolean).join('  '), col2, y, fontR, 8)
    y -= 10
  }
  if (input.afl_land && input.afl_land.toUpperCase() !== 'NL') {
    drawText(page, input.afl_land, col2, y, fontR, 8)
    y -= 10
  }

  y -= 6

  // ── Tabel header ──────────────────────────────────────────────────────────
  // Kolombreedtes tellen op tot pageW - mL - mR (170mm) zodat de tabel exact
  // tussen de marges past.
  const colNum     = { x: mL,           w: mm(8)  }
  const colArt     = { x: mL + mm(8),   w: mm(20) }
  const colKarpi   = { x: mL + mm(28),  w: mm(28) }
  const colOmsch   = { x: mL + mm(56),  w: mm(54) }
  const colEh      = { x: mL + mm(110), w: mm(8)  }
  const colAantal  = { x: mL + mm(118), w: mm(12) }
  const colPrijs   = { x: mL + mm(130), w: mm(18) }
  const colKorting = { x: mL + mm(148), w: mm(12) }
  const colBedrag  = { x: mL + mm(160), w: mm(10) }

  const colDefs = [
    { label: '#',            ...colNum,     align: 'left'  },
    { label: 'Artikel',      ...colArt,     align: 'left'  },
    { label: 'Karpi code',   ...colKarpi,   align: 'left'  },
    { label: 'Omschrijving', ...colOmsch,   align: 'left'  },
    { label: 'Eh',           ...colEh,      align: 'left'  },
    { label: 'Aantal',       ...colAantal,  align: 'right' },
    { label: 'Prijs',        ...colPrijs,   align: 'right' },
    { label: 'Korting',      ...colKorting, align: 'right' },
    { label: 'Bedrag',       ...colBedrag,  align: 'right' },
  ]

  page.drawRectangle({ x: mL, y: y - mm(5.5), width: pageW - mL - mR, height: mm(5.5), color: SLATE })
  for (const col of colDefs) {
    const txtW = fontB.widthOfTextAtSize(col.label, 7)
    const xPos = col.align === 'right' ? col.x + col.w - txtW : col.x + 2
    drawText(page, col.label, xPos, y - mm(4), fontB, 7, WHITE)
  }
  y -= mm(7)

  // ── Regels ────────────────────────────────────────────────────────────────
  let rowAlt = false
  const ROW_H = mm(6.5)
  const EXTRA_LINE_H = mm(4.5)

  for (const regel of input.regels) {
    // Sla VERZEND-regels niet op als geen bedrag
    const isVerzend = regel.artikelnr === 'VERZEND'
    // Eenheid "St" (stuks) — alleen voor echte productregels, mirrort de oude
    // lay-out (vrachtkosten-/admin-regels tonen geen eenheid).
    const eenheid = regel.artikelnr && !isVerzend ? 'St' : null
    const kortingTxt = formatKorting(regel.korting_pct)

    const omschrijvingLines = wrapText(regel.omschrijving ?? '', fontR, 7.5, colOmsch.w - mm(2))
    const subLineCount = (regel.omschrijving_2 ? 1 : 0) + (input.verzendweek ? 1 : 0)
    const totalH = ROW_H + (omschrijvingLines.length > 1 ? (omschrijvingLines.length - 1) * EXTRA_LINE_H : 0)
      + subLineCount * EXTRA_LINE_H

    // Nieuwe pagina indien nodig
    if (y - totalH < mm(30)) {
      // Footer huidige pagina
      drawText(page, `${input.bedrijf.bedrijfsnaam} — ${input.bedrijf.website}`, mL, mm(12), fontR, 7, SLATE)
      page = doc.addPage([pageW, pageH])
      y = pageH - mT
    }

    if (rowAlt) {
      page.drawRectangle({ x: mL, y: y - totalH, width: pageW - mL - mR, height: totalH, color: LIGHT_GRAY })
    }
    rowAlt = !rowAlt

    const textY = y - mm(4.5)

    drawText(page, String(regel.regelnummer), mL + 2, textY, fontR, 7.5)

    if (regel.artikelnr && !isVerzend) {
      drawText(page, regel.artikelnr, colArt.x + 2, textY, fontR, 7, rgb(0.73, 0.29, 0.18))
    }

    if (regel.karpi_code) {
      drawText(page, regel.karpi_code, colKarpi.x + 2, textY, fontR, 7)
    }

    // Omschrijving (multi-line) + sub-regels (model/referentie elders, hier: omschrijving_2 + verzendweek)
    const omschX = colOmsch.x + 2
    omschrijvingLines.forEach((line, i) => {
      drawText(page, line, omschX, textY - i * EXTRA_LINE_H, fontR, 7.5)
    })
    let subY = textY - omschrijvingLines.length * EXTRA_LINE_H
    if (regel.omschrijving_2) {
      drawText(page, regel.omschrijving_2, omschX, subY, fontR, 6.5, SLATE)
      subY -= EXTRA_LINE_H
    }
    if (input.verzendweek) {
      drawText(page, `Verzendweek: ${input.verzendweek}`, omschX, subY, fontR, 6.5, SLATE)
    }

    if (eenheid) {
      drawText(page, eenheid, colEh.x + 2, textY, fontR, 7.5)
    }

    drawText(page, String(regel.orderaantal), colAantal.x + colAantal.w - fontR.widthOfTextAtSize(String(regel.orderaantal), 7.5) - 2, textY, fontR, 7.5)

    if (regel.prijs != null) {
      const prijsTxt = formatBedrag(regel.prijs)
      drawText(page, prijsTxt, colPrijs.x + colPrijs.w - fontR.widthOfTextAtSize(prijsTxt, 7.5) - 2, textY, fontR, 7.5)
    }

    if (kortingTxt) {
      drawText(page, kortingTxt, colKorting.x + colKorting.w - fontR.widthOfTextAtSize(kortingTxt, 7.5) - 2, textY, fontR, 7.5)
    }

    if (regel.bedrag != null) {
      const bedragTxt = formatBedrag(regel.bedrag)
      drawText(page, bedragTxt, colBedrag.x + colBedrag.w - fontR.widthOfTextAtSize(bedragTxt, 7.5) - 2, textY, fontR, 7.5)
    }

    y -= totalH
  }

  // ── Totaal — BTW-uitsplitsing (excl. → BTW% over X → incl.) ───────────────
  y -= 4
  page.drawLine({ start: { x: mL + mm(115), y }, end: { x: pageW - mR, y }, thickness: 0.5, color: SLATE })
  y -= 12

  const totaalLabelX = mL + mm(115)
  const drawTotaalRegel = (label: string, bedrag: number, font: PDFFont, size: number) => {
    const txt = formatBedrag(bedrag)
    drawText(page, label, totaalLabelX, y, font, size)
    drawText(page, txt, pageW - mR - font.widthOfTextAtSize(txt, size) - 2, y, font, size)
    y -= size === 9 ? 14 : 11
  }

  drawTotaalRegel('Totaalbedrag excl. btw', input.subtotaal, fontR, 8)
  drawTotaalRegel(`${formatBtwPercentage(input.btw_percentage)}% btw over ${formatBedrag(input.subtotaal)}`, input.btw_bedrag, fontR, 8)
  drawTotaalRegel('Totaalbedrag incl. btw', input.totaal, fontB, 9)
  y -= 4

  // ── Condities + maatafwijking-disclaimer ──────────────────────────────────
  const betaalconditie = strippedBetaalconditie(input.betaalconditie)
  if (betaalconditie) {
    drawText(page, 'Betalingsconditie:', mL, y, fontB, 8)
    drawText(page, betaalconditie, mL + mm(38), y, fontR, 8)
    y -= 11
  }
  y -= 4
  for (const line of wrapText(MAATAFWIJKING_DISCLAIMER, fontR, 7, pageW - mL - mR)) {
    drawText(page, line, mL, y, fontR, 7, SLATE)
    y -= 10
  }
  y -= 8

  // ── Opmerkingen ───────────────────────────────────────────────────────────
  if (input.opmerkingen) {
    drawText(page, 'Opmerkingen:', mL, y, fontB, 8)
    y -= 11
    const lines = wrapText(input.opmerkingen, fontR, 8, pageW - mL - mR)
    for (const line of lines) {
      drawText(page, line, mL, y, fontR, 8)
      y -= 11
    }
    y -= 4
  }

  // ── Slottekst ─────────────────────────────────────────────────────────────
  y -= 4
  drawText(page, 'Met vriendelijke groet,', mL, y, fontR, 8)
  y -= 11
  drawText(page, input.bedrijf.bedrijfsnaam, mL, y, fontB, 8)

  // ── Footer alle pagina's ──────────────────────────────────────────────────
  const pageCount = doc.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const p = doc.getPage(i)
    const footerY = mm(10)
    drawText(p, `${input.bedrijf.bedrijfsnaam} — ${input.bedrijf.website}   |   ${input.bedrijf.iban}   |   BTW: ${input.bedrijf.btw_nummer}`, mL, footerY, fontR, 6.5, SLATE)
    if (pageCount > 1) {
      const pgTxt = `Pagina ${i + 1} van ${pageCount}`
      drawText(p, pgTxt, pageW - mR - fontR.widthOfTextAtSize(pgTxt, 6.5), footerY, fontR, 6.5, SLATE)
    }
  }

  return doc.save()
}
