import { assertEquals, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { valideerVerzendberichtInput, type VerzendberichtInput } from './karpi-verzendbericht.ts';

const basis: VerzendberichtInput = {
  zendingNr: 'ZEND-2026-0042',
  verzenddatum: '2026-06-11',
  leverdatum: '2026-06-12',
  orderNumberBuyer: '8MRE0',
  orderNumberSupplier: 'ORD-2026-0334',
  senderGln: '8715954999998',
  recipientGln: '9007019010007',
  buyerGln: '9007019015989',
  deliveryPartyGln: '8712423012345',
  trackingNummer: null,
  isTestMessage: false,
  regels: [
    { regelnummer: 1, gtin: '8715954123456', artikelcode: 'KW123', omschrijving: 'Tapijt', aantal: 2 },
  ],
};

Deno.test('valideerVerzendberichtInput accepteert volledige input', () => {
  assertEquals(valideerVerzendberichtInput(basis), undefined);
});

Deno.test('valideerVerzendberichtInput gooit bij ontbrekende GLN of lege regels', () => {
  assertThrows(() => valideerVerzendberichtInput({ ...basis, recipientGln: '' }));
  assertThrows(() => valideerVerzendberichtInput({ ...basis, regels: [] }));
});
