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
import { type Taal, vertaalOmschrijving } from '../klant-taal.ts'

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

// Statische pakbon-labels per taal (nl/de/fr/en) — zelfde patroon als
// FACTUUR_TEKSTEN in factuur-pdf.ts. `modelLabel` is bewust letterlijk gelijk
// aan `t.model` daar (commit a857bff5: "Uw model" i.p.v. "Uw naam" op zowel
// factuur als pakbon). Regel-inhoud (omschrijving/maat/afwerking) loopt door
// `vertaalOmschrijving` (klant-taal.ts), net als op de factuur.
interface PakbonTeksten {
  titel: string
  pakbonnr: string
  datum: string
  deelzendingBadge: string
  afhalenBadge: string
  afleveradres: string
  afhaallocatie: string
  vertegenwoordiger: string
  debiteurLabel: string
  ordersLabel: string
  ordersGebundeld: (n: number) => string
  uwReferentie: string
  orderDebiteur: string
  routecodeLabel: string
  factuuradres: string
  colRgl: string
  colArtikel: string
  colOms: string
  colBesteld: string
  colGeleverd: string
  kolliLabel: string
  gewichtLabel: string
  disclaimer: string
  stPrefix: string
  afwerkingLabel: string
  modelLabel: string
  mancoLabel: string
  mancoNietGevonden: string
}

const PAKBON_TEKSTEN: Record<Taal, PakbonTeksten> = {
  nl: {
    titel: 'PAKBON', pakbonnr: 'Pakbonnr:', datum: 'Datum:',
    deelzendingBadge: 'DEELZENDING — niet de volledige order',
    afhalenBadge: 'AFHALEN — klant haalt op bij Karpi',
    afleveradres: 'Afleveradres:', afhaallocatie: 'Afhaallocatie:',
    vertegenwoordiger: 'Vertegenw.:',
    debiteurLabel: 'Debiteur:', ordersLabel: 'Orders:',
    ordersGebundeld: (n) => `${n} orders gebundeld`,
    uwReferentie: 'Uw referentie:', orderDebiteur: 'Order/Debiteur:',
    routecodeLabel: 'Routecode:', factuuradres: 'Factuuradres:',
    colRgl: 'Rgl.', colArtikel: 'Artikel', colOms: 'Omschrijving',
    colBesteld: 'Besteld', colGeleverd: 'Geleverd',
    kolliLabel: 'Kolli', gewichtLabel: 'Gewicht',
    disclaimer: 'EEN KLEINE MAATAFWIJKING (+/- 3%) EN KLEURAFWIJKINGEN KUNNEN OPTREDEN',
    stPrefix: 'St', afwerkingLabel: 'Afwerking:', modelLabel: 'Uw model',
    mancoLabel: 'MANCO', mancoNietGevonden: 'Niet gevonden - niet meegeleverd',
  },
  de: {
    titel: 'LIEFERSCHEIN', pakbonnr: 'Lieferscheinnr.:', datum: 'Datum:',
    deelzendingBadge: 'TEILLIEFERUNG — nicht die vollständige Bestellung',
    afhalenBadge: 'ABHOLUNG — Kunde holt bei Karpi ab',
    afleveradres: 'Lieferadresse:', afhaallocatie: 'Abholort:',
    vertegenwoordiger: 'Vertreter:',
    debiteurLabel: 'Kunde:', ordersLabel: 'Aufträge:',
    ordersGebundeld: (n) => `${n} Aufträge gebündelt`,
    uwReferentie: 'Ihre Referenz:', orderDebiteur: 'Auftrag/Kunde:',
    routecodeLabel: 'Routencode:', factuuradres: 'Rechnungsadresse:',
    colRgl: 'Pos.', colArtikel: 'Artikel', colOms: 'Bezeichnung',
    colBesteld: 'Bestellt', colGeleverd: 'Geliefert',
    kolliLabel: 'Kolli', gewichtLabel: 'Gewicht',
    disclaimer: 'EINE GERINGE MASSABWEICHUNG (+/- 3%) UND FARBABWEICHUNGEN SIND MÖGLICH',
    stPrefix: 'Stk', afwerkingLabel: 'Verarbeitung:', modelLabel: 'Ihr Modell',
    mancoLabel: 'FEHLMENGE', mancoNietGevonden: 'Nicht gefunden - nicht mitgeliefert',
  },
  fr: {
    titel: 'BON DE LIVRAISON', pakbonnr: 'N° bon:', datum: 'Date:',
    deelzendingBadge: 'LIVRAISON PARTIELLE — pas la commande complète',
    afhalenBadge: 'RETRAIT — le client vient chercher chez Karpi',
    afleveradres: 'Adresse de livraison:', afhaallocatie: 'Lieu de retrait:',
    vertegenwoordiger: 'Représentant:',
    debiteurLabel: 'Client:', ordersLabel: 'Commandes:',
    ordersGebundeld: (n) => `${n} commandes groupées`,
    uwReferentie: 'Votre référence:', orderDebiteur: 'Commande/Client:',
    routecodeLabel: 'Code de route:', factuuradres: 'Adresse de facturation:',
    colRgl: 'Ligne', colArtikel: 'Article', colOms: 'Description',
    colBesteld: 'Commandé', colGeleverd: 'Livré',
    kolliLabel: 'Colis', gewichtLabel: 'Poids',
    disclaimer: 'UN LÉGER ÉCART DE DIMENSION (+/- 3%) ET DES ÉCARTS DE COULEUR SONT POSSIBLES',
    stPrefix: 'Pce', afwerkingLabel: 'Finition:', modelLabel: 'Votre modèle',
    mancoLabel: 'MANQUANT', mancoNietGevonden: 'Non trouvé - non livré',
  },
  en: {
    titel: 'PACKING LIST', pakbonnr: 'Packing list no.:', datum: 'Date:',
    deelzendingBadge: 'PARTIAL SHIPMENT — not the full order',
    afhalenBadge: 'PICKUP — customer collects at Karpi',
    afleveradres: 'Delivery address:', afhaallocatie: 'Pickup location:',
    vertegenwoordiger: 'Sales rep.:',
    debiteurLabel: 'Customer:', ordersLabel: 'Orders:',
    ordersGebundeld: (n) => `${n} orders bundled`,
    uwReferentie: 'Your reference:', orderDebiteur: 'Order/Customer:',
    routecodeLabel: 'Route code:', factuuradres: 'Invoice address:',
    colRgl: 'Line', colArtikel: 'Item', colOms: 'Description',
    colBesteld: 'Ordered', colGeleverd: 'Delivered',
    kolliLabel: 'Packages', gewichtLabel: 'Weight',
    disclaimer: 'A SMALL SIZE DEVIATION (+/- 3%) AND COLOUR VARIATIONS MAY OCCUR',
    stPrefix: 'Pc', afwerkingLabel: 'Finish:', modelLabel: 'Your model',
    mancoLabel: 'MISSING', mancoNietGevonden: 'Not found - not delivered',
  },
}

/** Genereert de pakbon-PDF (A4) uit het canonieke document. */
export async function genereerPakbonPDF(
  doc: PakbonDocument,
  bedrijf: PakbonBedrijf,
  logo?: PakbonPdfLogo,
  taal: Taal = 'nl',
): Promise<Uint8Array> {
  const t = PAKBON_TEKSTEN[taal]
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
  drawText(page, t.titel, mL, y, fontB, 16)
  const metaX = mL + mm(120)
  drawText(page, t.pakbonnr, metaX, y, fontB, 8)
  drawText(page, doc.pakbonnr, metaX + mm(22), y, fontR, 8)
  drawText(page, t.datum, metaX, y - mm(5), fontB, 8)
  drawText(page, doc.datum, metaX + mm(22), y - mm(5), fontR, 8)
  y -= mm(16)

  // Mig 473: deze zending dekt niet de hele order — niet missen op de werkvloer.
  if (doc.isDeelzending) {
    const badgeTekst = t.deelzendingBadge
    const badgeW = fontB.widthOfTextAtSize(badgeTekst, 9) + mm(4)
    const badgeH = mm(6)
    page.drawRectangle({
      x: mL, y: y - badgeH + mm(1.5), width: badgeW, height: badgeH,
      borderColor: BLACK, borderWidth: 1,
    })
    drawText(page, badgeTekst, mL + mm(2), y - mm(3), fontB, 9)
    y -= mm(10)
  }

  // Mig 537: afhaallocatie-badge.
  if (doc.isAfhalen) {
    const badgeTekst = t.afhalenBadge
    const badgeW = fontB.widthOfTextAtSize(badgeTekst, 9) + mm(4)
    const badgeH = mm(6)
    page.drawRectangle({
      x: mL, y: y - badgeH + mm(1.5), width: badgeW, height: badgeH,
      borderColor: BLACK, borderWidth: 1,
    })
    drawText(page, badgeTekst, mL + mm(2), y - mm(3), fontB, 9)
    y -= mm(10)
  }

  // ── Afleveradres / Afhaallocatie (rechterkolom) ───────────────────────────
  const adresX = mL + mm(110)
  drawText(page, doc.isAfhalen ? t.afhaallocatie : t.afleveradres, adresX, y, fontB, 8, SLATE)
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
    labelWaarde(t.vertegenwoordiger, doc.vertegenwoordiger)
    labelWaarde(t.debiteurLabel, doc.debiteur)
    labelWaarde(t.ordersLabel, t.ordersGebundeld(doc.bundelRegels.length))
    for (const br of doc.bundelRegels) {
      drawText(page, br, mL + mm(3), ly, fontR, 7.5, SLATE)
      ly -= mm(4.5)
    }
  } else {
    labelWaarde(t.uwReferentie, doc.referentieRegel)
    labelWaarde(t.vertegenwoordiger, doc.vertegenwoordiger)
    labelWaarde(t.orderDebiteur, doc.orderDebiteur)
  }
  if (doc.routecode) {
    drawTextRight(page, `${t.routecodeLabel} ${doc.routecode}`, pageW - mR, y, fontR, 8)
  }

  y = Math.min(ly, ay) - mm(4)

  // ── Factuuradres in de body ───────────────────────────────────────────────
  drawText(page, t.factuuradres, mL, y, fontB, 8)
  let fx = mL + mm(32)
  drawText(page, doc.factuuradres.join('  '), fx, y, fontR, 8)
  y -= mm(8)

  // ── Tabelheader ───────────────────────────────────────────────────────────
  const tekenTabelHeader = (yy: number): number => {
    page.drawLine({ start: { x: mL, y: yy }, end: { x: pageW - mR, y: yy }, thickness: 0.5, color: BLACK })
    const ty = yy - mm(4)
    drawText(page, t.colRgl, colRgl.x, ty, fontB, 7)
    drawText(page, t.colArtikel, colArt.x, ty, fontB, 7)
    drawText(page, t.colOms, colOms.x, ty, fontB, 7)
    drawTextRight(page, t.colBesteld, colBes.x + colBes.w, ty, fontB, 7)
    drawTextRight(page, t.colGeleverd, colGel.x + colGel.w, ty, fontB, 7)
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
      const omsLines = wrapText(
        vertaalOmschrijving(`${t.stPrefix}  ${regel.hoofdNaam}`, taal),
        fontR, 7.5, colOms.w - mm(2),
      )
      const subRegels = [
        regel.maatRegel ? vertaalOmschrijving(regel.maatRegel, taal) : null,
        regel.afwerkingRegel ? `${t.afwerkingLabel} ${vertaalOmschrijving(regel.afwerkingRegel, taal)}` : null,
        // Mig 436: omsticker — fysiek gepakt equivalent, zelfde "OMB:"-notatie
        // als het verzendlabel en de geprinte pakbon (code, niet vertaald).
        regel.omstickerCodes.length > 0 ? `OMB: ${regel.omstickerCodes.join(', ')}` : null,
        regel.uwNaam ? `${t.modelLabel}: ${regel.uwNaam}` : null,
      ].filter(Boolean) as string[]
      // Mig 518: manco-regel krijgt één extra regelhoogte voor de "Niet
      // gevonden"-sub-regel; meetellen zodat de volgende rij niet overlapt.
      const mancoExtra = regel.isManco ? EXTRA_LINE_H : 0
      const totaalH =
        omsLines.length * EXTRA_LINE_H + subRegels.length * EXTRA_LINE_H + mancoExtra + ROW_GAP
      nieuwePaginaIndienNodig(totaalH)

      const topY = y
      drawText(page, regel.regelnummer, colRgl.x, topY, fontR, 7.5)
      drawText(page, regel.artikelnr, colArt.x, topY, fontR, 7)
      omsLines.forEach((line, i) => {
        const ly = topY - i * EXTRA_LINE_H
        drawText(page, line, colOms.x, ly, fontR, 7.5)
        // Mig 518: lichte streep door de productnaam bij een manco-regel.
        if (regel.isManco) {
          page.drawLine({
            start: { x: colOms.x, y: ly + mm(1) },
            end: { x: colOms.x + fontR.widthOfTextAtSize(line, 7.5), y: ly + mm(1) },
            thickness: 0.4,
            color: SLATE,
          })
        }
      })
      let subY = topY - omsLines.length * EXTRA_LINE_H
      for (const sr of subRegels) {
        drawText(page, sr, colOms.x, subY, fontR, 7, SLATE)
        subY -= EXTRA_LINE_H
      }
      drawTextRight(page, regel.besteld, colBes.x + colBes.w, topY, fontR, 7.5)
      drawTextRight(page, regel.geleverd, colGel.x + colGel.w, topY, fontR, 7.5)
      // Mig 518: niet-gevonden colli (manco) blijft op de pakbon staan met
      // geleverd 0 + een duidelijk "MANCO"-label naast de geleverd-kolom, plus
      // een "Niet gevonden"-sub-regel onder de doorgestreepte productnaam.
      if (regel.isManco) {
        drawTextRight(page, t.mancoLabel, colGel.x + colGel.w, topY - EXTRA_LINE_H, fontB, 8, BLACK)
        drawText(page, t.mancoNietGevonden, colOms.x, subY, fontB, 7, BLACK)
      }

      y =
        topY -
        omsLines.length * EXTRA_LINE_H -
        subRegels.length * EXTRA_LINE_H -
        mancoExtra -
        ROW_GAP
    }
  }

  // ── Totalen ───────────────────────────────────────────────────────────────
  nieuwePaginaIndienNodig(mm(20))
  y -= mm(4)
  drawText(page, t.kolliLabel, mL, y, fontB, 8)
  drawText(page, `: ${doc.kolli}`, mL + mm(22), y, fontR, 8)
  y -= mm(5)
  if (doc.totaalGewichtKg > 0) {
    drawText(page, t.gewichtLabel, mL, y, fontB, 8)
    drawText(page, `: ${nlGewicht.format(doc.totaalGewichtKg)} kg`, mL + mm(22), y, fontR, 8)
    y -= mm(5)
  }

  // ── Disclaimer ────────────────────────────────────────────────────────────
  nieuwePaginaIndienNodig(mm(16))
  y -= mm(6)
  drawText(page, t.disclaimer, mL, y, fontR, 7, SLATE)

  // ── Footer op alle pagina's ───────────────────────────────────────────────
  tekenFooter(page)

  return pdf.save()
}
