# Ontwerp — Handmatige rol-/reststuk-CRUD op de Rollen & Reststukken-pagina

**Datum:** 2026-05-15
**Status:** Geïmplementeerd 2026-05-15 (mig 290-293)
**Aanpak:** A (Postgres RPC-laag + audit-tabel)

> **Implementatie-noot:** ADR-nummer 0023 bleek bij uitvoering al bezet
> (order-annulering); de daadwerkelijke ADR is **0024**
> (`docs/adr/0024-handmatige-rol-crud-rpc-laag.md`). Verwijzingen naar
> "ADR-0023" hieronder lezen als 0024. Migratie 290 deelt het nummer met
> `290_order_annulering_release_snijplannen.sql` — beide moeten toegepast
> worden (zelfde dubbel-nummer-conventie als mig 289 in deze repo).

> **Herziening 2026-05-15:** de oorspronkelijke aanname dat `producten.voorraad`
> meegekoppeld moest worden bleek onjuist voor rol-artikelen (zie "Voorraad-model"
> hieronder). De voorraad-koppeling is geschrapt; de pagina is live-correct via
> `SUM(rollen)`.

## Probleem & doel

Op de pagina **Rollen & Reststukken** kun je vandaag alleen kijken. Karpi wil
rollen en reststukken **handmatig kunnen toevoegen, bewerken en verwijderen** als
voorraadcorrectie/inventarisatie (telfouten, historische rollen, beginvoorraad,
fysiek verlies/schade). De mutatie moet **correct doorwerken in de getoonde
voorraad** en de operationele integriteit (snijplannen/reserveringen, FIFO) niet
breken.

## Voorraad-model (geverifieerd in de code)

- De **Rollen & Reststukken-pagina** haalt de m²-totalen **live uit
  `SUM(rollen.oppervlak_m2)`** via de `voorraadposities`-RPC (mig 179/180).
  `producten.voorraad` komt er niet aan te pas.
- De order-allocator / `order_reserveringen` (voorraad-claims) is **alleen voor
  `eenheid='stuks'`** (vaste maten) en sluit maatwerk + rol-producten expliciet
  uit (mig 145). `herbereken_product_reservering` levert voor een rol-artikel 0 op.
- **Geen RPC/trigger** onderhoudt `producten.voorraad` vanuit rollen voor
  rol-artikelen (niet inkoop-ontvangst mig 281, niet `voltooi_snijplan_rol`
  mig 251). Voor rol-producten is `producten.voorraad` statische legacy-data die
  voor rollen nergens live gelezen wordt.

**Besluit:** géén `producten.voorraad`-mutatie en géén
`herbereken_product_reservering` bij handmatige rol-CRUD. De pagina is
automatisch correct doordat ze `SUM(rollen)` live optelt. "Goed gaan met de
voorraad" betekent hier: live-correcte pagina-totalen (gratis), correcte
`rol_type` (bestaande `bereken_rol_type`-trigger), correcte `in_magazijn_sinds`
(FIFO), en guards die snijplan-/reservering-integriteit beschermen.

## Vastgelegde requirements

| Onderwerp | Beslissing |
|---|---|
| Voorraad-koppeling | **Geen** `producten.voorraad`-mutatie; pagina is live-correct via `SUM(rollen)` |
| Use-case toevoegen | Voorraadcorrectie/inventarisatie — losse handmatige toevoeging, **niet** aan een inkooporder gekoppeld |
| Bewerkbare velden | Afmetingen (lengte × breedte), locatie, status |
| FIFO-datum bij toevoegen | `in_magazijn_sinds` invoerbaar; default = vandaag |
| Verwijder-guard | Alleen `status='beschikbaar'`, of los reststuk (`rol_type='reststuk'`) zonder snijplan-koppeling; gereserveerd/in_snijplan/verkocht/gesneden geblokkeerd met reden |
| Reden | Verplicht bij elke actie (client én server-side gevalideerd) |
| Audittrail | Nieuwe tabel `rol_mutaties` |

## Architectuur & datalaag (migratie's vanaf mig 290)

Alle handmatige rol-mutaties lopen **uitsluitend** via drie `SECURITY DEFINER`
RPC's. Elke RPC draait in één transactie: validatie → rol-mutatie →
auditregel in `rol_mutaties`. Faalt een stap, dan rolt de hele mutatie terug.

### Tabel `rol_mutaties` (audittrail)

**Waarom een aparte tabel en niet het bestaande `voorraad_mutaties`?**
`voorraad_mutaties.rol_id` is `NOT NULL` met FK naar `rollen` (mig 148 noteert
dit expliciet als beperking) en de tabel heeft geen `reden`-kolom (eerdere
`reden`/`medewerker`-kolommen waren "verzonnen" en zijn verwijderd, zie
database-schema.md ⚠️-noot). Een handmatige correctie vereist een **verplichte
reden** én een audit-regel die een **verwijderde** rol overleeft. `voorraad_mutaties`
kan beide structureel niet. Daarom een dedicated tabel; `voorraad_mutaties`
blijft ongemoeid.

| Kolom | Type | Toelichting |
|---|---|---|
| id | BIGINT GENERATED ALWAYS AS IDENTITY PK | |
| rol_id | BIGINT | NULL toegestaan (rol kan verwijderd zijn); geen FK |
| rolnummer | TEXT | Snapshot |
| artikelnr | TEXT | Snapshot |
| actie | TEXT NOT NULL CHECK (actie IN ('toevoegen','bewerken','verwijderen')) | |
| oppervlak_delta_m2 | NUMERIC(10,2) | Effect op de getoonde m²-som (+/−/0) — informatief |
| oud_json | JSONB | Relevante rol-velden vóór mutatie (NULL bij toevoegen) |
| nieuw_json | JSONB | Relevante rol-velden na mutatie (NULL bij verwijderen) |
| reden | TEXT NOT NULL | Vrij tekst, verplicht |
| medewerker | TEXT | Doorgegeven vanuit frontend |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### RPC `rol_handmatig_toevoegen`

Signatuur:
`rol_handmatig_toevoegen(p_artikelnr TEXT, p_rol_type rol_type, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_in_magazijn_sinds DATE, p_rolnummer TEXT, p_reden TEXT, p_medewerker TEXT) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT)`

- Validatie: `p_artikelnr` bestaat; `p_locatie_id` bestaat indien niet NULL;
  `TRIM(p_reden)` niet leeg; `p_lengte_cm`/`p_breedte_cm` > 0; `p_rolnummer`
  (indien opgegeven) nog niet in gebruik.
- Rolnummer: bij leeg → auto `CORR-<artikelnr>-<n>` via uniciteitslus.
- Insert in `rollen`: `status='beschikbaar'`,
  `oppervlak_m2 = ROUND(lengte_cm*breedte_cm/10000.0, 2)`,
  `in_magazijn_sinds = COALESCE(p_in_magazijn_sinds, CURRENT_DATE)`,
  `rol_type` uit input, gedenormaliseerde velden (karpi_code, omschrijving,
  vvp_m2=verkoopprijs, kwaliteit_code, kleur_code, zoeksleutel) uit het product
  (zelfde bron als mig 281). `bereken_rol_type`-trigger mag `rol_type`
  herklassificeren — dat is correct gedrag.
- Auditregel: actie `'toevoegen'`, `oppervlak_delta_m2 = +oppervlak`, `nieuw_json`.
- Retour: `rol_id`, `rolnummer`.

### RPC `rol_handmatig_bewerken`

Signatuur:
`rol_handmatig_bewerken(p_rol_id BIGINT, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_status TEXT, p_reden TEXT, p_medewerker TEXT) RETURNS VOID`

- Validatie: rol bestaat (`FOR UPDATE`); `TRIM(p_reden)` niet leeg; afmetingen > 0;
  `p_status` mag **niet** `gereserveerd` of `in_snijplan` zijn; de **huidige**
  status mag ook niet `gereserveerd`/`in_snijplan`/`verkocht`/`gesneden` zijn
  (zo'n rol hangt aan een snijplan/claim — afmeting wijzigen breekt integriteit);
  locatie bestaat indien gezet.
- Herbereken `oppervlak_m2`; `delta = nieuw_oppervlak − oud_oppervlak`.
- `UPDATE rollen` (lengte, breedte, oppervlak, locatie_id, status).
- Auditregel: actie `'bewerken'`, `oppervlak_delta_m2 = delta`,
  `oud_json` + `nieuw_json`.

### RPC `rol_verwijderen`

Signatuur:
`rol_verwijderen(p_rol_id BIGINT, p_reden TEXT, p_medewerker TEXT) RETURNS VOID`

- Validatie: rol bestaat (`FOR UPDATE`); `TRIM(p_reden)` niet leeg.
- Guard: toegestaan als `status='beschikbaar'`, **of** (`rol_type='reststuk'`
  én `status NOT IN ('gereserveerd','in_snijplan','verkocht','gesneden')`).
  Bovendien geweigerd als er een `snijplannen`-rij met `rol_id = p_rol_id`
  bestaat. Anders `RAISE EXCEPTION` met Nederlandse reden + huidige status.
- Auditregel **eerst** schrijven (snapshot `oud_json`, `rol_id`,
  `oppervlak_delta_m2 = -oppervlak`), dan `DELETE FROM rollen WHERE id=p_rol_id`.
  Eventuele `voorraad_mutaties`-rijen van deze rol worden niet verwijderd; als
  een FK-restrictie de DELETE blokkeert, geeft de RPC een nette melding terug
  ("rol heeft historische voorraad-mutaties en kan niet hard verwijderd worden").

## Frontend & UX

Bestaande pagina: [rollen-overview.tsx](../../frontend/src/pages/rollen/rollen-overview.tsx)
+ [rollen-groep-row.tsx](../../frontend/src/components/rollen/rollen-groep-row.tsx).

- **Toevoegen** — knop "+ Rol toevoegen" in de uitgeklapte groep-header
  (`RollenGroepRow`). Opent `RolToevoegenDialog`, `artikelnr` voorgevuld uit de
  groep (`positie.rollen[0].artikelnr`; bij lege groep niet beschikbaar — knop
  alleen tonen als de groep rollen heeft). Velden: rol-type (volle rol/reststuk,
  default volle rol), lengte × breedte (cm), locatie (dropdown
  `magazijn_locaties` waar `actief=true`), `in_magazijn_sinds` (date, default
  vandaag), rolnummer (optioneel, placeholder "auto"), reden (verplicht). Live
  oppervlak-preview (m²).
- **Bewerken** — potlood-icoon per rol-rij in de detailtabel. `RolBewerkenDialog`,
  voorgevuld. Bewerkbaar: afmetingen, locatie, status (status-dropdown bevat
  `gereserveerd`/`in_snijplan` niet). Toont oppervlak-delta vóór opslaan. Reden
  verplicht. Disabled met uitleg als de rol een niet-bewerkbare status heeft.
- **Verwijderen** — prullenbak-icoon per rol-rij → `RolVerwijderenDialog`
  (bevestiging + verplicht reden-veld). Icoon disabled met uitleg-tooltip als de
  rol niet verwijderbaar is (status of snijplan-koppeling).

**Patroon:** zoals
[debiteur-edit-dialog.tsx](../../frontend/src/modules/debiteuren/components/debiteur-edit-dialog.tsx)
— `useState`-form + `useMutation` → RPC →
`queryClient.invalidateQueries({ queryKey: ['voorraadposities'] })`.
Nieuwe query-functies in
[rollen.ts](../../frontend/src/lib/supabase/queries/rollen.ts):
`rolToevoegen`, `rolBewerken`, `rolVerwijderen`. Drie dialogen als losse
bestanden onder `frontend/src/components/rollen/` (≤200 regels elk, conform
bestandsgrootte-regel in CLAUDE.md).

## Foutafhandeling

RPC's geven nette Nederlandse `RAISE EXCEPTION`-meldingen; de frontend toont die
inline in de dialog (niet als generieke toast).

- Verwijderen niet-verwijderbare rol:
  `"Rol {rolnummer} kan niet verwijderd worden: status is {status}."`
  of `"... zit in een snijplan."`
- Dubbel rolnummer: `"Rolnummer {x} bestaat al."`
- Status-/afmeting-wijziging op gereserveerd/in_snijplan/verkocht/gesneden rol:
  geweigerd met uitleg.
- Onbekend `artikelnr`/`locatie_id`: expliciete melding.
- Lege reden: server-side geweigerd (niet alleen client-validatie).
- Alles in één transactie: faalt een stap, dan rollt de volledige mutatie terug.

## Tests

SQL-zelftest in `scripts/test-rol-crud.sql` (conform
`scripts/test-match-klant-po.sql`-patroon: `BEGIN; … DO $$ … ASSERT … $$; ROLLBACK;`).

- `rol_handmatig_toevoegen`: rol aangemaakt met juiste oppervlak en opgegeven
  `in_magazijn_sinds`; auto-rolnummer (`CORR-…`) uniek; `rol_mutaties`-regel met
  actie `'toevoegen'` en `oppervlak_delta_m2 = +oppervlak`.
- `rol_handmatig_bewerken`: afmeting-wijziging zet `oppervlak_m2` correct;
  `rol_mutaties` heeft `oud_json`+`nieuw_json` en juiste delta (positief én
  negatief); status-wijziging naar `gereserveerd`/`in_snijplan` geweigerd;
  bewerken van een `gereserveerd`-rol geweigerd.
- `rol_verwijderen`: guard blokkeert `gereserveerd`/`in_snijplan` rol en rol met
  `snijplannen`-koppeling; `beschikbaar` rol wordt verwijderd; los reststuk
  zonder snijplan wordt verwijderd; `rol_mutaties`-regel met `oud_json` aanwezig
  ná verwijderen (rol_id behouden als getal, geen FK).
- Rollback: geforceerde fout midden in een RPC laat geen halve mutatie achter.
- FIFO-regressie: handmatig toegevoegde rol met opgegeven `in_magazijn_sinds`
  verschijnt op de juiste FIFO-positie in `voorraadposities` (mig 286, oudste
  eerst) en de pagina-m²-som stijgt exact met het rol-oppervlak.

## Documentatie bij afronding

- `docs/database-schema.md` — tabel `rol_mutaties` + 3 RPC's in de functie-tabel.
- `docs/data-woordenboek.md` — begrip "voorraadcorrectie (handmatige rol-mutatie)".
- `docs/changelog.md` — datum + wat + waarom (incl. de herziene voorraad-aanname).
- `docs/adr/0023-handmatige-rol-crud-rpc-laag.md` — beslissing + de geverifieerde
  reden waaróm `producten.voorraad` niet gekoppeld wordt + verworpen alternatieven
  (B: directe table-writes; C: voorraad volledig afleiden via trigger).
- `CLAUDE.md` — bedrijfsregel onder "Database kernconcepten": handmatige rol-CRUD
  loopt via RPC-laag, géén `producten.voorraad`-koppeling (pagina live via
  `SUM(rollen)`), met delete-guards en `rol_mutaties`-audittrail.

## Buiten scope (bewust)

- Voorraad volledig afleiden uit `rollen` via trigger (aanpak C) — eigen traject.
- Losse "herbereken `producten.voorraad` uit `SUM(rollen)`"-correctie-RPC.
- Bulk-import/CSV van correcties.
- Rolnummer/omschrijving bewerkbaar maken (niet gekozen).
- Koppelen van handmatige toevoeging aan een inkooporder.
