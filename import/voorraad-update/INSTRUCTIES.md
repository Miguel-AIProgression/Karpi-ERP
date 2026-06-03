# Voorraadlijst importeren — instructies

Deze map beschrijft hoe je een nieuwe **vrije-voorraadlijst van Karpi** importeert,
op exact dezelfde manier als eerder gedaan. Karpi stuurt periodiek een bestand
`Voorraadlijst <datum>.xls` ("Ovz. vrije voorraad — alle artikelen").

Er is één generiek script dat alles doet: [`import/update_voorraad.py`](../update_voorraad.py).
Je hoeft het script **niet** aan te passen — je geeft het bestandspad mee als argument.

---

## Voor Piet-hein — wat je doet

1. Zet het nieuwe Excel-bestand ergens in de projectmap (bijv. naast `CLAUDE.md`),
   bijvoorbeeld `Voorraadlijst 15-6-2026.xls`.
2. Open een Claude Code-chat in de projectmap.
3. Plak dit bericht (pas de bestandsnaam aan):

   > Importeer de nieuwe voorraadlijst `Voorraadlijst 15-6-2026.xls` volgens
   > `import/voorraad-update/INSTRUCTIES.md`. Doe eerst de dry-run en laat me
   > de samenvatting zien, dan geef ik akkoord voor de commit.

4. Controleer de dry-run-samenvatting (zie "Wat moet kloppen" hieronder) en
   geef pas dan akkoord. Daarna schrijft de assistent naar de database.

> **Eenmalig instellen op jouw machine:**
> - Python 3 geïnstalleerd, met packages: `pip install xlrd pandas openpyxl supabase`
>   (getest met `xlrd` 2.0.2 — leest `.xls` met opmaak/fontkleur correct).
> - Het bestand `import/.env` moet bestaan met:
>   ```
>   SUPABASE_URL=...
>   SUPABASE_SERVICE_ROLE_KEY=...
>   ```
>   (de service-role key — die staat NIET in git; vraag deze bij Miguel op.)

---

## Voor de AI-assistent — runbook (stap voor stap)

Volg deze stappen exact. **Schrijf nooit naar de database vóór de gebruiker de
dry-run heeft goedgekeurd.**

1. **Bestand lokaliseren.** Bepaal het volledige pad van de aangeleverde
   `.xls`. Meestal staat het in de projectroot naast `CLAUDE.md`.

2. **Dry-run draaien** (geen `--commit`):
   ```
   cd import
   python update_voorraad.py "..\Voorraadlijst <datum>.xls"
   ```
   Dit schrijft niets naar de DB en niets naar `voorraad_uitsluiten.csv`; het
   genereert wel een rapport in `import/rapporten/`.

3. **Sanity-check de dry-run-output** ("Wat moet kloppen", zie onder). Toon de
   samenvatting aan de gebruiker en vraag om akkoord.

4. **Pas na akkoord: commit:**
   ```
   python update_voorraad.py "..\Voorraadlijst <datum>.xls" --commit
   ```

5. **Verifiëren tegen de DB** met een kleine spot-check: pak een paar
   `product_type='vast'`-artikelen uit de lijst en controleer dat
   `producten.voorraad`/`vrije_voorraad` de waarde uit kolom H heeft en dat
   `backorder`/`gereserveerd` op 0 staan. Controleer ook dat een staaltje/rol
   ongemoeid bleef (andere `product_type`).

6. **Documentatie bijwerken** (verplicht volgens `CLAUDE.md`):
   - `docs/changelog.md` — nieuwe entry met datum, aantallen en bijzonderheden.
   - Memory `project_voorraad_import` — alleen als er iets structureel nieuws
     is geleerd (anders niet).

7. **Niet committen naar git tenzij de gebruiker daar expliciet om vraagt.**

---

## Wat moet kloppen (sanity-check op de dry-run)

- **Scope = alleen `vast`.** Staaltje, rol en overig moeten als "overgeslagen"
  verschijnen en mogen NOOIT geüpdatet worden. (Staaltjes = ander project;
  rol-voorraad loopt per individuele rol via de rollen-sync.)
- **Rode regels = uitsluitlijst, en die GROEIT (union).** Karpi markeert de
  "niet meer inladen"-artikelen progressief alfabetisch per lijst. Het script
  voegt de nieuwe rode regels toe aan de bestaande `voorraad_uitsluiten.csv` —
  het overschrijft die NIET. Controleer dat "uitsluitlijst NA union" ≥ de
  bestaande lijst is. (Wordt een lijst opnieuw gedraaid, dan is "nieuw rood
  toegevoegd" 0 — dat is normaal/idempotent.)
- **Nieuw aanmaken** gebeurt alleen voor échte vaste maten (`^[A-Z]{3,4}\d{2}XX`,
  incl. ronde kleden `…RND`) met vrije voorraad > 0. Broadloom/rol (codes als
  `…400SYN`, `…300ONG`, jute, zónder `XX`-scheiding) worden geteld onder
  "broadloom overgeslagen" — die horen niet als stuks-artikel in de DB.
- **Aantallen plausibel?** Een enorme uitschieter (bijv. "vast niet in lijst →
  0" loopt ineens in de duizenden) is een rode vlag — onderzoek dan eerst.

---

## De vaste regels (afgesproken met Karpi)

| Onderwerp | Regel |
|---|---|
| Scope | Alleen `product_type='vast'`. Staaltje/rol/overig ongemoeid. |
| Sleutel | Kolom A `Artikelnr` → `producten.artikelnr`. |
| Waarde | Kolom H `Vrije voorraad` → `voorraad` + `vrije_voorraad`. Kolom D (bruto) NIET gebruiken. |
| Backorder/gereserveerd | Altijd op 0. |
| Maatwerk | Karpi-code met `MAATWERK` overslaan. |
| Rode regels | Rood font (RGB 255,0,0) = niet inladen → voorraad 0 + toevoegen aan uitsluitlijst (**union**, nooit overschrijven). |
| Vast in DB, niet in lijst | Voorraad → 0. |
| Nieuw in lijst, niet in DB | Alleen vaste maten met vrije voorraad > 0 aanmaken; broadloom skippen. |
| Negatieve voorraad | Clampen naar 0. |
| Onbekende kwaliteit-code | `kwaliteit_code` op NULL (FK-guard), artikel wel aanmaken. |

---

## Bestanden

- Script: [`import/update_voorraad.py`](../update_voorraad.py) (generiek, neemt bestandspad als argument)
- Skip-lijst (groeit per ronde): [`import/voorraad_uitsluiten.csv`](../voorraad_uitsluiten.csv)
- Rapporten per ronde: `import/rapporten/voorraad_update_<bestandsnaam>.xlsx`
- Eerdere gedateerde scripts (referentie): `update_voorraad_2026_05.py`, `update_voorraad_2026_06_01.py`
