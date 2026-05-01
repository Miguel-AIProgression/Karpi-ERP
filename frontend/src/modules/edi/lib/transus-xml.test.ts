// Tests voor de TransusXML orderbevestiging-builder.
//
// Fixture: docs/transus/voorbeelden/orderbev-uit-bdsk-168911805.xml — echt
// productie-bestand zoals Karpi het op 2026-04-30 naar Transus stuurde voor
// klantorder 8MRE0 (BDSK Handels). De builder moet deze output byte-identiek
// kunnen reproduceren.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildOrderbevTransusXml,
  buildOrderResponseNumber,
  type OrderbevXmlInput,
} from './transus-xml'

const FIXTURE_PATH = join(
  __dirname,
  '../../../../../docs/transus/voorbeelden/orderbev-uit-bdsk-168911805.xml',
)

const bdsk8mre0Input: OrderbevXmlInput = {
  senderGln: '8715954999998',
  recipientGln: '9007019015989',
  isTestMessage: false,
  orderResponseNumber: '265543600001',
  orderResponseDate: '2026-04-30',
  action: 'ACC',
  orderNumberBuyer: '8MRE0',
  orderNumberSupplier: '26554360',
  orderDate: '2026-04-29',
  earliestDeliveryDate: '2026-05-22',
  latestDeliveryDate: '2026-05-22',
  currencyCode: 'EUR',
  buyerGln: '9007019005430',
  supplierGln: '8715954999998',
  invoiceeGln: '9007019015989',
  deliveryPartyGln: '9007019005430',
  articles: [
    {
      lineNumber: '1',
      articleDescription: 'PATCH FARBE 23 CA  080X150 CM',
      articleCodeSupplier: 'PATS23XX080150',
      gtin: '8715954176023',
      purchasePrice: 29.73,
      articleNetPrice: 29.73,
      vatPercentage: 0,
      action: 'ACC',
      orderedQuantity: 1,
      despatchedQuantity: 1,
      deliveryDate: '2026-05-22',
    },
    {
      lineNumber: '2',
      articleDescription: 'PATCH FARBE 92 CA  060X090 CM',
      articleCodeSupplier: 'PATS92XX060090',
      gtin: '8715954218143',
      purchasePrice: 13.38,
      articleNetPrice: 13.38,
      vatPercentage: 0,
      action: 'ACC',
      orderedQuantity: 1,
      despatchedQuantity: 1,
      deliveryDate: '2026-05-22',
    },
    {
      lineNumber: '3',
      articleDescription: 'PATCH FARBE 10 CA  060X090 CM',
      articleCodeSupplier: 'PATS10XX060090',
      gtin: '8715954235829',
      purchasePrice: 13.38,
      articleNetPrice: 13.38,
      vatPercentage: 0,
      action: 'ACC',
      orderedQuantity: 1,
      despatchedQuantity: 1,
      deliveryDate: '2026-05-22',
    },
  ],
}

describe('buildOrderbevTransusXml — BDSK 8MRE0 fixture', () => {
  it('reproduceert fixture-content (genormaliseerd op whitespace)', () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8')
    const built = buildOrderbevTransusXml(bdsk8mre0Input)

    // Het echte fixture-bestand kan trailing whitespace of CRLF hebben — we
    // vergelijken de genormaliseerde inhoud (alle whitespace tussen tags weg).
    const normalize = (s: string) => s.replace(/>\s+</g, '><').trim()
    expect(normalize(built)).toBe(normalize(fixture))
  })

  it('bevat alle verplichte header-velden', () => {
    const xml = buildOrderbevTransusXml(bdsk8mre0Input)
    expect(xml).toContain('<MessageFormat>TRANSUSXML</MessageFormat>')
    expect(xml).toContain('<SenderGLN>8715954999998</SenderGLN>')
    expect(xml).toContain('<RecipientGLN>9007019015989</RecipientGLN>')
    expect(xml).toContain('<IsTestMessage>N</IsTestMessage>')
    expect(xml).toContain('<OrderResponseNumber>265543600001</OrderResponseNumber>')
    expect(xml).toContain('<OrderResponseDate>20260430</OrderResponseDate>')
    expect(xml).toContain('<OrderNumberSupplier>26554360</OrderNumberSupplier>')
    expect(xml).toContain('<OrderDate>20260429</OrderDate>')
    expect(xml).toContain('<EarliestDeliveryDate>20260522</EarliestDeliveryDate>')
    expect(xml).toContain('<LatestDeliveryDate>20260522</LatestDeliveryDate>')
    expect(xml).toContain('<BuyerGLN>9007019005430</BuyerGLN>')
    expect(xml).toContain('<DeliveryPartyGLN>9007019005430</DeliveryPartyGLN>')
  })

  it('padt OrderNumberBuyer naar 35 tekens (right-padded met spaces)', () => {
    const xml = buildOrderbevTransusXml(bdsk8mre0Input)
    // 8MRE0 (5 chars) + 30 spaces = 35
    expect(xml).toContain('<OrderNumberBuyer>8MRE0' + ' '.repeat(30) + '</OrderNumberBuyer>')
  })

  it('padt LineNumber naar 5 cijfers met leading zeroes', () => {
    const xml = buildOrderbevTransusXml(bdsk8mre0Input)
    expect(xml).toContain('<LineNumber>00001</LineNumber>')
    expect(xml).toContain('<LineNumber>00002</LineNumber>')
    expect(xml).toContain('<LineNumber>00003</LineNumber>')
  })

  it('formatteert prijzen met 2 decimalen en punt', () => {
    const xml = buildOrderbevTransusXml(bdsk8mre0Input)
    expect(xml).toContain('<PurchasePrice>29.73</PurchasePrice>')
    expect(xml).toContain('<ArticleNetPrice>13.38</ArticleNetPrice>')
  })

  it('plaatst exact 3 ARTICLE-blokken voor 3 regels', () => {
    const xml = buildOrderbevTransusXml(bdsk8mre0Input)
    const matches = xml.match(/<ARTICLE>/g) || []
    expect(matches.length).toBe(3)
  })
})

describe('buildOrderbevTransusXml — edge cases', () => {
  it('escapet XML-special characters in tekstvelden', () => {
    const input = { ...bdsk8mre0Input }
    input.articles = [
      {
        ...bdsk8mre0Input.articles[0],
        articleDescription: 'Test & "special" <chars>',
      },
    ]
    const xml = buildOrderbevTransusXml(input)
    expect(xml).toContain('Test &amp; &quot;special&quot; &lt;chars&gt;')
  })

  it('zet IsTestMessage=Y als isTestMessage=true', () => {
    const xml = buildOrderbevTransusXml({ ...bdsk8mre0Input, isTestMessage: true })
    expect(xml).toContain('<IsTestMessage>Y</IsTestMessage>')
  })

  it('accepteert YYYYMMDD-datums direct (geen dubbele conversie)', () => {
    const xml = buildOrderbevTransusXml({
      ...bdsk8mre0Input,
      orderResponseDate: '20260430',
    })
    expect(xml).toContain('<OrderResponseDate>20260430</OrderResponseDate>')
  })

  it('gooit op ongeldige datum-input', () => {
    expect(() =>
      buildOrderbevTransusXml({ ...bdsk8mre0Input, orderResponseDate: '30-04-2026' }),
    ).toThrow(/Invalid date format/)
  })
})

describe('buildOrderResponseNumber', () => {
  it('combineert ordernummer met 4-digit zero-padded sequentie', () => {
    expect(buildOrderResponseNumber('26554360', 1)).toBe('265543600001')
    expect(buildOrderResponseNumber('26554360', 2)).toBe('265543600002')
    expect(buildOrderResponseNumber('26554360', 99)).toBe('265543600099')
    expect(buildOrderResponseNumber('26554360', 9999)).toBe('265543609999')
  })

  it('gooit op ongeldige sequentie', () => {
    expect(() => buildOrderResponseNumber('26554360', 0)).toThrow()
    expect(() => buildOrderResponseNumber('26554360', 10000)).toThrow()
  })
})
