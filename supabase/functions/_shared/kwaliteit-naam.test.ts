// Tests voor kwaliteitNaamUitVervolg (gedeelde seam, ADR-0033).
// Spiegelt de cases uit frontend shipping-label-data.test.ts.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { kwaliteitNaamUitVervolg, leverancierskleurcodeUitVervolg } from './kwaliteit-naam.ts'

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

Deno.test('leverancierskleurcodeUitVervolg: streepje-patroon → code na de streep', () => {
  // Echte gevallen uit de productdata (2026-07-01, mail Pick & Ship).
  assertEquals(leverancierskleurcodeUitVervolg('SOFIA 3726-G305 CA: 080x150 cm'), 'G305')
  assertEquals(leverancierskleurcodeUitVervolg('MANDA 3726-1V48 CA: 240x330 cm'), '1V48')
  assertEquals(leverancierskleurcodeUitVervolg('CABANA 5367-6Y09 CA: 160x230 cm'), '6Y09')
})

Deno.test('leverancierskleurcodeUitVervolg: geen streepje-patroon → null', () => {
  // Normale "Kleur N" — geen extra tekst tussen naam en marker.
  assertEquals(leverancierskleurcodeUitVervolg('GALAXY Kleur 21 CA: 60x90 cm'), null)
  // "Kl.NN"-parse-artefact: bevat toevallig een cijfer maar geen streepje —
  // inhoudelijk identiek aan kleur_code, dus geen nieuwe info.
  assertEquals(leverancierskleurcodeUitVervolg('SILVER SPRING Kl.24 CA: 200x290 cm'), null)
  // Los dessin-/patroonnummer zonder streepje.
  assertEquals(leverancierskleurcodeUitVervolg('ROMANCE 1200 Kleur 41 CA:068x220 cm'), null)
  // Los kleurnummer zonder streepje.
  assertEquals(leverancierskleurcodeUitVervolg('GALAXY 10 CA: 240x340 cm ORGANIC'), null)
  // Geen marker-token gevonden → geen betrouwbare grens.
  assertEquals(leverancierskleurcodeUitVervolg('PATS23XX060090'), null)
  assertEquals(leverancierskleurcodeUitVervolg(''), null)
  assertEquals(leverancierskleurcodeUitVervolg(null), null)
  assertEquals(leverancierskleurcodeUitVervolg(undefined), null)
})
