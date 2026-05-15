// Deno unit tests voor po-extract.ts
import { assertEquals, assert, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { buildAnthropicRequest, parsePoExtractie } from './po-extract.ts'

Deno.test('buildAnthropicRequest zet PDF als document-block + cache op system', () => {
  const req = buildAnthropicRequest('QkFTRTY0', 'order.pdf')
  assertEquals(req.model.startsWith('claude-'), true)
  const sys = req.system as Array<{ type: string; cache_control?: unknown }>
  assert(sys.some((b) => b.cache_control), 'system-prompt moet cache_control hebben')
  const content = req.messages[0].content as Array<{ type: string }>
  assert(content.some((c) => c.type === 'document'), 'document-block ontbreekt')
})

Deno.test('parsePoExtractie accepteert geldige Claude-respons', () => {
  const claudeJson = {
    content: [{ type: 'text', text: JSON.stringify({
      afzender: { naam: 'GERO MEUBELEN N.V.', email: 'info@geromeubelen.be', btw_nummer: 'BE0415070027', kvk: null, adres: null },
      klant_referentie: '06092093',
      leverdatum_tekst: 'zo snel mogelijk',
      spoed: true,
      afleveradres: { naam: 'MAGAZIJN SCHOLLEBEEK', adres: 'SCHOLLEBEEKSTRAAT 74', postcode: '2500', plaats: 'LIER', land: 'BE' },
      factuuradres: null,
      regels: [
        { aantal: 5, ruwe_omschrijving: 'PLUSH 100% POLYESTER: KUSSEN 45 X 45CM - KLEUR 13', kwaliteit_tekst: 'PLUSH', kleur_tekst: '13', lengte_cm: 45, breedte_cm: 45, vorm_tekst: null, klant_artikelnr: null, prijs: 15.7, korting_pct: 7 },
      ],
    }) }],
  }
  const out = parsePoExtractie(claudeJson)
  assertEquals(out.afzender.btw_nummer, 'BE0415070027')
  assertEquals(out.regels.length, 1)
  assertEquals(out.regels[0].aantal, 5)
  assertEquals(out.spoed, true)
})

Deno.test('parsePoExtractie verwerkt JSON in ```json fences', () => {
  const claudeJson = { content: [{ type: 'text', text: '```json\n{"afzender":{"naam":"X"},"klant_referentie":null,"leverdatum_tekst":null,"spoed":false,"afleveradres":null,"factuuradres":null,"regels":[]}\n```' }] }
  const out = parsePoExtractie(claudeJson)
  assertEquals(out.afzender.naam, 'X')
  assertEquals(out.regels.length, 0)
})

Deno.test('parsePoExtractie gooit bij niet-parseerbare respons', () => {
  assertThrows(() => parsePoExtractie({ content: [{ type: 'text', text: 'geen json hier' }] }))
})
