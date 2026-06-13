import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { capabilityVoor, VERZEND_CAPABILITIES } from './capabilities.ts';

Deno.test('capabilityVoor: bekende carriers', () => {
  assertEquals(capabilityVoor('hst_api')?.code, 'hst_api');
  assertEquals(capabilityVoor('verhoek_sftp')?.code, 'verhoek_sftp');
  assertEquals(capabilityVoor('rhenus_sftp')?.code, 'rhenus_sftp');
});

Deno.test('capabilityVoor: onbekende carrier → null (geen preflight)', () => {
  assertEquals(capabilityVoor('dpd'), null);
  assertEquals(capabilityVoor('edi_partner_a'), null);
});

Deno.test('HST: REST, NL-bereik, telefoon+land verplicht, pallet-defaults', () => {
  const c = capabilityVoor('hst_api')!;
  assertEquals(c.protocol, 'rest');
  assertEquals(c.landbereik, ['NL']);
  assertEquals(c.preflight.vereistTelefoon, true);
  assertEquals(c.preflight.vereistLandInBereik, true);
  assertEquals(c.preflight.vereistColli, false);
  assertEquals(c.defaultAfmetingen, { lengteCm: 120, breedteCm: 80, hoogteCm: 20, gewichtKg: 1 });
});

Deno.test('Verhoek: SFTP, onbegrensd bereik, colli sscc+lengte+breedte+gewicht, geen default-afmetingen', () => {
  const c = capabilityVoor('verhoek_sftp')!;
  assertEquals(c.protocol, 'sftp');
  assertEquals(c.landbereik, null);
  assertEquals(c.preflight.vereistTelefoon, false);
  assertEquals(c.preflight.vereistLandInBereik, false);
  assertEquals(c.preflight.vereistColli, false);
  assertEquals(c.preflight.colliVelden, ['sscc', 'lengte_cm', 'breedte_cm', 'gewicht_kg']);
  assertEquals(c.defaultAfmetingen, null);
});

Deno.test('Rhenus: SFTP, ≥1 colli verplicht, colli zonder breedte', () => {
  const c = capabilityVoor('rhenus_sftp')!;
  assertEquals(c.protocol, 'sftp');
  assertEquals(c.preflight.vereistColli, true);
  assertEquals(c.preflight.colliVelden, ['sscc', 'gewicht_kg', 'lengte_cm']);
  assertEquals(c.defaultAfmetingen, null);
});

Deno.test('registry telt exact 3 carriers', () => {
  assertEquals(Object.keys(VERZEND_CAPABILITIES).sort(), ['hst_api', 'rhenus_sftp', 'verhoek_sftp']);
});
