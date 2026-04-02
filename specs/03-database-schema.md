# Spec: Database Schema (Supabase/PostgreSQL)

## Wat dit oplost

De complete backend-database voor het RugFlow ERP systeem. Alle tabellen, relaties, constraints en views die nodig zijn om debiteuren, producten, rollen, orders en operationele processen te beheren.

## Bronnen

- Planbestand: `docs/2026-04-01-rugflow-erp-database-en-frontend.md` (Tasks 1-10)
- Data-validatie: geen wees-records in de brondata (100% FK overlap geverifieerd)
- Brondata: Excel exports in `brondata/`

## Tabellen overzicht

### Infrastructuur
| Tabel | Doel |
|-------|------|
| `nummering` | Doorlopende nummers per type per jaar (ORD-2026-0001, etc.) |

### Referentiedata
| Tabel | Doel | PK |
|-------|------|----|
| `vertegenwoordigers` | Sales reps: code ↔ naam mapping | id (code = UK) |
| `collecties` | Groepen uitwisselbare kwaliteiten (56 groepen) | id (groep_code = UK) |
| `kwaliteiten` | Alle 997 kwaliteitscodes (3-4 letters) | code (TEXT) |
| `magazijn_locaties` | Fysieke locaties in het magazijn | id (code = UK) |

### Klantdata
| Tabel | Doel | PK | Belangrijkste FK |
|-------|------|----|------------------|
| `debiteuren` | Klanten/afnemers | debiteur_nr (INTEGER) | vertegenw_code, prijslijst_nr, betaler (self-ref) |
| `afleveradressen` | Afleveradressen per debiteur (1:N) | id | debiteur_nr |
| `prijslijst_headers` | Metadata per prijslijst | nr (TEXT) | — |
| `prijslijst_regels` | Artikelprijzen per prijslijst | id | prijslijst_nr, artikelnr |
| `klanteigen_namen` | Eigen kwaliteitsnamen per klant | id | debiteur_nr, kwaliteit_code |
| `klant_artikelnummers` | Eigen artikelnummers per klant | id | debiteur_nr, artikelnr |

### Producten & Voorraad
| Tabel | Doel | PK | Belangrijkste FK |
|-------|------|----|------------------|
| `producten` | Artikelen uit het oude systeem | artikelnr (TEXT) | kwaliteit_code |
| `rollen` | Individuele fysieke tapijtrol | id (rolnummer = UK) | artikelnr, kwaliteit_code, locatie_id |

### Orders & Facturatie
| Tabel | Doel | PK | Belangrijkste FK |
|-------|------|----|------------------|
| `orders` | Orderheaders | id (order_nr = UK) | debiteur_nr, vertegenw_code, betaler |
| `order_regels` | Orderregels (producten per order) | id | order_id, artikelnr |
| `facturen` | Factuurheaders | id (factuur_nr = UK) | order_id, debiteur_nr |
| `factuur_regels` | Factuurregels | id | factuur_id, order_regel_id |

### Operationeel
| Tabel | Doel | PK | Belangrijkste FK |
|-------|------|----|------------------|
| `zendingen` | Fysieke leveringen | id (zending_nr = UK) | order_id |
| `zending_regels` | Producten/rollen per zending | id | zending_id, order_regel_id, rol_id |
| `snijplannen` | Tapijt op maat snijden uit rollen | id (snijplan_nr = UK) | order_regel_id, rol_id |
| `confectie_orders` | Nabewerking (overzomen, backing) | id (confectie_nr = UK) | order_regel_id, snijplan_id, rol_id |
| `samples` | Stalen/monsters | id (sample_nr = UK) | debiteur_nr, artikelnr |

### Inkoop
| Tabel | Doel | PK | Belangrijkste FK |
|-------|------|----|------------------|
| `leveranciers` | Leveranciersbeheer | id | — |
| `inkooporders` | Inkooporderheaders | id (inkooporder_nr = UK) | leverancier_id |
| `inkooporder_regels` | Inkooporderregels | id | inkooporder_id, artikelnr |

### Audit
| Tabel | Doel |
|-------|------|
| `activiteiten_log` | Audit trail: wie, wat, wanneer, welke wijzigingen (JSONB) |

## Enums

- `order_status`: Nieuw → Actie vereist → Wacht op picken → Wacht op voorraad → In snijplan → In productie → Deels gereed → Klaar voor verzending → Verzonden → Geannuleerd
- `zending_status`: Gepland → Picken → Ingepakt → Klaar voor verzending → Onderweg → Afgeleverd
- `factuur_status`: Concept → Verstuurd → Betaald → Herinnering → Aanmaning → Gecrediteerd
- `snijplan_status`: Gepland → In productie → Gereed → Geannuleerd
- `inkooporder_status`: Concept → Besteld → Deels ontvangen → Ontvangen → Geannuleerd
- `confectie_status`: Wacht op materiaal → In productie → Kwaliteitscontrole → Gereed → Geannuleerd

## Views

| View | Doel |
|------|------|
| `dashboard_stats` | Aggregaties voor dashboard: producten, rollen, waarde, marge, open orders |
| `klant_omzet_ytd` | Per klant: omzet YTD, % van totaal, gemiddelde per maand, tier |
| `rollen_overzicht` | Per kwaliteit/kleur: aantal rollen, oppervlak, waarde |
| `recente_orders` | Laatste 50 orders met klantnaam |
| `orders_status_telling` | Aantal orders per status |

## Functies

| Functie | Doel |
|---------|------|
| `update_updated_at()` | Trigger: auto-update updated_at kolom |
| `volgend_nummer(type)` | Genereert doorlopend nummer (ORD-2026-0001) |
| `uitwisselbare_kwaliteiten(code)` | Geeft alle kwaliteiten in dezelfde collectie |
| `herbereken_klant_tiers()` | Gold/Silver/Bronze op basis van omzet (top 10%/30%/rest) |
| `update_order_totalen()` | Trigger: herbereken order totalen bij wijziging regels |

## Security

- RLS enabled op alle tabellen
- Fase 1: authenticated users = volledige toegang
- Fase 2 (later): rollen per gebruiker (admin, verkoop, magazijn)
- Supabase Storage bucket `logos` voor klantlogo's (publiek leesbaar, auth upload/delete)

## Acceptatiecriteria

1. Alle 26 tabellen bestaan in Supabase met correcte kolommen en constraints
2. Alle foreign keys zijn actief en gevalideerd (geen wees-records mogelijk)
3. Alle enums zijn aangemaakt met de juiste waarden
4. Alle 5 views retourneren correcte data
5. Alle 5 functies werken correct (inclusief nummering en triggers)
6. RLS is enabled op alle tabellen
7. Storage bucket `logos` is aangemaakt
8. De volledige order→snijplan→confectie→zending keten werkt
9. `docs/database-schema.md` is bijgewerkt met de actuele staat

## Migratie-volgorde

Strikt volgens FK dependencies:
1. `001_basis.sql` — functies, enums, nummering
2. `002_referentiedata.sql` — vertegenwoordigers, collecties, kwaliteiten, magazijn
3. `003_debiteuren.sql` — debiteuren, afleveradressen
4. `004_producten.sql` — producten, rollen
5. `005_klantdata.sql` — prijslijsten, klanteigen namen, klant artikelnummers
6. `006_orders.sql` — orders, order regels + auto-totalen trigger
7. `007_operationeel.sql` — zendingen, facturen, snijplannen, confectie, samples
8. `008_inkoop.sql` — leveranciers, inkooporders
9. `009_views.sql` — views, audit log, tier-berekening
10. `010_rls_storage.sql` — RLS policies, storage bucket

## Dependencies

- Spec 01 (mappenstructuur) — `supabase/migrations/` directory
- Spec 02 (documentatie) — `docs/database-schema.md` moet bijgewerkt worden
