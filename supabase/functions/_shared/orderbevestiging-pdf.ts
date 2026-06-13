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
import type { Taal } from './orderbevestiging-taal.ts'

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
  afhalen?: boolean
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_stad: string | null
  afl_land: string | null
  regels: OrderbevestigingRegel[]
  subtotaal: number
  btw_percentage: number
  // Mig 371: intracommunautaire verlegging — TRUE → vermelding i.p.v. BTW-regel.
  btw_verlegd?: boolean
  btw_bedrag: number
  totaal: number
  betaalconditie: string | null
  opmerkingen?: string | null
  // Documenttaal — volgt het land van het factuuradres (zelfde bron als de
  // begeleidende e-mail in stuur-orderbevestiging). Default 'nl'.
  taal?: Taal
}

// Alle vaste teksten op de PDF, per documenttaal. De NL-disclaimer is letterlijk
// overgenomen van de orderbevestigingen uit het oude systeem (ob26485640.pdf /
// ob26499970.pdf); de vertalingen spiegelen de e-mail-VERTALINGEN in
// stuur-orderbevestiging zodat mail en bijlage dezelfde bewoording dragen.
const PDF_VERTALINGEN: Record<Taal, {
  titel: string
  ordernummer: string
  datum: string
  debiteurnr: string
  vertegenwoordiger: string
  referentie: string
  verzendweek: string
  afleverdatum: string
  klant: string
  afhalen: string
  afleveradres: string
  kolommen: { artikel: string; karpiCode: string; omschrijving: string; eh: string; aantal: string; prijs: string; korting: string; bedrag: string }
  eenheidStuks: string
  subtotaal: string
  btwOver: (pct: string, bedrag: string) => string
  btwVerlegd: string
  totaalInclBtw: string
  betalingsconditie: string
  disclaimer: string
  opmerkingen: string
  groet: string
  pagina: (nr: number, totaal: number) => string
}> = {
  nl: {
    titel: 'ORDERBEVESTIGING',
    ordernummer: 'Ordernummer:',
    datum: 'Datum:',
    debiteurnr: 'Uw debiteurnr.:',
    vertegenwoordiger: 'Vertegenwoordiger:',
    referentie: 'Uw referentie:',
    verzendweek: 'Verzendweek:',
    afleverdatum: 'Afleverdatum:',
    klant: 'Klant',
    afhalen: 'Afhalen',
    afleveradres: 'Afleveradres',
    kolommen: { artikel: 'Artikel', karpiCode: 'Karpi code', omschrijving: 'Omschrijving', eh: 'Eh', aantal: 'Aantal', prijs: 'Prijs', korting: 'Korting', bedrag: 'Bedrag' },
    eenheidStuks: 'St',
    subtotaal: 'Totaalbedrag excl. btw',
    btwOver: (pct, bedrag) => `${pct}% btw over ${bedrag}`,
    btwVerlegd: 'BTW verlegd',
    totaalInclBtw: 'Totaalbedrag incl. btw',
    betalingsconditie: 'Betalingsconditie:',
    disclaimer: 'Een geringe maatafwijking van +/- 3% alsmede een kleurafwijking kan optreden.',
    opmerkingen: 'Opmerkingen:',
    groet: 'Met vriendelijke groet,',
    pagina: (nr, totaal) => `Pagina ${nr} van ${totaal}`,
  },
  de: {
    titel: 'AUFTRAGSBESTÄTIGUNG',
    ordernummer: 'Auftragsnummer:',
    datum: 'Datum:',
    debiteurnr: 'Ihre Kundennr.:',
    vertegenwoordiger: 'Vertreter:',
    referentie: 'Ihre Referenz:',
    verzendweek: 'Versandwoche:',
    afleverdatum: 'Lieferdatum:',
    klant: 'Kunde',
    afhalen: 'Abholung',
    afleveradres: 'Lieferadresse',
    kolommen: { artikel: 'Artikel', karpiCode: 'Karpi-Code', omschrijving: 'Beschreibung', eh: 'Einh.', aantal: 'Menge', prijs: 'Preis', korting: 'Rabatt', bedrag: 'Betrag' },
    eenheidStuks: 'St',
    subtotaal: 'Gesamtbetrag exkl. MwSt.',
    btwOver: (pct, bedrag) => `${pct}% MwSt. auf ${bedrag}`,
    btwVerlegd: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)',
    totaalInclBtw: 'Gesamtbetrag inkl. MwSt.',
    betalingsconditie: 'Zahlungsbedingung:',
    disclaimer: 'Geringe Maßabweichungen von +/- 3% sowie Farbabweichungen sind möglich.',
    opmerkingen: 'Anmerkungen:',
    groet: 'Mit freundlichen Grüßen,',
    pagina: (nr, totaal) => `Seite ${nr} von ${totaal}`,
  },
  fr: {
    titel: 'CONFIRMATION DE COMMANDE',
    ordernummer: 'N° de commande:',
    datum: 'Date:',
    debiteurnr: 'Votre n° client:',
    vertegenwoordiger: 'Représentant:',
    referentie: 'Votre référence:',
    verzendweek: 'Sem. d\'envoi:',
    afleverdatum: 'Date de livraison:',
    klant: 'Client',
    afhalen: 'Enlèvement',
    afleveradres: 'Adresse de livraison',
    kolommen: { artikel: 'Article', karpiCode: 'Code Karpi', omschrijving: 'Désignation', eh: 'Un.', aantal: 'Qté', prijs: 'Prix', korting: 'Remise', bedrag: 'Montant' },
    eenheidStuks: 'pc',
    subtotaal: 'Montant total hors TVA',
    btwOver: (pct, bedrag) => `TVA ${pct}% sur ${bedrag}`,
    btwVerlegd: 'Autoliquidation de la TVA',
    totaalInclBtw: 'Montant total TVA comprise',
    betalingsconditie: 'Conditions de paiement:',
    disclaimer: 'Un léger écart de mesure de +/- 3 % ainsi qu\'une différence de couleur peuvent survenir.',
    opmerkingen: 'Remarques:',
    groet: 'Cordialement,',
    pagina: (nr, totaal) => `Page ${nr} sur ${totaal}`,
  },
  en: {
    titel: 'ORDER CONFIRMATION',
    ordernummer: 'Order number:',
    datum: 'Date:',
    debiteurnr: 'Your customer no.:',
    vertegenwoordiger: 'Representative:',
    referentie: 'Your reference:',
    verzendweek: 'Shipping week:',
    afleverdatum: 'Delivery date:',
    klant: 'Customer',
    afhalen: 'Pickup',
    afleveradres: 'Delivery address',
    kolommen: { artikel: 'Item', karpiCode: 'Karpi code', omschrijving: 'Description', eh: 'Unit', aantal: 'Qty', prijs: 'Price', korting: 'Discount', bedrag: 'Amount' },
    eenheidStuks: 'pcs',
    subtotaal: 'Total amount excl. VAT',
    btwOver: (pct, bedrag) => `${pct}% VAT over ${bedrag}`,
    btwVerlegd: 'VAT reverse charged',
    totaalInclBtw: 'Total amount incl. VAT',
    betalingsconditie: 'Payment terms:',
    disclaimer: 'A slight size deviation of +/- 3% as well as a colour variation may occur.',
    opmerkingen: 'Remarks:',
    groet: 'Kind regards,',
    pagina: (nr, totaal) => `Page ${nr} of ${totaal}`,
  },
}

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

function drawTextRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0, 0, 0),
) {
  const w = font.widthOfTextAtSize(text ?? '', size)
  page.drawText(text ?? '', { x: rightX - w, y, font, size, color })
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
  const t = PDF_VERTALINGEN[input.taal ?? 'nl']
  const doc = await PDFDocument.create()
  const fontR  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB  = await doc.embedFont(StandardFonts.HelveticaBold)

  const pageW = mm(210)
  const pageH = mm(297)
  const mL = mm(20), mR = mm(20), mT = mm(20)

  const KARPI_ORANJE = rgb(0.76, 0.53, 0.22)
  const SLATE      = rgb(0.35, 0.40, 0.45)
  const BLACK      = rgb(0, 0, 0)

  let page = doc.addPage([pageW, pageH])

  // ── Merk-header: gecentreerd logo + "KARPI BV" rechtsboven (mirrort factuur-pdf) ──
  const headerTopY = pageH - mm(8)
  const logoImg = input.logo_bytes
    ? await doc.embedJpg(input.logo_bytes).catch(() => null)
    : null
  if (logoImg) {
    const logoH = mm(18)
    const logoW = logoImg.width * (logoH / logoImg.height)
    const logoX = (pageW - logoW) / 2
    page.drawImage(logoImg, { x: logoX, y: headerTopY - logoH, width: logoW, height: logoH })
  }

  const rightX = pageW - mR
  const karpiSize = 10
  drawTextRight(page, input.bedrijf.bedrijfsnaam, rightX, pageH - mm(11), fontB, karpiSize, KARPI_ORANJE)
  drawTextRight(page, `${input.bedrijf.adres}, ${input.bedrijf.postcode} ${input.bedrijf.plaats}`, rightX, pageH - mm(15), fontR, 6, SLATE)
  drawTextRight(page, `t ${input.bedrijf.telefoon}`, rightX, pageH - mm(19), fontR, 6, SLATE)
  drawTextRight(page, `e ${input.bedrijf.email} | i ${input.bedrijf.website}`, rightX, pageH - mm(23), fontR, 6, SLATE)

  // ── Documenttype-label (plain, zoals "FACTUUR"/"HERBEVESTIGING" in oude lay-out) ──
  drawText(page, t.titel, mL, pageH - mm(30), fontB, 9)
  let y = pageH - mm(38)

  // ── Order info blok ───────────────────────────────────────────────────────
  // Waarde-offset per label berekend (minimaal de oude NL-kolombreedte) zodat
  // langere vertaalde labels (bv. FR "Date de livraison:") nooit overlappen.
  const labelWaarde = (label: string, waarde: string, x: number, minOffset: number) => {
    drawText(page, label, x, y, fontB, 8)
    const offset = Math.max(minOffset, fontB.widthOfTextAtSize(label, 8) + mm(3))
    drawText(page, waarde, x + offset, y, fontR, 8)
  }
  const col2 = mL + mm(95)
  labelWaarde(t.ordernummer, input.order_nr, mL, mm(35))
  labelWaarde(t.datum, formatDatum(input.orderdatum), col2, mm(25))
  y -= 13

  labelWaarde(t.debiteurnr, String(input.debiteur_nr), mL, mm(35))
  if (input.vertegenwoordiger) {
    labelWaarde(t.vertegenwoordiger, input.vertegenwoordiger, col2, mm(33))
  }
  y -= 13

  if (input.klant_referentie) {
    labelWaarde(t.referentie, input.klant_referentie, mL, mm(35))
  }
  if (input.verzendweek) {
    labelWaarde(t.verzendweek, input.verzendweek, col2, mm(25))
  } else if (input.afleverdatum) {
    labelWaarde(t.afleverdatum, formatDatum(input.afleverdatum), col2, mm(25))
  }
  y -= 18

  // ── Adresblok ─────────────────────────────────────────────────────────────
  // Bij afhalen tonen we Karpi's eigen adres als afhaallocatie.
  const isAfhalen = input.afhalen === true
  const aflNaam    = isAfhalen ? input.bedrijf.bedrijfsnaam : input.afl_naam
  const aflAdres   = isAfhalen ? input.bedrijf.adres        : input.afl_adres
  const aflPost    = isAfhalen ? input.bedrijf.postcode      : input.afl_postcode
  const aflStad    = isAfhalen ? input.bedrijf.plaats        : input.afl_stad
  const aflLand    = isAfhalen ? null                        : input.afl_land

  drawText(page, t.klant, mL, y, fontB, 8, SLATE)
  drawText(page, isAfhalen ? t.afhalen : t.afleveradres, col2, y, fontB, 8, SLATE)
  y -= 12

  drawText(page, input.klant_naam, mL, y, fontB, 8)
  if (aflNaam && aflNaam !== input.klant_naam) {
    drawText(page, aflNaam, col2, y, fontB, 8)
  }
  y -= 11

  if (aflAdres) {
    drawText(page, aflAdres, col2, y, fontR, 8)
    y -= 10
  }
  if (aflPost || aflStad) {
    drawText(page, [aflPost, aflStad].filter(Boolean).join('  '), col2, y, fontR, 8)
    y -= 10
  }
  if (aflLand && aflLand.toUpperCase() !== 'NL') {
    drawText(page, aflLand, col2, y, fontR, 8)
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
    { label: '#',                    ...colNum,     align: 'left'  },
    { label: t.kolommen.artikel,     ...colArt,     align: 'left'  },
    { label: t.kolommen.karpiCode,   ...colKarpi,   align: 'left'  },
    { label: t.kolommen.omschrijving, ...colOmsch,  align: 'left'  },
    { label: t.kolommen.eh,          ...colEh,      align: 'left'  },
    { label: t.kolommen.aantal,      ...colAantal,  align: 'right' },
    { label: t.kolommen.prijs,       ...colPrijs,   align: 'right' },
    { label: t.kolommen.korting,     ...colKorting, align: 'right' },
    { label: t.kolommen.bedrag,      ...colBedrag,  align: 'right' },
  ]

  page.drawLine({ start: { x: mL, y }, end: { x: pageW - mR, y }, thickness: 0.5, color: BLACK })
  for (const col of colDefs) {
    const txtW = fontB.widthOfTextAtSize(col.label, 7)
    const xPos = col.align === 'right' ? col.x + col.w - txtW : col.x + 2
    drawText(page, col.label, xPos, y - mm(4), fontB, 7)
  }
  y -= mm(6)
  page.drawLine({ start: { x: mL, y }, end: { x: pageW - mR, y }, thickness: 0.5, color: BLACK })
  y -= mm(1)

  // ── Regels ────────────────────────────────────────────────────────────────
  const ROW_H = mm(6.5)
  const EXTRA_LINE_H = mm(4.5)

  for (const regel of input.regels) {
    // Sla VERZEND-regels niet op als geen bedrag
    const isVerzend = regel.artikelnr === 'VERZEND'
    // Eenheid (stuks) — alleen voor echte productregels, mirrort de oude
    // lay-out (vrachtkosten-/admin-regels tonen geen eenheid).
    const eenheid = regel.artikelnr && !isVerzend ? t.eenheidStuks : null
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

    const textY = y - mm(4.5)

    drawText(page, String(regel.regelnummer), mL + 2, textY, fontR, 7.5)

    if (regel.artikelnr && !isVerzend) {
      drawText(page, regel.artikelnr, colArt.x + 2, textY, fontR, 7)
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
      drawText(page, `${t.verzendweek} ${input.verzendweek}`, omschX, subY, fontR, 6.5, SLATE)
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

  drawTotaalRegel(t.subtotaal, input.subtotaal, fontR, 8)
  if (input.btw_verlegd) {
    // Intracommunautaire verlegging: wettelijke vermelding i.p.v. BTW-regel.
    // Rechts uitgelijnd op dezelfde rechterrand als de bedragen (geen bedrag
    // erachter) — de Duitse tekst is te lang om vanaf totaalLabelX te passen,
    // en er staat verder niets op deze regel, dus hij mag naar links uitlopen.
    drawText(page, t.btwVerlegd, pageW - mR - fontR.widthOfTextAtSize(t.btwVerlegd, 8) - 2, y, fontR, 8)
    y -= 11
  } else {
    drawTotaalRegel(t.btwOver(formatBtwPercentage(input.btw_percentage), formatBedrag(input.subtotaal)), input.btw_bedrag, fontR, 8)
  }
  drawTotaalRegel(t.totaalInclBtw, input.totaal, fontB, 9)
  y -= 4

  // ── Condities + maatafwijking-disclaimer ──────────────────────────────────
  const betaalconditie = strippedBetaalconditie(input.betaalconditie)
  if (betaalconditie) {
    drawText(page, t.betalingsconditie, mL, y, fontB, 8)
    const condOffset = Math.max(mm(38), fontB.widthOfTextAtSize(t.betalingsconditie, 8) + mm(3))
    drawText(page, betaalconditie, mL + condOffset, y, fontR, 8)
    y -= 11
  }
  y -= 4
  for (const line of wrapText(t.disclaimer, fontR, 7, pageW - mL - mR)) {
    drawText(page, line, mL, y, fontR, 7, SLATE)
    y -= 10
  }
  y -= 8

  // ── Opmerkingen ───────────────────────────────────────────────────────────
  if (input.opmerkingen) {
    drawText(page, t.opmerkingen, mL, y, fontB, 8)
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
  drawText(page, t.groet, mL, y, fontR, 8)
  y -= 11
  drawText(page, input.bedrijf.bedrijfsnaam, mL, y, fontB, 8)

  // ── Footer alle pagina's ──────────────────────────────────────────────────
  const pageCount = doc.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const p = doc.getPage(i)
    const footerY = mm(10)
    drawText(p, `${input.bedrijf.bedrijfsnaam}   |   KvK ${input.bedrijf.kvk}   |   BTW ${input.bedrijf.btw_nummer}   |   IBAN ${input.bedrijf.iban}   |   BIC ${input.bedrijf.bic}`, mL, footerY, fontR, 6.5, SLATE)
    if (pageCount > 1) {
      const pgTxt = t.pagina(i + 1, pageCount)
      drawText(p, pgTxt, pageW - mR - fontR.widthOfTextAtSize(pgTxt, 6.5), footerY, fontR, 6.5, SLATE)
    }
  }

  return doc.save()
}
