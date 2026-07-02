# Werkwijze Inkoop — bestellen, verwachten, ontvangen, wijzigen

_Voor operators. Laatste update: 2026-07 (plan inkoopproces-volledig)._

## 1. Bestellen (inkooporder aanmaken)

- **Waar:** `/inkoop` → knop "Nieuwe inkooporder".
- Kies leverancier, vul per regel artikelnr óf karpi-code, **eenheid** en aantal:
  - **m² (rol)** — broadloom/rollen, geleverd als fysieke rollen.
  - **stuks (vast)** — vaste maten en antislip. ⚠ **Antislip altijd op het
    stuks-artikel bestellen, nooit op het doos-artikel** — anders ziet het
    systeem de bestelling niet als dekking voor klantorders (koppeltabel mig 408).
- Opslaan is alles-of-niets: bij een foutmelding is er géén halve order aangemaakt.
- Direct na opslaan kan het systeem wachtende klantorders automatisch aan de
  nieuwe regels koppelen (claim-swap) — dat is de bedoeling.

## 2. Verwachten (wanneer komt het?)

- **Hét scherm van de inkoper:** `/inkoop` → tab **Regeloverzicht**. Per open
  regel: ETA (inline aanpasbaar), wie de ETA het laatst bijwerkte
  (blauw = leverancier via de portal, grijs = Karpi) en wanneer, plus de
  leverancier-notitie.
- **Rood** = ETA verstreken; **"⚠ blokkeert snijplanning"** = er wachten
  maatwerk-snijplannen op deze levering — eerst bellen/mailen.
- Een ETA-wijziging (door jou óf de leverancier) schuift automatisch de
  afleverdatum van gekoppelde klantorders mee. Verschuift de leverWEEK, dan
  verschijnt de order in de tab "Levertijd gewijzigd" op het orderoverzicht —
  informeer de klant en vink af ("herbevestigd").

## 3. Leveranciersportal (portal.karpi.nl)

- Leveranciers werken zelf hun ETA's + notities bij. Schrijfrechten zijn
  bewust beperkt tot ETA + notitie — aantallen/prijzen wijzigt alleen Karpi.
- Meldt een leverancier via de notitie "we kunnen maar 40m leveren"? Verwerk
  dat zelf via Regel bewerken/annuleren (zie §5).
- **Nieuwe leverancier aansluiten** (nu nog niet actief uitrollen — besluit 02-07):
  1. Leverancier-detailpagina → sectie "Portal toegang" → e-mail + wachtwoord instellen.
  2. Mail de link https://portal.karpi.nl + inloggegevens (Engels; de portal is Engelstalig).
  3. Controleer na een week of er ingelogd is; zo niet: bellen.
- Leveranciers zonder portal: jij voert de ETA zelf in op het Regeloverzicht.

## 4. Ontvangen (binnenboeken → voorraad)

- **Waar:** inkooporder-detail → knop "Ontvangst" per regel, bij fysieke binnenkomst.
- **Rollen (m²):** vul per fysieke rol lengte (m) en zo nodig breedte in, plus
  de **magazijnlocatie** (bv. `A.01.L`) waar de rol komt te liggen. Na boeken:
  **stickers printen en direct op de rollen plakken.**
  - ⚠ **Regel zonder gekoppeld artikelnr (alleen karpi-code)?** Rol-ontvangst
    weigert dan met "Koppel eerst een artikel" — een rol vereist altijd een
    artikelnr. Voeg een regel met het juiste artikel toe (Regel toevoegen) en
    verwijder/annuleer de karpi-code-regel, of laat het artikel eerst aanmaken.
- **Stuks:** vul het ontvangen aantal in. Wachtende klantorders worden
  automatisch beleverd (claims → voorraad) en klappen om naar leverbaar.
- **Afwijkingen:**
  - _Minder geleverd, rest komt later_ → boek wat er is; de regel blijft open
    ("Deels ontvangen").
  - _Minder geleverd, rest komt nóóit_ → boek wat er is, daarna **Regel
    annuleren** (§5).
  - _Meer geleverd_ → gewoon boeken. Boven de 110% van het bestelde vraagt het
    systeem een expliciete bevestiging (tikfout-vangnet).
  - _Verkeerde kwaliteit/kleur geleverd_ → NIET op deze regel boeken. Gebruik
    "Rol handmatig toevoegen" op de Rollen & Reststukken-pagina (met reden,
    audit) en annuleer/verlaag de inkoopregel na afstemming met de leverancier.

## 5. Wijzigen van een bestaande inkooporder

Op inkooporder-detail, per regel (potlood/verbod/prullenbak-icoontjes):

| Situatie | Actie |
|---|---|
| Extra artikel bijbestellen bij dezelfde order | **Regel toevoegen** |
| Prijs correctie | **Regel bewerken** → prijs |
| Leverancier levert minder dan besteld | **Regel bewerken** → aantal verlagen, of **Regel annuleren** ("rest komt niet meer") |
| Regel was een vergissing (nog niets ontvangen) | **Regel verwijderen** |
| Hele order vervalt | Order **Annuleren** (bestaande knop) |

**De Claim-vloer:** zodra klantorders of snijplanning op een inkoopregel
rekenen, weigert verlagen/verwijderen eerst — met een melding wat erop rust.
Vink je "Beloftes vrijgeven en doorgaan" aan, dan vallen de getroffen
klantorders zichtbaar terug naar **"Wacht op inkoop"** (nooit stil). Draai
daarna voor maatwerk-groepen zo nodig "Auto-plan opnieuw" op de
Snijplanning-pagina, en bestel het tekort opnieuw in.
