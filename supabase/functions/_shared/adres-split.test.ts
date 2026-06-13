import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { landNaarIso2Strikt, normalizeCountry, splitAdres } from './adres-split.ts';

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

Deno.test('normalizeCountry: BE/FR + eerste-2-letters-vallen (regressie factuur-EDI)', () => {
  assertEquals(normalizeCountry('België'), 'BE');
  assertEquals(normalizeCountry('Frankrijk'), 'FR');
  assertEquals(normalizeCountry('Oostenrijk'), 'AT'); // was 'OO' bij slice(0,2)
  assertEquals(normalizeCountry('Zwitserland'), 'CH'); // was 'ZW'
  assertEquals(normalizeCountry('Spanje'), 'ES'); // was 'SP'
  assertEquals(normalizeCountry('Engeland'), 'GB'); // was 'EN'
});

Deno.test('normalizeCountry: onbekend land komt diakriet-vrij/uppercased terug', () => {
  assertEquals(normalizeCountry('Verweggistan'), 'VERWEGGISTAN');
  assertEquals(normalizeCountry(''), '');
  assertEquals(normalizeCountry(null), '');
});

Deno.test('landNaarIso2Strikt: onbekend → null, bekend → ISO-2', () => {
  assertEquals(landNaarIso2Strikt('Verweggistan'), null);
  assertEquals(landNaarIso2Strikt(''), null);
  assertEquals(landNaarIso2Strikt('Belgium'), 'BE');
  assertEquals(landNaarIso2Strikt('de'), 'DE');
});
