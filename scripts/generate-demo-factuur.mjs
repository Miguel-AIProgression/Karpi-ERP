#!/usr/bin/env node
// Demo-script: genereer factuur-PDF voor een bestaande factuur_id en upload naar storage.
//
// Gebruik: node scripts/generate-demo-factuur.mjs <factuur_id>
//
// Leest SUPABASE_SERVICE_ROLE_KEY + URL uit frontend/.env.
// Haalt factuur + regels + bedrijfsgegevens + vertegenwoordiger op,
// bouwt PDF volgens Karpi-layout, upload naar bucket 'facturen/{debiteur_nr}/FACT-YYYY-NNNN.pdf',
// returnt signed URL (10 min geldig).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dirname, '..', 'frontend', '.env'), 'utf8')
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const SERVICE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()

const factuurId = Number(process.argv[2] ?? 1)
if (!factuurId) {
  console.error('Geef factuur_id mee als argument')
  process.exit(1)
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

// Laad alles
const [factuurArr, regels, bedrijfsArr, debArr] = await Promise.all([
  sb(`facturen?id=eq.${factuurId}&select=*`),
  sb(`factuur_regels?factuur_id=eq.${factuurId}&select=*&order=regelnummer`),
  sb(`app_config?sleutel=eq.bedrijfsgegevens&select=waarde`),
  sb(`debiteuren?select=vertegenw_code&limit=1`),
])
const factuur = factuurArr[0]
if (!factuur) throw new Error(`Factuur ${factuurId} niet gevonden`)
const bedrijf = bedrijfsArr[0].waarde
const deb = await sb(`debiteuren?debiteur_nr=eq.${factuur.debiteur_nr}&select=vertegenw_code`)
let vertegenwoordiger = 'Niet van Toepassing'
if (deb[0]?.vertegenw_code) {
  const v = await sb(`vertegenwoordigers?code=eq.${deb[0].vertegenw_code}&select=naam`)
  if (v[0]?.naam) vertegenwoordiger = v[0].naam
}

console.log(`Genereren PDF voor ${factuur.factuur_nr} — ${regels.length} regels, totaal € ${factuur.totaal}`)

// ============================================================
// PDF-layout (Karpi style, A4 staand, Courier)
// ============================================================
const MM = 2.8346457
const PAGE_W = 210 * MM
const PAGE_H = 297 * MM
const ML = 20 * MM
const MR = 20 * MM
const MB = 25 * MM
const MT = 20 * MM

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Courier)
const fontBold = await pdf.embedFont(StandardFonts.CourierBold)

const COL_ARTIKEL = ML
const COL_AANTAL = ML + 45 * MM
const COL_EH = ML + 60 * MM
const COL_OMSCHR = ML + 68 * MM
const COL_PRIJS_R = PAGE_W - MR - 25 * MM
const COL_BEDRAG_R = PAGE_W - MR

function drawRightText(page, text, xRight, y, size, f) {
  const w = f.widthOfTextAtSize(text, size)
  page.drawText(text, { x: xRight - w, y, size, font: f })
}

function formatEur(n) {
  return Number(n).toFixed(2)
}

function formatDatumNL(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function drawHeader(page, isCont) {
  // Rechter bedrijfs-blok
  let y = PAGE_H - 15 * MM
  page.drawText(bedrijf.bedrijfsnaam, { x: PAGE_W - MR - 60 * MM, y, size: 12, font: fontBold })
  y -= 5 * MM
  const right = [
    `${bedrijf.adres}`,
    `${bedrijf.postcode} ${bedrijf.plaats} (${bedrijf.land})`,
    `t ${bedrijf.telefoon}${bedrijf.fax ? ' | f ' + bedrijf.fax : ''}`,
    `e ${bedrijf.email} | i ${bedrijf.website}`,
  ]
  for (const line of right) {
    page.drawText(line, { x: PAGE_W - MR - 60 * MM, y, size: 7, font })
    y -= 3 * MM
  }
  // FACTUUR titel links
  page.drawText('FACTUUR', { x: ML, y: PAGE_H - 30 * MM, size: 14, font: fontBold })
  // Lijn
  page.drawLine({
    start: { x: ML, y: PAGE_H - 35 * MM },
    end: { x: PAGE_W - MR, y: PAGE_H - 35 * MM },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })

  if (!isCont) {
    // Klant-blok links
    let ky = PAGE_H - 50 * MM
    page.drawText(factuur.fact_naam ?? '', { x: ML, y: ky, size: 10, font: fontBold })
    ky -= 5 * MM
    page.drawText(factuur.fact_adres ?? '', { x: ML, y: ky, size: 10, font })
    ky -= 4 * MM
    page.drawText(`${factuur.fact_postcode ?? ''}  ${factuur.fact_plaats ?? ''}`, { x: ML, y: ky, size: 10, font })

    // Info-blok rechts
    let iy = PAGE_H - 50 * MM
    const ix = PAGE_W - MR - 75 * MM
    const rows = [
      ['Uw debiteurnummer', String(factuur.debiteur_nr)],
      ['Factuurnummer', factuur.factuur_nr],
      ['Factuurdatum', formatDatumNL(factuur.factuurdatum)],
      ['Vertegenwoordiger', vertegenwoordiger],
    ]
    for (const [label, value] of rows) {
      page.drawText(`${label.padEnd(17)}: ${value}`, { x: ix, y: iy, size: 9, font })
      iy -= 4 * MM
    }
  }

  // Tabel-header
  const ty = isCont ? PAGE_H - 45 * MM : PAGE_H - 78 * MM
  page.drawText('Artikel', { x: COL_ARTIKEL, y: ty, size: 9, font: fontBold })
  drawRightText(page, 'Aantal', COL_AANTAL + 8 * MM, ty, 9, fontBold)
  page.drawText('Eh', { x: COL_EH, y: ty, size: 9, font: fontBold })
  page.drawText('Omschrijving', { x: COL_OMSCHR, y: ty, size: 9, font: fontBold })
  drawRightText(page, 'Prijs', COL_PRIJS_R, ty, 9, fontBold)
  drawRightText(page, 'Bedrag', COL_BEDRAG_R, ty, 9, fontBold)
  page.drawLine({
    start: { x: ML, y: ty - 1.5 * MM },
    end: { x: PAGE_W - MR, y: ty - 1.5 * MM },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })

  return ty - 4 * MM  // startpositie voor body
}

function drawFooter(page, bedrijfsInfo) {
  const y = 12 * MM
  const line = `k.v.k. ${bedrijfsInfo.kvk}  |  btw ${bedrijfsInfo.btw_nummer}  |  ${bedrijfsInfo.bank}  |  nr ${bedrijfsInfo.rekeningnummer}  |  BIC ${bedrijfsInfo.bic}  |  IBAN ${bedrijfsInfo.iban}`
  const w = font.widthOfTextAtSize(line, 6)
  page.drawText(line, { x: (PAGE_W - w) / 2, y, size: 6, font })
}

function drawTransport(page, y, bedrag, isStart) {
  const label = isStart ? 'TRANSPORT BLAD' : 'TRANSPORTEREN BLAD'
  const text = `${label}   ${formatEur(bedrag)}`
  drawRightText(page, text, COL_BEDRAG_R, y, 9, fontBold)
}

// Groepeer regels per order_nr (bewaart volgorde)
const groepen = []
const groepMap = new Map()
for (const r of regels) {
  const key = r.order_nr ?? ''
  if (!groepMap.has(key)) {
    groepMap.set(key, { order_nr: key, uw_referentie: r.uw_referentie ?? '', regels: [] })
    groepen.push(groepMap.get(key))
  }
  groepMap.get(key).regels.push(r)
}

let page = pdf.addPage([PAGE_W, PAGE_H])
let cursorY = drawHeader(page, false)
let paginaTotaal = 0

function ensureRoom(neededMM) {
  if (cursorY - neededMM * MM < MB + 20 * MM) {
    // Transport-regel onderaan
    drawTransport(page, MB + 10 * MM, paginaTotaal, false)
    drawFooter(page, bedrijf)
    page = pdf.addPage([PAGE_W, PAGE_H])
    cursorY = drawHeader(page, true)
    drawTransport(page, cursorY, paginaTotaal, true)
    cursorY -= 6 * MM
  }
}

for (const groep of groepen) {
  ensureRoom(8 + groep.regels.length * 5)

  // Groep-kop
  cursorY -= 2 * MM
  page.drawText(`Ons Ordernummer : ${groep.order_nr}`, { x: ML, y: cursorY, size: 9, font })
  cursorY -= 4 * MM
  if (groep.uw_referentie) {
    page.drawText(`Uw Referentie   : ${groep.uw_referentie}`, { x: ML, y: cursorY, size: 9, font })
    cursorY -= 4 * MM
  }
  cursorY -= 2 * MM

  // Regels
  for (const r of groep.regels) {
    ensureRoom(5)
    const artikel = (r.artikelnr ?? '').slice(0, 20)
    page.drawText(artikel, { x: COL_ARTIKEL, y: cursorY, size: 9, font: fontBold })
    drawRightText(page, String(r.aantal), COL_AANTAL + 8 * MM, cursorY, 9, font)
    page.drawText('St', { x: COL_EH, y: cursorY, size: 9, font })
    const omschr = (r.omschrijving ?? '').slice(0, 35)
    page.drawText(omschr, { x: COL_OMSCHR, y: cursorY, size: 9, font })
    drawRightText(page, formatEur(r.prijs), COL_PRIJS_R, cursorY, 9, font)
    drawRightText(page, formatEur(r.bedrag), COL_BEDRAG_R, cursorY, 9, font)
    cursorY -= 4 * MM
    if (r.omschrijving_2) {
      const o2 = r.omschrijving_2.slice(0, 50)
      page.drawText(o2, { x: COL_OMSCHR, y: cursorY, size: 9, font })
      cursorY -= 4 * MM
    }
    paginaTotaal += Number(r.bedrag)
  }
}

// BTW-blok + totaal onderaan
ensureRoom(30)
cursorY -= 6 * MM
page.drawLine({
  start: { x: ML, y: cursorY },
  end: { x: PAGE_W - MR, y: cursorY },
  thickness: 0.5,
})
cursorY -= 5 * MM
page.drawText('Grondsl.', { x: ML + 20 * MM, y: cursorY, size: 9, font: fontBold })
page.drawText('BTW %', { x: ML + 60 * MM, y: cursorY, size: 9, font: fontBold })
page.drawText('BTWbedrag', { x: ML + 85 * MM, y: cursorY, size: 9, font: fontBold })
drawRightText(page, 'Te Betalen', COL_BEDRAG_R, cursorY, 9, fontBold)
cursorY -= 2 * MM
page.drawLine({
  start: { x: ML, y: cursorY },
  end: { x: PAGE_W - MR, y: cursorY },
  thickness: 0.5,
})
cursorY -= 5 * MM
page.drawText(formatEur(factuur.subtotaal), { x: ML + 20 * MM, y: cursorY, size: 10, font })
page.drawText(formatEur(factuur.btw_percentage), { x: ML + 60 * MM, y: cursorY, size: 10, font })
page.drawText(formatEur(factuur.btw_bedrag), { x: ML + 85 * MM, y: cursorY, size: 10, font })
drawRightText(page, `${formatEur(factuur.totaal)} EUR`, COL_BEDRAG_R, cursorY, 10, fontBold)
cursorY -= 8 * MM
page.drawText(`Betalingscond.: ${bedrijf.betalingscondities_tekst}`, { x: ML, y: cursorY, size: 8, font })

drawFooter(page, bedrijf)

const pdfBytes = await pdf.save()
console.log(`PDF gegenereerd: ${pdfBytes.length} bytes`)

// Upload naar storage
const pdfPath = `${factuur.debiteur_nr}/${factuur.factuur_nr}.pdf`
const upRes = await fetch(
  `${SUPABASE_URL}/storage/v1/object/facturen/${pdfPath}`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: pdfBytes,
  },
)
if (!upRes.ok) throw new Error(`Upload: ${upRes.status} ${await upRes.text()}`)
console.log(`Geüpload naar facturen/${pdfPath}`)

// Update factuur-record
await fetch(
  `${SUPABASE_URL}/rest/v1/facturen?id=eq.${factuurId}`,
  {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ pdf_storage_path: pdfPath }),
  },
)

// Signed URL (10 min)
const signRes = await fetch(
  `${SUPABASE_URL}/storage/v1/object/sign/facturen/${pdfPath}`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 600 }),
  },
)
const signed = await signRes.json()
console.log(`\n✅ KLAAR`)
console.log(`Factuur:  ${factuur.factuur_nr}`)
console.log(`Totaal:   € ${formatEur(factuur.totaal)}`)
console.log(`Regels:   ${regels.length}`)
console.log(`\nSigned URL (10 min geldig):`)
console.log(`${SUPABASE_URL}${signed.signedURL ?? signed.signedUrl}`)
