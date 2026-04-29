# Data-woordenboek — RugFlow ERP

Domeinbegrippen die je moet kennen om dit project te begrijpen.

## Klanten & Commercieel

| Term | Betekenis |
|------|-----------|
| **Debiteur** | Klant/afnemer. Geïdentificeerd door `debiteur_nr` (INTEGER). |
| **Afleveradres** | Leveradres van een debiteur. Adres_nr 0 = hoofdadres, 1+ = extra adressen. |
| **Vertegenwoordiger** | Sales representative. In debiteuren opgeslagen als naam, in orders als code. De vertegenwoordigers-tabel koppelt beide. |
| **Betaler** | Debiteur die de factuur betaalt. Kan afwijken van de besteller (self-reference in debiteuren). |
| **Tier** | Klantwaarde-classificatie: Gold (top 10% omzet), Silver (top 30%), Bronze (rest). Berekend via `herbereken_klant_tiers()`. |
| **GLN** | Global Location Number. 13-cijferige code voor bedrijfslocaties (niet voor producten). Staat in debiteuren als `gln_bedrijf`. |
| **GLN afleveradres** | GLN specifiek voor een afleveradres. Gebruikt voor EDI-bestellingen. |
| **GTIN** | Global Trade Item Number. 8/12/13/14-cijferige code voor producten (handelseenheden). EAN-13 valt hieronder. Karpi's GTINs starten met `8715954`. Staat in `producten.ean_code`. Wordt door EDI-partners gebruikt om producten in orderregels te identificeren (`PIA` of `LIN`-segment). |
| **EDI** | Electronic Data Interchange. Gestructureerde digitale berichtuitwisseling tussen bedrijven (orders, orderbevestigingen, facturen, verzendberichten). Bij Karpi via Transus als VAN. |
| **Transus** | EDI-dienstverlener die als full-duplex-vertaler tussen Karpi en handelspartners zit. Karpi spreekt fixed-width "Custom ERP", partners spreken EDIFACT — Transus vertaalt beide kanten op. Productie-endpoint: `https://webconnect.transus.com/exchange.asmx`. |
| **EDIFACT** | UN/EDIFACT — internationale EDI-standaard van de VN. Berichten als `ORDERS`, `ORDRSP`, `INVOIC`, `DESADV`. Karpi's partners (BDSK, Ostermann, XXXLUTZ, Hornbach) gebruiken D96A EANCOM (subset voor retail). Karpi zelf "spreekt" alleen het door Transus vertaalde fixed-width. |
| **Custom ERP (Transus)** | Naam van Karpi's gegevensbron-config in Transus Online (ID 17653, versie 10, type "Fixed length"). Definieert welke velden uit een EDIFACT-bericht naar welke kolompositie in onze `.inh`-output gaan. |
| **M10100 / M10110 / M10300** | De drie SOAP-methodes van de Transus API. M10100 = bericht versturen, M10110 = bericht ontvangen (poll-based, geen webhook), M10300 = ontvangst bevestigen (anders krijg je hetzelfde bericht eindeloos terug). |
| **TransactionID** | Uniek ID per Transus-bericht (zowel inkomend als uitgaand). Bron-van-waarheid voor idempotentie in `edi_berichten.transactie_id`. |
| **MessageReference** | Unieke ID per logisch EDIFACT-bericht (UNH-segment). Een Transus-interchange (UNB...UNZ) kan meerdere UNH's bevatten; Transus splitst die in losse berichten richting Karpi (één TransactionID per UNH). |
| **IsTestMessage** | Vlag op berichtniveau (`Y`/`N`) die aangeeft dat een bericht voor test-doeleinden is. Karpi mag dan geen echte order aanmaken. Per-partner activeerbaar via `edi_handelspartner_config.test_modus`. |
| **NAD-segmenten** | EDIFACT-partij-aanduidingen. `NAD+SU` = Supplier (Karpi), `NAD+BY` = Buyer (winkel/besteller), `NAD+IV` = Invoicee (gefactureerde HQ), `NAD+DP` = Delivery Party (afleveradres), `NAD+SN` = Ship Notify, `NAD+ZZZ` = mutually-defined. Een EDI-order kan tot 4 verschillende GLN's hebben — gemodelleerd op `orders` als `besteller_gln`/`factuuradres_gln`/`afleveradres_gln` + `bes_*`-snapshots. |
| **BGM-codes** | EDIFACT bericht-doel: 220 = Order, 231 = Orderbevestiging, 351 = Despatch Advice (verzendbericht), 380 = Commercial Invoice. |
| **edi_berichten** | Centrale audit-/queue-tabel. Inkomend (`richting='in'`) door `transus-poll` edge function. Uitgaand (`richting='uit'`) door triggers op orders/facturen/zendingen + `transus-send` edge function. Status: `Wachtrij` → `Bezig` → `Verstuurd` / `Verwerkt` / `Fout` / `Geannuleerd`. |
| **edi_handelspartner_config** | Per debiteur welke EDI-berichttypen actief zijn (`order_in`, `orderbev_uit`, `factuur_uit`, `verzend_uit`) + de hoofdschakelaar `transus_actief` en de cutover-modus `test_modus`. Komt overeen met de toggles per partner in Transus Online → Handelspartners → Processen. |
| **Prijslijst** | Per klant een prijslijst (header + regels). Bepaalt welke prijs een klant betaalt per artikel. |
| **Betaalconditie** | Betalingstermijn, bijv. "30 dagen netto". |
| **Inkooporganisatie** | Centrale inkoper waar de klant onder valt. |
| **Standaard levertermijn** | Twee aparte getallen: `standaard_maat_werkdagen` (default 5, kalenderdagen, voor karpetten uit voorraad) en `maatwerk_weken` (default 4, voor gesneden+geconfectioneerde karpetten). Globale defaults in `app_config.order_config`; per klant overschrijfbaar. Order-afleverdatum wordt automatisch berekend als max van beide typen in de order. |
| **Deelleveringen** | Per klant boolean (`debiteuren.deelleveringen_toegestaan`, default FALSE). Als TRUE en een order bevat zowel standaard-maat als maatwerk regels: bij aanmaken wordt de order opgesplitst in 2 losse orders — één met de standaard-regels (korte levertermijn) en één met de maatwerk-regels (lange levertermijn). Verzendkosten-regel gaat mee met de standaard-order. |
| **Verzameldebiteur** | Debiteuren-rij die een groep externe eindklanten vertegenwoordigt. Voor webshop-orders gebruikt RugFlow de bestaande **debiteur 260000 "FLOORPASSION"** — particuliere kopers krijgen geen eigen debiteuren-rij, hun naam/adres landt in de `afl_*`-snapshotvelden op de order. (Synthetische rij 99001 uit migratie 091 is niet in productie: keuze viel op 260000 om aan te sluiten bij het oude systeem.) |
| **Webshop-order** | Order die automatisch is aangemaakt door de Lightspeed webhook-integratie (of via batch-import uit het oude systeem). Herkenbaar aan `orders.bron_systeem = 'lightspeed'`. Valt onder debiteur 260000; de shop van herkomst staat in `bron_shop` (`floorpassion_nl` / `floorpassion_de`). |
| **Bron-systeem** | Veld `orders.bron_systeem` dat aangeeft waar een order vandaan komt. NULL = handmatig in RugFlow aangemaakt. Bekende externe bronnen: `'lightspeed'` (Floorpassion webshops), `'edi'` (Transus-koppeling — fase 2 vult dit). Toekomstig mogelijk: `'marketplace'`. Samen met `bron_order_id` uniek voor idempotentie bij webhook/poll-retries. |
| **Unmatched-regel** | Orderregel waar geen `artikelnr` aan kon worden gekoppeld. Herkenbaar aan een prefix in `omschrijving`: `[UNMATCHED]` (onbekend), `[STAAL]` (gratis muster/sample), `[MAATWERK]` (Wunschgröße / op maat / volgens tekening), `[MAATWERK-ROND]` (ronde maatwerk met diameter). Order krijgt `heeft_unmatched_regels = TRUE`, wat in de orderlijst als actie-vereist-badge zichtbaar moet worden. |
| **`heeft_unmatched_regels`** | Boolean-vlag op `orders`. TRUE zodra minstens 1 regel `artikelnr IS NULL` heeft. Automatisch onderhouden door trigger op `order_regels` (migratie 094) + expliciete set in `create_webshop_order` RPC. Index `orders_heeft_unmatched_idx` voor snel filteren van review-orders. |

## Producten & Voorraad

| Term | Betekenis |
|------|-----------|
| **Artikelnr** | Unieke productcode (TEXT). PK in producten-tabel. |
| **Karpi-code** | Samengestelde code: kwaliteit + kleur + afmetingen. Bijv. `CISC21XX160230`. |
| **Kwaliteit** | Tapijtsoort, gecodeerd in 3-4 letters. Bijv. CISC = Cisco, BEAC = Beach Life, MIRA = Mirage. |
| **Kwaliteitscode** | De 3-4 letter code. Eerste letters uit de karpi_code. |
| **Kleur-code** | Eerste 2 cijfers uit de karpi_code na de kwaliteitscode. |
| **Zoeksleutel** | kwaliteit_code + "_" + kleur_code. Bijv. "CISC_21". Gebruikt voor gecombineerd zoeken. |
| **Collectie** | Canonieke groep van **aliassen voor één fysiek tapijt-type**. Bijv. "Vernissage/Lago" bevat VERI, LAGO, GLOR — fysiek dezelfde partij, andere namen voor verschillende afnemers/markten. 56 groepen, 170 codes. **Bron-van-waarheid voor uitwisselbaarheid; bewerkt via Producten → tab Uitwisselbaar.** |
| **Uitwisselbaar** | Twee `(kwaliteit_code, kleur_code)`-paren zijn uitwisselbaar wanneer (a) beide kwaliteiten dezelfde `collectie_id` hebben **én** (b) de kleur-codes na normalisatie (`normaliseer_kleur_code()`, strip trailing `.0`) gelijk zijn. Resolver: SQL-functie `uitwisselbare_paren(kw, kl)` — alle voorraad-/order-/snijplan-callers gaan hierdoor. Een paar zonder partners ("niet-overeenkomend" in UI) is uitwisselbaar met zichzelf. |
| **Aliassing-lagen** | Drie niveaus van naam-versus-fysieke-identiteit: (1) **collectie** = markt/leverancier-niveau aliassing, één partij onder N namen; (2) **`klanteigen_namen`** = klant-niveau display-naam, per debiteur; (3) **stickering** = bij rol-output krijgt het stuk de naam uit `order_regel.maatwerk_kwaliteit_code`. Voor rollen is uitwisseling kosteloos (sticker komt pas na snijden); voor vaste-maat producten kost het een sticker-wissel ("liever sticker veranderen dan nee-verkopen"). |
| **Rol** | Individuele fysieke tapijtrol in het magazijn. Elke rol heeft een uniek `rolnummer`, specifieke afmetingen en waarde. |
| **Rolnummer** | Unieke identifier per fysieke rol. Legacy: puur numeriek (bv. `109801`), S-prefix (bv. `S0375-1CBON`) of andere formaten uit de oude administratie. **Nieuw (migratie 135)**: rollen die via `boek_ontvangst` aangemaakt worden krijgen automatisch `R-YYYY-NNNN` (bv. `R-2026-0001`) uit sequence `r_2026_seq` via `volgend_nummer('R')` — consistent met `ORD-`/`INK-`/`SNIJ-`-nummering. |
| **VVP** | Verkoopprijs per vierkante meter (Verkoop Vaste Prijs per m2). |
| **Vrije voorraad** | Voorraad minus gereserveerd minus backorder + besteld inkoop. Wat daadwerkelijk beschikbaar is. |
| **Volle rol** | Rol met standaard breedte én volledige lengte. `rol_type = 'volle_rol'`. Standaard breedte komt primair uit `kwaliteiten.standaard_breedte_cm` (bron van waarheid sinds migratie 086), fallback op laatste 3 cijfers artikelnr, daarna 400 cm. |
| **Aangebroken rol** | Rol met standaard breedte maar reeds aangesneden (kortere lengte, ≥100 cm). Ontstaat na `voltooi_snijplan_rol()`. `rol_type = 'aangebroken'`, `status = 'beschikbaar'`. |
| **Reststuk** | Rol met afwijkende (smallere) breedte t.o.v. standaard, óf met lengte <100 cm. `rol_type = 'reststuk'`. Classificatie gebeurt automatisch via trigger o.b.v. `bereken_rol_type()`. |
| **Standaard rolbreedte** | Per kwaliteit vastgelegd in `kwaliteiten.standaard_breedte_cm`. Voorbeelden: 400 cm (default, CISC/GALA/VERR/…), 320 cm (OASI/NOMA/RUBI/CAVA/EMIR/…), 200 cm (DUBE/VETB/CLAS), 147-180 cm (BUX-serie lopers), 160 cm (BEAC/BEAB), 500 cm (CROW). |
| **Artikelnr-codering** | Veel (niet alle) Karpi-artikelnummers volgen: 4 letters (kwaliteit) + 2 cijfers (kleur) + 3 cijfers (breedte in cm). Voorbeeld: `CISC12400` = CISC kwaliteit, kleur 12, breedte 400 cm. Voor kwaliteiten zonder dit suffix (OASI-serie e.d.) geldt uitsluitend `kwaliteiten.standaard_breedte_cm`. |

## Orders & Operationeel

| Term | Betekenis |
|------|-----------|
| **Order** | Klantopdracht. Bevat header (klant, data, adressen) en regels (producten). |
| **Orderregel** | Eén productregel in een order. Bevat artikel, aantal, prijs, korting. |
| **Klant referentie** | Referentie die de klant meegeeft bij een bestelling. Bijv. "BRINK (18)", "#5435/16260113785". |
| **Adres-snapshot** | Kopie van het adres op het moment van de order. Latere adreswijzigingen raken de order niet. |
| **Snijplan** | Instructie om tapijt op maat te snijden uit een rol voor een orderregel. |
| **Confectie** | Nabewerking na het snijden: overzomen, backing, binden. |
| **Confectie-lane** | Werkstation voor één type_bewerking (breedband, smalband, feston, smalfeston, locken, volume afwerking). Meerdere parallelle werkplekken mogelijk per lane. |
| **Confectie-horizon** | Aantal weken vooruit dat de planning toont (1, 2, 4 of 8 — default 4). |
| **Bezetting** | Nodig / beschikbaar × 100%. >100% = overload van de lane in die week. |
| **Zending** | Fysieke levering. Kan producten uit meerdere orderregels bevatten. |
| **Sample/staal** | Monster van een product, verstuurd naar een klant. |
| **Backorder** | Besteld maar niet op voorraad; wacht op levering van leverancier. |
| **Maatwerk** | Orderregel die snijden en/of confectie vereist (is_maatwerk = true). Bevat lengte, breedte, afwerking en instructies. |
| **Productie_groep** | Groeperingssleutel voor snijplanning: kwaliteit + kleur. Alle maatwerk-regels met dezelfde productie_groep kunnen uit dezelfde rol gesneden worden. |
| **Scancode** | Unieke code op barcode/QR-sticker, gekoppeld aan een snijplan of confectie-order. Gegenereerd via `genereer_scancode()`. Wordt gescand op elk werkstation. |
| **Reststuk** | Overgebleven stuk na het snijden van een rol. Wordt automatisch aangemaakt via `maak_reststuk()` met eigen rolnummer, gekoppeld aan oorsprong_rol_id. |
| **Snijvoorstel** | Visuele weergave (SVG) van hoe stukken op een rol geplaatst worden. Gebruikt strip-packing algoritme met positie_x/positie_y. |
| **Strip-packing** | 2D-inpakalgoritme dat stukken zo efficient mogelijk op een rol plaatst. Minimaliseert verspilling. |
| **SnijVolgorde** | Operator-perspectief van een snijplan: pure transformatie van geplaatste rechthoeken naar geordende mes-instructies. Pure functie [`buildSnijVolgorde`](../frontend/src/lib/snij-volgorde/derive.ts). Voedt de rol-uitvoer modal. |
| **Rij** (snijden) | **Eén breedte-mes-instelling** op de guillotine. Pieces met dezelfde breedte-mes-positie consecutive in y-volgorde delen een Rij; verschillende breedtes worden aparte Rijen. Tegen-intuïtief vs. de oude shelf-clustering die alle aangrenzende y-banden in één Rij stopte. |
| **Breedte-mes-overgenomen** | Hint op een Rij-header: de primary breedte-mes-positie matcht die van de vorige Rij — operator hoeft het mes niet te verzetten ("Mes laten staan op 325"). Spaart wisseltijd. |
| **Snij-marge** | Extra cm per dimensie tov. bestelde maat (rond/ovaal +5, ZO +6, max bij combi). Single-source via SQL-functie `stuk_snij_marge_cm()` (migratie 126); via view exposed in `marge_cm` kolom (migratie 143). Voor ronde stukken snijdt de operator eerst een vierkant van bestelde+marge, daarna handmatig rond uit. |
| **KnifeOperation** | Eén individuele snij-handeling binnen een Rij. Bevat `snij_maat` (wat het mes maakt, incl. marge), `bestelde_maat` (klant-orientatie, voor sticker), en `handeling`-enum (`geen | orientatie_swap | rond_uitsnijden | ovaal_uitsnijden | zo_marge_extra`). |
| **Scan_event** | Registratie van een individuele barcode/QR-scan: wie, wanneer, welk station, welke actie. Opgeslagen in `scan_events` tabel. |
| **Voorraad_mutatie** | Logboekregel van een voorraadwijziging op een rol (gesneden, reststuk aangemaakt, correctie, **ontvangst**). Opgeslagen in `voorraad_mutaties` tabel. |

## Inkoop

| Term | Betekenis |
|------|-----------|
| **Leverancier** | Externe partij waar Karpi tapijten/rollen van inkoopt. 30 leveranciers in de Excel-bron. `leverancier_nr` (INTEGER) is het externe nummer uit het oude systeem. |
| **Inkooporder** | Bestelling bij een leverancier. Status: Concept → Besteld → (Deels ontvangen) → Ontvangen (of Geannuleerd). Nummering `INK-YYYY-NNNN` via `volgend_nummer('INK')`. |
| **Oud_inkooporder_nr** | BIGINT uit het oude systeem — op Inkoopoverzicht.xlsx de kolom "Ordernummer". Is uniek en wordt gebruikt voor idempotente import. |
| **Besteld / Geleverd / Te leveren (m)** | Strekkende meters per regel. `te_leveren_m = besteld_m − geleverd_m`. Bij 0 is de regel afgerond. |
| **Leverweek** | Verwachte levering als weeknummer + jaar (`18/2026`). Wordt geparsed naar `verwacht_datum` (maandag van de ISO-week). Dummy-waarden (`01/2049`, `50/2017`) krijgen `verwacht_datum = NULL`. |
| **Ontvangst boeken** | Actie waarbij de operator aangeeft welke fysieke rollen uit een openstaande inkooporder-regel zijn binnengekomen. Maakt N rollen aan in voorraad (status=`beschikbaar`), logt `voorraad_mutaties` (type=`ontvangst`), werkt `geleverd_m`/`te_leveren_m` bij en zet de order-status op Deels ontvangen / Ontvangen. RPC `boek_ontvangst`. |
| **Besteld_inkoop** | Veld `producten.besteld_inkoop` (INTEGER, m²). Automatisch gesynchroniseerd door trigger op inkooporder_regels: som van `te_leveren_m × standaard_breedte_cm / 100` over open regels. **Sinds migratie 149 telt deze waarde NIET MEER mee in `vrije_voorraad`** — toekomstige inkoop is wel zichtbaar (badge "+ N besteld") maar `vrije_voorraad` reflecteert puur "vandaag-leverbaar". Inkoop-koppeling aan klantorders gaat via `order_reserveringen`, niet meer via `+ besteld_inkoop`. |

## Reserveringen & Levertijd

| Term | Betekenis |
|------|-----------|
| **Claim** | Een actieve rij in `order_reserveringen` die een orderregel hard koppelt aan ofwel voorraad (`bron='voorraad'`) ofwel een openstaande inkooporder-regel (`bron='inkooporder_regel'`). Eén orderregel kan meerdere claims hebben (1 voorraad + N IO-regels). Levenscyclus: `actief` → `geleverd` (bij ontvangst-boeking) of `released` (bij heralloceren / annulering). Bron-van-waarheid voor `producten.gereserveerd` sinds migratie 144. |
| **Bron-van-claim** | Kolom `order_reserveringen.bron`: `voorraad` (directe claim op fysieke voorraad) of `inkooporder_regel` (claim op openstaande inkoop). Bij ontvangst van een IO consumeert `boek_voorraad_ontvangst` IO-claims in `claim_volgorde`-volgorde en verschuift ze naar voorraad-claims op dezelfde orderregel. |
| **Lever_modus** | Per-order veld `orders.lever_modus` (`deelleveringen` / `in_een_keer` / NULL). Bepaalt bij tekort hoe te leveren: deelleveringen → meerdere zendingen, eerste claim-leverweek wint; in_een_keer → één zending op de laatste claim-leverweek. Default uit `debiteuren.deelleveringen_toegestaan`, gevuld via `LeverModusDialog` bij opslaan als ≥1 regel tekort heeft. NULL voor orders zonder tekort. Migratie 144. |
| **Verwachte leverweek** | Per orderregel berekende ISO-weekstring (`YYYY-Www`) wanneer de regel volledig leverbaar is. View `order_regel_levertijd` rekent: voorraad-only → `'voorraad'`; deels/volledig op IO → `iso_week_plus(verwacht_datum, buffer)` met buffer uit `app_config.order_config.inkoop_buffer_weken_vast` (default 1). Maatwerk → 2 weken buffer. Bij `lever_modus='in_een_keer'`: max-week wint; bij `'deelleveringen'`: eerste week. NULL bij `wacht_op_nieuwe_inkoop`. Migratie 150. |
| **IO-regel-ruimte** | Resterende claim-capaciteit op een inkooporder-regel: `FLOOR(te_leveren_m) − SUM(actieve claims)`. Alleen relevant voor `eenheid='stuks'` (V1-scope). Bron-functie: `io_regel_ruimte(p_io_regel_id)` (mig 145). Zichtbaar in view `inkooporder_regel_claim_zicht`. |
| **Claim-volgorde-prio** | FIFO: wie eerst claimt op een IO-regel, wordt eerst beleverd bij ontvangst. Geen automatische herallocatie als een nieuwere order met urgenter afleverdatum binnenkomt. Spoed-overrides staan in V2-backlog. |
| **Wacht op inkoop / Wacht op nieuwe inkoop** | Order-status `Wacht op inkoop` (mig 144): order heeft ≥1 actieve `bron='inkooporder_regel'`-claim. "Wacht op nieuwe inkoop" is geen status maar een view-derived label voor regels met `aantal_tekort > 0` — order blijft in `Wacht op inkoop` of `Wacht op voorraad` totdat een nieuwe IO de allocator opnieuw triggert via orderregel-bewerking. |

## Systeem

| Term | Betekenis |
|------|-----------|
| **Nummering** | Automatische doorlopende nummers per type per jaar. Format: TYPE-JAAR-VOLGNR (bijv. ORD-2026-0001). |
| **RLS** | Row Level Security. Supabase/PostgreSQL feature die toegang per rij regelt. |
| **Activiteiten_log** | Audit trail: wie heeft wat wanneer gewijzigd. Wijzigingen als JSONB. |
