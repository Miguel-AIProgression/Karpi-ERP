# Verzoek aan Transus — afleveradres opnemen in "Custom ERP"-orderformat

**Doel:** voorkomen dat inkomende EDI-orders het juiste vestiging-/afleveradres missen.

## Probleem
Het door Transus gegenereerde fixed-width "Custom ERP"-orderbestand (gegevensbron
ID 17653, versie 10) bevat in de header **alleen GLN's** voor besteller (NAD+BY),
afleveradres (NAD+DP) en gefactureerde (NAD+IV) — géén adrestekst. De onderliggende
EDIFACT D96A ORDERS van de partner draagt die adressen wél, bv.:

```
NAD+DP+4040051000020::9++Lager Porta Moebel Barkhausen+Feldstrasse 20+Porta Westfalica++32457+DE
```

In ons ERP moeten we de aflever-GLN tegen een vooraf bekende adressenlijst matchen.
Voor centrale-facturatie-ketens (BDSK/XXXLutz, SB Möbel Boss, FuG/Porta) wisselt het
afleveradres per order en zijn niet alle vestiging-GLN's vooraf bekend, waardoor orders
op het verkeerde (hoofd)adres belanden.

## Verzoek
Kunnen jullie in het "Custom ERP"-orderformat (richting Karpi) de **adresregels van
NAD+DP** opnemen — minimaal: naam, straat, postcode, plaats, land? Bij voorkeur ook
voor NAD+BY en NAD+IV.

Concreet:
1. Welke veldposities/lengtes kunnen jullie toevoegen in de header (of een extra
   record-type) voor het DP-adres?
2. Geldt dit dan voor **alle** partners die D96A ORDERS sturen, of per partner te
   configureren?
3. Kan dit binnen de huidige versie of vereist het een nieuwe formaatversie (met
   bijbehorende hertest)?

Zo kunnen wij het afleveradres rechtstreeks uit het bericht overnemen i.p.v. via een
GLN-lookup, en is het adres altijd correct — ook voor nieuwe/onbekende vestigingen.

## Achtergrond (intern)
- Bron-van-waarheid blijft `afleveradressen.gln_afleveradres`; zolang het format geen
  adres draagt vullen we ontbrekende vestigingen via de portal-EDIFACT
  (`import/edi_afleveradres_uit_archief.py`) of de koppel-widget (mig 306).
- Zie ook [werklijst-35-afleveradressen.md](werklijst-35-afleveradressen.md).
