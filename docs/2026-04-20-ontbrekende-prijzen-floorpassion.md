# Ontbrekende Floorpassion-prijzen (prijslijst 0145) — 2026-04-20

Op 38 webshop-orderregels kon geen klantprijs worden bepaald omdat het
artikelnr niet voorkomt in prijslijst **0145** (Floorpassion) én het
product geen `verkoopprijs` heeft. De bestaande (foutieve) consumentprijs
is daarom niet overschreven en staat nog op die regels.

**Actie:** voeg deze artikelnrs toe aan prijslijst 0145, daarna kan de
backfill nogmaals gedraaid worden (`node scripts/backfill-floorpassion-klantprijs.mjs`).

## Samenvatting

- Totaal regels zonder prijs: **38**
- Unieke artikelnrs: **32**
- Alle producten bestaan in de `producten`-tabel (geen nieuwe artikelen aan te maken).
- Categorieën:
  - **MAATWERK** (`{KW}{KL}MAATWERK`-producten, €/m²): 15 artikelen
  - **Standaard** (vaste dims): 15 artikelen
  - **Staaltjes** (Gratis Muster): 2 artikelen

## Unieke artikelnrs

| Artikelnr | KW-KL | # regels | Omschrijving / Context |
|-----------|-------|---------:|------------------------|
| 1324001   | TWIS-17 | 3 | Tore 17 — Op maat (maatwerk) |
| 1324002   | TWIS-21 | 1 | Tore 21 — Durchmesser rund (maatwerk) |
| 1337000   | TAMA-13 | 1 | Sisal Outdoor 13 — Wunschgröße (maatwerk) |
| 1337002   | TAMA-21 | 2 | Sisal Outdoor 21 — rund/Op maat (maatwerk) |
| 1337003   | TAMA-23 | 2 | Sisal Outdoor 23 — Op maat (maatwerk) |
| 1339002   | SEAO-23 | 1 | Botanique 23 — Durchmesser (maatwerk) |
| 1345002   | HARM-16 | 1 | Natural Life 16 — Durchmesser (maatwerk) |
| 1345003   | HARM-18 | 1 | Natural Life 18 — Wunschgröße (maatwerk) |
| 1402002   | DANT-23 | 1 | Luxor 23 — Gratis Muster (staaltje) |
| 1526047   | EMIR-37 | 1 | Mace 37 — rond (maatwerk) |
| 1530003   | BABY-53 | 1 | Barra 53 — Op maat (maatwerk) |
| 1553020   | LAMI-55 | 1 | Ross 55 — Op maat (maatwerk) |
| 1650005   | ELIA-24 | 1 | Chester 24 — Wunschgröße (maatwerk) |
| 1737004   | ALDO-35 | 1 | Reef 35 — Wunschgröße (maatwerk) |
| 328150013 | LORA-15 | 1 | Liv 15 — 300×400 (standaard) |
| 337180000 | TAMA-18 | 1 | Sisal Outdoor 18 — rond (standaard) |
| 337230005 | TAMA-23 | 1 | Sisal Outdoor 23 — 240×340 (standaard) |
| 443170005 | RICH-17 | 1 | Brüssel 17 — 250×350 (standaard) |
| 490120017 | LUXR-12 | 1 | Reef 12 — 300×400 (standaard) |
| 490130035 | LUXR-13 | 2 | Reef 13 — 300×400 (standaard) |
| 490170015 | VERR-17 | 1 | Vernon 17 — rond (standaard) |
| 490680002 | VERR-68 | 1 | Vernon 68 — 200×290 (standaard) |
| 516130005 | ECLA-13 | 1 | Rumi 13 — 200×290 (standaard) |
| 526150110 | ENEM-15 | 1 | Sweder 15 — 200×290 (standaard) |
| 526650073 | PABL-65 | 1 | Enzo 65 — ovaal (standaard) |
| 526650115 | PROS-65 | 1 | Prosper 65 — Durchmesser (standaard) |
| 553150001 | LAMI-15 | 1 | Ross 15 — 80×150 (standaard) |
| 553690042 | LAMI-69 | 1 | Ross 69 — Gratis Muster (staaltje) |
| 612130016 | GLAM-13 | 2 | Ross 13 — 80×150 (standaard) |
| 612160000 | GLAM-16 | 1 | Ross 16 — 80×150 (standaard) |
| 612250003 | GLAM-25 | 1 | Ross 25 — Gratis Muster (staaltje) |
| 771250010 | CISC-25 | 1 | Sandro 25 — 300×400 (standaard) |

## Geraakte orders (ter referentie)

ORD-2026-1674, 1679, 1689, 1690, 1693, 1699, 1706, 1708, 1713, 1720,
1721, 1729, 1737, 1751, 1756, 1758, 1760, 1765, 1767, 1777, 1796, 1800,
1812, 1817, 1820, 1821, 1831, 1834, 1835, 1838, 1840, 1842, 1845, 1848.
