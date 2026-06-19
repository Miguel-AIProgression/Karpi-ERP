// Tests voor kwaliteitNaamUitVervolg (gedeelde seam, ADR-0033).
// Spiegelt de cases uit frontend shipping-label-data.test.ts.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { kwaliteitNaamUitVervolg } from './kwaliteit-naam.ts'

Deno.test('kwaliteitNaamUitVervolg: naam tot eerste cijfer/marker', () => {
  // Stopt op de "Kleur"-marker.
  assertEquals(kwaliteitNaamUitVervolg('GALAXY Kleur 21 CA: 60x90 cm'), 'GALAXY')
  // Stopt op de Duitse "Farbe"-marker; meerdere woorden behouden.
  assertEquals(kwaliteitNaamUitVervolg('EGYPTISCHE WOL Farbe 3'), 'EGYPTISCHE WOL')
  // "Kl."-marker.
  assertEquals(kwaliteitNaamUitVervolg('NEW ORLEANS Kl. 5'), 'NEW ORLEANS')
  // Stopt op het eerste token met een cijfer.
  assertEquals(kwaliteitNaamUitVervolg('BANGKOK 230x260'), 'BANGKOK')
})

Deno.test('kwaliteitNaamUitVervolg: pure code of leeg → null', () => {
  // Een kale artikelcode (begint met cijfer-bevattend token) levert geen naam.
  assertEquals(kwaliteitNaamUitVervolg('PATS23XX060090'), null)
  assertEquals(kwaliteitNaamUitVervolg(''), null)
  assertEquals(kwaliteitNaamUitVervolg(null), null)
  assertEquals(kwaliteitNaamUitVervolg(undefined), null)
  // Leidende marker → geen naam.
  assertEquals(kwaliteitNaamUitVervolg('Kleur 21'), null)
})
