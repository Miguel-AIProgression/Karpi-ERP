# Ontbrekende Floorpassion-prijzen (prijslijst 0145) — 2026-04-20

## Status na tweede rematch-ronde

Bij de eerste analyse stonden **38** webshop-regels zonder prijs-match.
Nader onderzoek wees uit dat 16 daarvan foutief aan een **rol-artikel**
(grondstof, bv. `1337000` = "TAMAR KLEUR 13 400 BREED") i.p.v. aan het
**MAATWERK-eindproduct** (bv. `337139999` = "TAMA13MAATWERK") waren
gekoppeld. Het rematch-script was uitgebreid om ook
`is_maatwerk=true + maatwerk_kwaliteit_code IS NULL`-regels te pakken.
Deze zijn nu gekoppeld aan het juiste MAATWERK-artikel en hebben
automatisch de prijs uit prijslijst 0145 gekregen.

Overgebleven: **22 regels** (20 unieke artikelnrs) die daadwerkelijk
ontbreken in prijslijst 0145.

## Categorisering (22 regels)

### A. Staaltjes (Gratis Muster) — 3 regels
| Artikelnr | KW-KL | Omschrijving |
|-----------|-------|--------------|
| 1402002   | DANT-23 | Luxor 23 — Gratis Muster |
| 553690042 | LAMI-69 | Ross 69 — Gratis Muster |
| 612250003 | GLAM-25 | Ross 25 — Gratis Muster |

*Actie:* bepalen of stalen doorberekend worden; zo ja, vaste staal-prijs
op prijslijst 0145 zetten (bv. €0,00 / €2,50 / €5,00).

### B. Standaard-artikelen zonder prijslijst-regel — 17 regels
| Artikelnr | KW-KL | # | Dimensies/Context |
|-----------|-------|---|-------------------|
| 328150013 | LORA-15 | 1 | 300×400 |
| 337180000 | TAMA-18 | 1 | 200 rond |
| 337230005 | TAMA-23 | 1 | 240×340 |
| 443170005 | RICH-17 | 1 | 250×350 |
| 490120017 | LUXR-12 | 1 | 300×400 |
| 490130035 | LUXR-13 | 2 | 300×400 |
| 490170015 | VERR-17 | 1 | rond |
| 490680002 | VERR-68 | 1 | 200×290 |
| 516130005 | ECLA-13 | 1 | 200×290 |
| 526150110 | ENEM-15 | 1 | 200×290 |
| 526650073 | PABL-65 | 1 | ovaal |
| 526650115 | PROS-65 | 1 | Durchmesser 300 |
| 553150001 | LAMI-15 | 1 | 80×150 |
| 612130016 | GLAM-13 | 2 | 80×150 |
| 612160000 | GLAM-16 | 1 | 80×150 |
| 771250010 | CISC-25 | 1 | 300×400 |

*Actie:* aanvullen in prijslijst 0145.

### C. Matcher koos rol-artikel i.p.v. MAATWERK — 2 regels
| Artikelnr (nu) | Zou moeten zijn | KW-KL | Order |
|----------------|-----------------|-------|-------|
| 1526047 ("EMIR KLEUR 37 240 BREED" — rol) | **526379999** (EMIR37MAATWERK) | EMIR-37 | ORD-2026-1674 r1 |
| 1402002 ("DANT KLEUR 23 400 BREED" — rol) | **402239999** (DANT23MAATWERK) | DANT-23 | ORD-2026-1765 r1 |

*Oorzaak:* de matcher ziet bij deze regels geen afmeting én geen
expliciet "Op maat"/"Wunschgröße"-signaal in variantTitle, en valt daardoor
terug op het "eerste hit op kwaliteit+kleur"-pad dat een rol-artikel
kiest. Deze twee kunnen handmatig worden gecorrigeerd; een structurele
fix vereist dat de matcher het alias-pad altijd naar het MAATWERK-artikel
laat wijzen als `product_type='rol'` of `kwaliteit_code IS NULL` op de hit.

## Nieuwe prijsvulling

Na aanvulling van prijslijst 0145:
```
node scripts/backfill-floorpassion-klantprijs.mjs
```
Script is idempotent — eerder gecorrigeerde regels blijven ongemoeid.
