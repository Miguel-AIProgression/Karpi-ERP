import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { valideerVoorVervoerder } from './vervoerder-eisen.ts';

const basis = {
  vervoerder_code: 'hst_api',
  afl_land: 'NL', afl_telefoon: '0612345678',
  afl_naam: 'Klant', afl_adres: 'Teststraat 1', afl_postcode: '1111 AA', afl_plaats: 'Diemen',
};

Deno.test('valideerVoorVervoerder: complete order is ok', () => {
  const r = valideerVoorVervoerder(basis);
  assertEquals(r.ok, true);
  assertEquals(r.problemen.length, 0);
});

Deno.test('valideerVoorVervoerder: ontbrekend telefoonnummer faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_telefoon: null });
  assertEquals(r.ok, false);
  assertEquals(r.problemen[0].code, 'TELEFOON_ONTBREEKT');
});

Deno.test('valideerVoorVervoerder: te kort telefoonnummer faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_telefoon: '0612' });
  assertEquals(r.problemen[0].code, 'TELEFOON_ONTBREEKT');
});

Deno.test('valideerVoorVervoerder: land buiten bereik faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_land: 'BE' });
  assertEquals(r.ok, false);
  assertEquals(r.problemen.some((p) => p.code === 'LAND_BUITEN_BEREIK'), true);
});

Deno.test('valideerVoorVervoerder: leeg adres faalt op velden', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_adres: '', afl_plaats: '' });
  assertEquals(r.ok, false);
  assertEquals(r.problemen.some((p) => p.code === 'ADRESVELD_LEEG'), true);
});

Deno.test('valideerVoorVervoerder: niet-HST vervoerder wordt overgeslagen', () => {
  const r = valideerVoorVervoerder({ ...basis, vervoerder_code: 'edi_partner_a', afl_telefoon: null });
  assertEquals(r.ok, true); // alleen HST-regels in v1
});

Deno.test('verhoek_sftp: lege adresvelden geven ADRESVELD_LEEG', () => {
  const r = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: 'NL', afl_telefoon: null,
    afl_naam: 'Klant', afl_adres: '', afl_postcode: '7122 LB', afl_plaats: 'Aalten',
  });
  assertEquals(r.ok, false);
  assertEquals(r.problemen[0].code, 'ADRESVELD_LEEG');
});

Deno.test('verhoek_sftp: compleet adres is ok (telefoon niet verplicht)', () => {
  const r = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: 'DE', afl_telefoon: null,
    afl_naam: 'Klant', afl_adres: 'Hauptstr. 1', afl_postcode: '48683', afl_plaats: 'Ahaus',
  });
  assertEquals(r.ok, true);
});
