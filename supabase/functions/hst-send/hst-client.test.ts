import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { extractErrorMsgVoorTest } from './hst-client.ts';

Deno.test('extractErrorMsg leest HST PascalCase ErrorMessage', () => {
  const body = { Success: false, ErrorMessage: 'Bellen voor aflevering. Geef een telefoonnummer op.' };
  assertEquals(
    extractErrorMsgVoorTest(body, 400),
    'Bellen voor aflevering. Geef een telefoonnummer op.',
  );
});

Deno.test('extractErrorMsg valt terug op HTTP-code bij leeg body', () => {
  assertEquals(extractErrorMsgVoorTest(null, 503), 'HTTP 503');
});

Deno.test('extractErrorMsg leest lowercase message ook nog', () => {
  assertEquals(extractErrorMsgVoorTest({ message: 'kapot' }, 500), 'kapot');
});
