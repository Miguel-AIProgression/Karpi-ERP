#!/usr/bin/env python3
"""
Dry-run test voor sync-shopify-order edge function.

Stuurt een nep-Shopify-order met ?debug=1 — de function doet volledige
verwerking (debiteur-match, adres-opbouw, maatwerk-dims) maar schrijft
NIETS naar de database. Geen Shopify-secret nodig.

Gebruik:
  python import/test_shopify_webhook.py

Wat te controleren in de output:
  header.afl_naam       → bedrijfsnaam uit RugFlow (bijv. "Unik Living BV")
  header.afl_naam_2     → contactpersoon van Shopify (bijv. "Niek Wouters")
  header.fact_naam      → zelfde bedrijfsnaam
  header.klant_referentie → "REF Kleiner / Shopify: #5999"
  regels[0].maatwerk_lengte_cm / maatwerk_breedte_cm → 300 / 400
"""

import json
import sys
import urllib.request

SUPABASE_URL = "https://wqzeevfobwauxkalagtn.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/sync-shopify-order?debug=1"

# ── Test-payload ─────────────────────────────────────────────────────────────
# Gebaseerd op het patroon van Shopify #5596 (Unik Living, Rubi 62 Maatwerk).
# Pas email aan als Unik Living een ander e-mailadres heeft in RugFlow.

TEST_ORDER = {
    "id": 9999999999001,
    "name": "#5999",
    "order_number": 5999,
    "note": "REF Kleiner",
    "note_attributes": [],
    "created_at": "2026-06-17T10:00:00+02:00",
    "updated_at": "2026-06-17T10:00:00+02:00",
    "financial_status": "paid",
    "fulfillment_status": None,
    "email": "info@unikliving.nl",   # ← pas aan naar email van klant in RugFlow
    "customer": {
        "id": 1234567,
        "email": "info@unikliving.nl",
        "first_name": "Niek",
        "last_name": "Wouters",
        "company": "Unik Living BV",
    },
    "billing_address": {
        "first_name": "Niek",
        "last_name": "Wouters",
        "company": "Unik Living BV",
        "address1": "Teststraat 1",
        "zip": "1234 AB",
        "city": "Amsterdam",
        "country": "Netherlands",
        "country_code": "NL",
    },
    "shipping_address": {
        "first_name": "Niek",
        "last_name": "Wouters",
        "company": "Unik Living BV",
        "address1": "Teststraat 1",
        "zip": "1234 AB",
        "city": "Amsterdam",
        "country": "Netherlands",
        "country_code": "NL",
    },
    "line_items": [
        {
            "id": 1001,
            "title": "Rubi 62",
            "variant_title": None,
            "sku": None,
            "quantity": 1,
            "price": "0.00",
            "total_discount": "0.00",
            "grams": 3600,
            "requires_shipping": True,
            "properties": [
                {"name": "Maatwerk", "value": "300x400 rechthoek"},
                {"name": "Maatwerk-sku", "value": "RUBI62MAATWERK"},
            ],
        }
    ],
    "shipping_lines": [],
}

# ── Request sturen (geen signature nodig in debug mode) ─────────────────────

payload_bytes = json.dumps(TEST_ORDER, separators=(",", ":")).encode("utf-8")

print(f"→ POST {FUNCTION_URL}")
print(f"  Order: {TEST_ORDER['name']}  |  klant-email: {TEST_ORDER['email']}")
print()

req = urllib.request.Request(
    FUNCTION_URL,
    data=payload_bytes,
    headers={
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Shop-Domain": "karpi-tapijt.myshopify.com",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    print(f"HTTP {e.code}: {e.reason}")
    print(json.dumps(body, indent=2, ensure_ascii=False))
    sys.exit(1)

# ── Resultaat analyseren ─────────────────────────────────────────────────────

if not body.get("dry_run"):
    print("FOUT: geen dry_run-response:")
    print(json.dumps(body, indent=2, ensure_ascii=False))
    sys.exit(1)

header = body.get("header", {})
regels = body.get("regels", [])
match  = body.get("debiteur_match", {})

OK   = "✓"
FAIL = "✗"

print("── Debiteur-match ───────────────────────────────────────────")
dn = match.get("debiteur_nr")
print(f"  debiteur_nr : {dn}")
print(f"  bron        : {match.get('bron')}")
print(f"  zeker       : {match.get('zeker')}")
if dn is None:
    print()
    print("  !! Geen debiteur gevonden.")
    print("     Pas 'email' in het script aan naar het e-mailadres")
    print("     dat Unik Living heeft in RugFlow (debiteuren-tabel).")

print()
print("── Adresvelden ──────────────────────────────────────────────")
afl_naam   = header.get("afl_naam")
afl_naam_2 = header.get("afl_naam_2")
fact_naam  = header.get("fact_naam")

shopify_contact = f"{TEST_ORDER['customer']['first_name']} {TEST_ORDER['customer']['last_name']}"

def check(label, actual, verwacht_hint):
    print(f"  {label}: {actual!r}")
    print(f"         (verwacht: {verwacht_hint})")

check("afl_naam  ", afl_naam,   "bedrijfsnaam uit RugFlow, NIET de Shopify-naam")
check("afl_naam_2", afl_naam_2, f"contactpersoon Shopify: {shopify_contact!r}")
check("fact_naam ", fact_naam,  "zelfde als afl_naam")

afl_ok = afl_naam != shopify_contact and afl_naam is not None
afl_2_ok = afl_naam_2 == shopify_contact
icon = OK if afl_ok else FAIL
print(f"  {icon}  afl_naam is NIET de Shopify-contact: {afl_ok}")
icon2 = OK if afl_2_ok else FAIL
print(f"  {icon2}  afl_naam_2 = Shopify-contact: {afl_2_ok}")

print()
print("── klant_referentie ─────────────────────────────────────────")
ref = header.get("klant_referentie", "")
print(f"  {ref!r}")
has_nr = f"Shopify: {TEST_ORDER['name']}" in ref
has_po = TEST_ORDER.get("note", "") in ref
print(f"  {OK if has_nr else FAIL}  bevat Shopify-ordernummer ({TEST_ORDER['name']}): {has_nr}")
print(f"  {OK if has_po else FAIL}  bevat klant-PO ({TEST_ORDER['note']!r}): {has_po}")

print()
print("── Maatwerk-afmetingen ──────────────────────────────────────")
for i, regel in enumerate(regels):
    if not regel.get("is_maatwerk"):
        continue
    lengte = regel.get("maatwerk_lengte_cm")
    breedte = regel.get("maatwerk_breedte_cm")
    ok = lengte == 300 and breedte == 400
    print(f"  Regel {i+1}: {regel.get('omschrijving')!r}")
    print(f"  {OK if ok else FAIL}  {lengte} × {breedte} cm  (verwacht: 300 × 400)")
    if not ok:
        print(f"  properties in payload: {TEST_ORDER['line_items'][i]['properties']}")

print()
print("── Alle adressen / header (volledig) ────────────────────────")
for k, v in header.items():
    if v not in (None, ""):
        print(f"  {k}: {v!r}")
