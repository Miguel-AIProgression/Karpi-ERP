import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { labelBarcode } from './labelbarcode.ts';

Deno.test('18-cijferige SSCC krijgt AI(00)-prefix → 20 cijfers', () => {
  const sscc = '871595400000000017'; // 18 cijfers
  const barcode = labelBarcode(sscc);
  assertEquals(barcode, `00${sscc}`);
  assertEquals(barcode?.length, 20);
});

Deno.test('prefix is exact 00 + onveranderde SSCC', () => {
  assertEquals(labelBarcode('123456789012345678'), '00123456789012345678');
});

Deno.test('null SSCC → null (nooit een niet-aangemelde barcode)', () => {
  assertEquals(labelBarcode(null), null);
});

Deno.test('undefined SSCC → null', () => {
  assertEquals(labelBarcode(undefined), null);
});

Deno.test('lege string → null', () => {
  assertEquals(labelBarcode(''), null);
});
