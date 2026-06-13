import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { type ColliMeldingen, valideerColli } from './colli.ts';
import { capabilityVoor } from './capabilities.ts';

const MELD: ColliMeldingen = {
  geenColli: 'GEEN_COLLI',
  perVeld: {
    sscc: (n) => `sscc:${n}`,
    lengte_cm: (n) => `lengte:${n}`,
    breedte_cm: (n) => `breedte:${n}`,
    gewicht_kg: (n) => `gewicht:${n}`,
  },
};

const compleet = { colli_nr: 1, sscc: '00123', gewicht_kg: 5, lengte_cm: 160, breedte_cm: 90 };

Deno.test('vereistColli + lege zending → 0-colli-melding', () => {
  const r = valideerColli([], capabilityVoor('rhenus_sftp')!, MELD);
  assertEquals(r, [{ colli_nr: 0, veld: 'aantal', melding: 'GEEN_COLLI' }]);
});

Deno.test('geen vereistColli + lege zending → geen probleem', () => {
  assertEquals(valideerColli([], capabilityVoor('verhoek_sftp')!, MELD), []);
});

Deno.test('alleen de descriptor-velden worden gecheckt (Rhenus: geen breedte)', () => {
  const kapot = { colli_nr: 7, sscc: '', gewicht_kg: null, lengte_cm: null, breedte_cm: null };
  const r = valideerColli([kapot], capabilityVoor('rhenus_sftp')!, MELD);
  // sscc + gewicht + lengte, in descriptor-volgorde; breedte NIET (niet vereist).
  assertEquals(r.map((p) => p.veld), ['sscc', 'gewicht_kg', 'lengte_cm']);
});

Deno.test('Verhoek checkt breedte wél', () => {
  const kapot = { colli_nr: 2, sscc: 'x', gewicht_kg: 1, lengte_cm: 1, breedte_cm: 0 };
  const r = valideerColli([kapot], capabilityVoor('verhoek_sftp')!, MELD);
  assertEquals(r.map((p) => p.veld), ['breedte_cm']);
});

Deno.test('compleet colli → geen problemen', () => {
  assertEquals(valideerColli([compleet], capabilityVoor('rhenus_sftp')!, MELD), []);
  assertEquals(valideerColli([compleet], capabilityVoor('verhoek_sftp')!, MELD), []);
});
