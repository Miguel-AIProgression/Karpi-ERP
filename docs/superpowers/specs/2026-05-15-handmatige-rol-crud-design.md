# Ontwerp — Handmatige rol-/reststuk-CRUD op de Rollen & Reststukken-pagina

**Datum:** 2026-05-15
**Status:** Goedgekeurd ontwerp — klaar voor implementatieplan
**Aanpak:** A (Postgres RPC-laag + audit-tabel)

## Probleem & doel

Op de pagina **Rollen & Reststukken** kun je vandaag alleen kijken. Karpi wil rollen en
reststukken **handmatig kunnen toevoegen, bewerken en verwijderen** als
voorraadcorrectie/inventarisatie (telfouten, historische rollen, beginvoorraad, fysiek
verlies/schade). Belangrijkste eis: de mutatie moet **correct doorwerken in de
voorraad** die orders en de allocator gebruiken.

### Kernspanning: twee voorraad-getallen

- **`producten.voorraad`** (INTEGER, m²) — stuurt orders, allocator en `vrije_voorraad`.
  Wordt vandaag handmatig opgehoogd door inkoop-ontvangst-RPC's
  (bv. `boek_inkooporder_ontvangst_rollen`, mig 281; `*_ontvangst`-RPC mig 271),
  **niet** afgeleid uit `rollen`.
- **Som van rol-oppervlak** — wat de Rollen & Reststukken-pagina toont per
  (kwaliteit, kleur), via RPC `voorraadposities` (mig 180).

Bij handmatige rol-mutaties moeten deze niet uit elkaar lopen. **Besluit:**
`producten.voorraad` koppelt mee bij elke handmatige rol-mutatie (oppervlak-delta),
plus `herbereken_product_reservering` na afloop.

## Vastgelegde requirements

| Onderwerp | Beslissing |
|---|---|
| Voorraad-sync | `producten.voorraad` meekoppelen via oppervlak-delta + `herbereken_product_reservering` |
| Use-case toevoegen | Voorraadcorrectie/inventarisatie — losse handmatige toevoeging, **niet** aan een inkooporder gekoppeld |
| Bewerkbare velden | Afmetingen (lengte × breedte), locatie, status |
| FIFO-datum bij toevoegen | `in_magazijn_sinds` invoerbaar; default = vandaag |
| Verwijder-guard | Alleen `status='beschikbaar'` (en los reststuk zonder actieve claim) mag weg; gereserveerd/in_snijplan/verkocht/gesneden geblokkeerd met reden |
| Reden | Verplicht bij elke actie (client én server-side gevalideerd) |
| Audittrail | Nieuwe tabel `rol_mutaties` |

## Architectuur & datalaag (migratie's vanaf mig 290)

Alle handmatige rol-mutaties lopen **uitsluitend** via drie `SECURITY DEFINER` RPC's.
Elke RPC draait in één transactie en doet: validatie → rol-mutatie →
`producten.voorraad`-delta → `herbereken_product_reservering(artikelnr)` →
auditregel in `rol_mutaties`. Faalt een stap, dan rolt de hele mutatie terug.

### Tabel `rol_mutaties` (audittrail)

| Kolom | Type | Toelichting |
|---|---|---|
| id | BIGINT PK | |
| rol_id | BIGINT | NULL toegestaan na verwijderen (rol bestaat niet meer) |
| rolnummer | TEXT | Snapshot |
| artikelnr | TEXT | Snapshot |
| actie | TEXT | `'toevoegen' \| 'bewerken' \| 'verwijderen'` (CHECK) |
| oppervlak_delta_m2 | NUMERIC(10,2) | Effect op `producten.voorraad` (+/−/0) |
| oud_json | JSONB | Relevante rol-velden vóór mutatie (NULL bij toevoegen) |
| nieuw_json | JSONB | Relevante rol-velden na mutatie (NULL bij verwijderen) |
| reden | TEXT NOT NULL | Vrij tekst, verplicht |
| medewerker | TEXT | Doorgegeven vanuit frontend |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### RPC `rol_handmatig_toevoegen`

Signatuur:
`rol_handmatig_toevoegen(p_artikelnr TEXT, p_rol_type rol_type, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_in_magazijn_sinds DATE, p_rolnummer TEXT, p_reden TEXT, p_medewerker TEXT)`

- Validatie: `p_artikelnr` bestaat; `p_locatie_id` bestaat (indien niet NULL);
  `p_reden` niet leeg; `p_lengte_cm`/`p_breedte_cm` > 0; `p_rolnummer` (indien
  opgegeven) nog niet in gebruik.
- Rolnummer: bij leeg → auto `CORR-<artikelnr>-<seq>` (uniek gegarandeerd).
- Insert in `rollen`: `status='beschikbaar'`,
  `oppervlak_m2 = lengte_cm * breedte_cm / 10000`,
  `in_magazijn_sinds = COALESCE(p_in_magazijn_sinds, CURRENT_DATE)`,
  `rol_type` uit input, gedenormaliseerde velden (kwaliteit/kleur/zoeksleutel) uit
  het product afgeleid zoals bestaande insert-paden doen.
- `UPDATE producten SET voorraad = COALESCE(voorraad,0) + oppervlak` (afgerond
  consistent met bestaande conventie).
- `herbereken_product_reservering(p_artikelnr)`.
- Auditregel: actie `'toevoegen'`, `oppervlak_delta_m2 = +oppervlak`, `nieuw_json`.
- Retour: `rol_id`, `rolnummer`.

### RPC `rol_handmatig_bewerken`

Signatuur:
`rol_handmatig_bewerken(p_rol_id BIGINT, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_status TEXT, p_reden TEXT, p_medewerker TEXT)`

- Validatie: rol bestaat; `p_reden` niet leeg; afmetingen > 0; `p_status` mag
  **niet** `gereserveerd` of `in_snijplan` zijn (claims-integriteit) — ook niet als
  doel- of bronstatus die handmatig omzeild wordt; locatie bestaat indien gezet.
- Herbereken `oppervlak_m2`; `delta = nieuw_oppervlak − oud_oppervlak`.
- `UPDATE rollen` (afmetingen, locatie, status).
- `UPDATE producten SET voorraad = voorraad + delta` (skip bij delta 0).
- `herbereken_product_reservering(artikelnr)`.
- Auditregel: actie `'bewerken'`, `oppervlak_delta_m2 = delta`, `oud_json` + `nieuw_json`.

### RPC `rol_verwijderen`

Signatuur: `rol_verwijderen(p_rol_id BIGINT, p_reden TEXT, p_medewerker TEXT)`

- Guard: alleen toegestaan als `status='beschikbaar'`, of een los reststuk
  (`rol_type='reststuk'`) zonder actieve claim/snijplan-koppeling. Anders
  `RAISE EXCEPTION` met Nederlandse reden inclusief huidige status.
- `p_reden` niet leeg.
- Auditregel **eerst** schrijven (snapshot `oud_json`, `rol_id`), dan `DELETE`,
  `UPDATE producten SET voorraad = voorraad - oppervlak`,
  `herbereken_product_reservering(artikelnr)`.

## Frontend & UX

Bestaande pagina: [rollen-overview.tsx](../../frontend/src/pages/rollen/rollen-overview.tsx)
+ [rollen-groep-row.tsx](../../frontend/src/components/rollen/rollen-groep-row.tsx).

- **Toevoegen** — knop "+ Rol toevoegen" in de uitgeklapte groep-header
  (`RollenGroepRow`). Opent `RolToevoegenDialog`, `artikelnr` voorgevuld uit de
  groep. Velden: rol-type (volle rol/reststuk, default volle rol),
  lengte × breedte (cm), locatie (dropdown `magazijn_locaties`),
  `in_magazijn_sinds` (date, default vandaag), rolnummer (optioneel placeholder
  "auto"), reden (verplicht). Live oppervlak-preview (m²).
- **Bewerken** — potlood-icoon per rol-rij in de detailtabel. `RolBewerkenDialog`,
  voorgevuld. Bewerkbaar: afmetingen, locatie, status (status-dropdown bevat
  `gereserveerd`/`in_snijplan` niet). Toont oppervlak-delta vóór opslaan. Reden
  verplicht.
- **Verwijderen** — prullenbak-icoon per rol-rij → `RolVerwijderenDialog`
  (bevestiging + verplicht reden-veld). Icoon disabled met uitleg-tooltip als de
  rol niet verwijderbaar is.

**Patroon:** zoals
[debiteur-edit-dialog.tsx](../../frontend/src/modules/debiteuren/components/debiteur-edit-dialog.tsx)
— `useState`-form + `useMutation` → RPC →
`queryClient.invalidateQueries` op `['voorraadposities']` en `['rollen']`.
Nieuwe query-functies in
[rollen.ts](../../frontend/src/lib/supabase/queries/rollen.ts):
`rolToevoegen`, `rolBewerken`, `rolVerwijderen`. Drie dialogen als losse bestanden
onder `frontend/src/components/rollen/` (≤200 regels elk, conform
bestandsgrootte-regel in CLAUDE.md).

## Foutafhandeling

RPC's geven nette Nederlandse `RAISE EXCEPTION`-meldingen; de frontend toont die
inline in de dialog (niet als generieke toast).

- Verwijderen niet-`beschikbaar`: `"Rol {rolnummer} kan niet verwijderd worden: status is {status}."`
- Dubbel rolnummer: `"Rolnummer {x} bestaat al."`
- Status-wijziging naar `gereserveerd`/`in_snijplan` via bewerken: geweigerd met uitleg.
- Onbekend `artikelnr`/`locatie_id`: expliciete melding.
- Lege reden: server-side geweigerd (niet alleen client-validatie).
- Alles in één transactie: faalt voorraad-delta of `herbereken_product_reservering`,
  dan rollt de volledige mutatie terug (geen halve correctie).

## Tests

SQL-zelftest per RPC (conform bestaande `*_zelftest.sql`-aanpak in de repo):

- `rol_handmatig_toevoegen`: `producten.voorraad` stijgt exact met oppervlak;
  `rol_mutaties`-regel aanwezig met `oppervlak_delta_m2 = +oppervlak`;
  opgegeven `in_magazijn_sinds` correct opgeslagen; auto-rolnummer uniek.
- `rol_handmatig_bewerken`: afmeting-wijziging past `voorraad`-delta correct toe
  (positief én negatief); delta 0 is no-op op `voorraad`; status-wijziging naar
  `gereserveerd`/`in_snijplan` geweigerd; auditregel met `oud_json`+`nieuw_json`.
- `rol_verwijderen`: guard blokkeert gereserveerde/in_snijplan/verkochte rol;
  `beschikbaar` rol wordt verwijderd, `voorraad` daalt met oppervlak, auditregel
  met `oud_json` aanwezig.
- Rollback: geforceerde fout midden in een RPC laat geen halve mutatie achter.
- FIFO-regressie: handmatig toegevoegde rol met opgegeven `in_magazijn_sinds`
  verschijnt op de juiste FIFO-positie in `voorraadposities` (mig 286,
  oudste eerst).
- Edge: reststuk toevoegen met `oorsprong_rol_id` NULL toegestaan (losse correctie).

## Documentatie bij afronding

- `docs/database-schema.md` — tabel `rol_mutaties` + 3 RPC's.
- `docs/data-woordenboek.md` — begrip "voorraadcorrectie (handmatige rol-mutatie)".
- `docs/changelog.md` — datum + wat + waarom.
- `docs/adr/0023-handmatige-rol-crud-koppelt-producten-voorraad-via-rpc.md` —
  beslissing + verworpen alternatieven (B: directe table-writes; C: voorraad
  volledig afleiden via trigger).
- `CLAUDE.md` — bedrijfsregel toevoegen onder "Database kernconcepten":
  handmatige rol-CRUD loopt via RPC-laag en koppelt `producten.voorraad` mee.

## Buiten scope (bewust)

- Voorraad volledig afleiden uit `rollen` via trigger (aanpak C) — eigen traject.
- Bulk-import/CSV van correcties.
- Rolnummer/omschrijving bewerkbaar maken (niet gekozen).
- Koppelen van handmatige toevoeging aan een inkooporder.
