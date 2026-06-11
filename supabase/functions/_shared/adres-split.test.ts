import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeCountry, splitAdres } from './adres-split.ts';

Deno.test('splitAdres: standaard adres', () => {
  assertEquals(splitAdres('Tweede Broekdijk 10'), { street: 'Tweede Broekdijk', number: '10', addition: '' });
});

Deno.test('splitAdres: toevoeging vast aan nummer', () => {
  assertEquals(splitAdres('Raasdorperweg 181G'), { street: 'Raasdorperweg', number: '181', addition: 'G' });
});

Deno.test('splitAdres: haakjes worden toevoeging (incident ZEND-2026-0002)', () => {
  assertEquals(splitAdres('Saturnusstraat 60 (Unit 30)'), { street: 'Saturnusstraat', number: '60', addition: 'Unit 30' });
});

Deno.test('normalizeCountry: NL/DE-varianten', () => {
  assertEquals(normalizeCountry('Nederland'), 'NL');
  assertEquals(normalizeCountry('nl'), 'NL');
  assertEquals(normalizeCountry('Duitsland'), 'DE');
});
