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
import os
import ssl
import sys
import urllib.request
from pathlib import Path

# Mac Python 3.14 heeft geen systeem-CA's — voor dit testscript is dat prima.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# Lees service role key uit import/.env (zelfde als andere import-scripts)
def _read_env():
    env_file = Path(__file__).parent / ".env"
    env = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

_env = _read_env()
SUPABASE_URL = _env.get("SUPABASE_URL", "https://wqzeevfobwauxkalagtn.supabase.co")
SUPABASE_KEY = _env.get("SUPABASE_SERVICE_ROLE_KEY", "")
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
    "email": "admin@unik-living.com",  # e-mailadres van UNIK LIVING (debiteur 831800)
    "customer": {
        "id": 1234567,
        "email": "admin@unik-living.com",
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
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Shop-Domain": "karpi-tapijt.myshopify.com",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req, context=_ssl_ctx) as resp:
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

# ── Test 2: Vorm-mismatch — contour in omschrijving maar rechthoekige SKU ────
#
# Scenario: de Shopify-operator heeft een verkeerde SKU ingevuld die naar een
# MAATWERK-artikel verwijst maar de vorm 'contour' ontbreekt daarin.
# Verwacht: systeem detecteert 'contour' in omschrijving, negeert SKU,
# en slaat aan als maatwerk MET maatwerk_vorm='contour'.

CONTOUR_ORDER = {
    "id": 9999999999002,
    "name": "#6000",
    "order_number": 6000,
    "note": "",
    "note_attributes": [],
    "created_at": "2026-06-17T10:00:00+02:00",
    "updated_at": "2026-06-17T10:00:00+02:00",
    "financial_status": "paid",
    "fulfillment_status": None,
    "email": "admin@unik-living.com",
    "customer": {
        "id": 1234567,
        "email": "admin@unik-living.com",
        "first_name": "Niek",
        "last_name": "Wouters",
        "company": "Unik Living BV",
    },
    "billing_address": {
        "first_name": "Niek", "last_name": "Wouters", "company": "Unik Living BV",
        "address1": "Teststraat 1", "zip": "1234 AB", "city": "Amsterdam",
        "country": "Netherlands", "country_code": "NL",
    },
    "shipping_address": {
        "first_name": "Niek", "last_name": "Wouters", "company": "Unik Living BV",
        "address1": "Teststraat 1", "zip": "1234 AB", "city": "Amsterdam",
        "country": "Netherlands", "country_code": "NL",
    },
    "line_items": [
        {
            "id": 2001,
            "title": "Rubi 62",
            "variant_title": "200x290 Contour",
            "sku": "RUBI62MAATWERK",   # ← SKU is maatwerk maar zonder vorminformatie
            "quantity": 1,
            "price": "0.00",
            "total_discount": "0.00",
            "grams": 5800,
            "requires_shipping": True,
            "properties": [
                {"name": "Maatwerk", "value": "200x290 Contour"},
                {"name": "Maatwerk-sku", "value": "RUBI62MAATWERK"},
            ],
        }
    ],
    "shipping_lines": [],
}

print()
print("=" * 60)
print("TEST 2: Vorm-mismatch (contour in titel, maatwerk-SKU)")
print("=" * 60)

payload2 = json.dumps(CONTOUR_ORDER, separators=(",", ":")).encode("utf-8")
req2 = urllib.request.Request(
    FUNCTION_URL,
    data=payload2,
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Shop-Domain": "karpi-tapijt.myshopify.com",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req2, context=_ssl_ctx) as resp2:
        body2 = json.loads(resp2.read())
except urllib.error.HTTPError as e:
    body2 = json.loads(e.read())
    print(f"HTTP {e.code}: {e.reason}")
    print(json.dumps(body2, indent=2, ensure_ascii=False))
    import sys; sys.exit(1)

regels2 = body2.get("regels", [])
print()
for i, regel in enumerate(regels2):
    is_mw = regel.get("is_maatwerk")
    vorm  = regel.get("maatwerk_vorm")
    lengte = regel.get("maatwerk_lengte_cm")
    breedte = regel.get("maatwerk_breedte_cm")
    print(f"  Regel {i+1}: {regel.get('omschrijving')!r}")
    print(f"    is_maatwerk      : {is_mw}")
    print(f"    maatwerk_vorm    : {vorm}")
    print(f"    afmeting         : {lengte} × {breedte} cm")
    print(f"    kwaliteit        : {regel.get('maatwerk_kwaliteit_code')}")
    print(f"    kleur            : {regel.get('maatwerk_kleur_code')}")

    ok_mw   = is_mw is True
    ok_vorm = vorm == "contour"
    ok_afm  = lengte == 200 and breedte == 290
    print(f"  {OK if ok_mw else FAIL}  is_maatwerk = True")
    print(f"  {OK if ok_vorm else FAIL}  maatwerk_vorm = 'contour'  (was: {vorm!r})")
    print(f"  {OK if ok_afm else FAIL}  afmeting 200 × 290  (was: {lengte} × {breedte})")
    if not ok_vorm:
        print("    !! Contour werd niet herkend als maatwerk_vorm.")
