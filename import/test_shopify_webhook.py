#!/usr/bin/env python3
"""
Dry-run test voor sync-shopify-order edge function.

Stuurt een nep-Shopify-order met ?debug=1 — de function doet volledige
verwerking (debiteur-match, adres-opbouw, maatwerk-dims) maar schrijft
NIETS naar de database.

Gebruik:
  export SHOPIFY_WEBHOOK_SECRET=<uit Supabase dashboard → Edge Functions → Secrets>
  python import/test_shopify_webhook.py

  # Of direct meegeven:
  SHOPIFY_WEBHOOK_SECRET=xxx python import/test_shopify_webhook.py

Wat te controleren in de output:
  header.afl_naam       → moet bedrijfsnaam uit RugFlow zijn (bijv. "Unik Living BV")
  header.afl_naam_2     → moet contactpersoon zijn (bijv. "Niek Wouters")
  header.fact_naam      → zelfde bedrijfsnaam
  header.klant_referentie → "REF Kleiner / Shopify: #5999"
  regels[0].maatwerk_lengte_cm / maatwerk_breedte_cm → 300 / 400
"""

import hashlib
import hmac
import json
import os
import sys
import base64
import urllib.request

# ── Configuratie ────────────────────────────────────────────────────────────

SUPABASE_URL = "https://wqzeevfobwauxkalagtn.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/sync-shopify-order?debug=1"

SHOPIFY_SECRET = os.environ.get("SHOPIFY_WEBHOOK_SECRET", "")
if not SHOPIFY_SECRET:
    print("FOUT: stel SHOPIFY_WEBHOOK_SECRET in als environment variable.")
    print("  export SHOPIFY_WEBHOOK_SECRET=<secret uit Supabase dashboard>")
    sys.exit(1)

# ── Test-payload ─────────────────────────────────────────────────────────────
# Gebaseerd op het patroon van Shopify #5596 (Unik Living, Rubi 62 Maatwerk).
# Pas aan als je een andere klant of ander product wilt testen.

TEST_ORDER = {
    "id": 9999999999001,          # fictief order-ID (wordt niet in DB geschreven)
    "name": "#5999",
    "order_number": 5999,
    "note": "REF Kleiner",        # klant-PO → verwacht in klant_referentie
    "note_attributes": [],
    "created_at": "2026-06-17T10:00:00+02:00",
    "updated_at": "2026-06-17T10:00:00+02:00",
    "financial_status": "paid",
    "fulfillment_status": None,
    "email": "info@unikliving.nl",  # ← pas aan naar een e-mailadres van een bestaande klant
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
            "sku": "RUBI62MAATWERK",   # maatwerk-sku
            "quantity": 1,
            "price": "0.00",
            "total_discount": "0.00",
            "grams": 3600,
            "requires_shipping": True,
            "properties": [
                # Shopify VO Product Options formaat:
                {"name": "Maatwerk", "value": "300x400 rechthoek"},
                {"name": "Maatwerk-sku", "value": "RUBI62MAATWERK"},
            ],
        }
    ],
    "shipping_lines": [],
}

# ── HMAC-SHA256 signature berekenen (zelfde als Shopify) ────────────────────

payload_bytes = json.dumps(TEST_ORDER, separators=(",", ":")).encode("utf-8")
sig = hmac.new(SHOPIFY_SECRET.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
signature = base64.b64encode(sig).decode("utf-8")

# ── Request sturen ──────────────────────────────────────────────────────────

print(f"→ POST {FUNCTION_URL}")
print(f"  Shopify order: {TEST_ORDER['name']}  (ID {TEST_ORDER['id']})")
print(f"  Klant e-mail: {TEST_ORDER['email']}")
print()

req = urllib.request.Request(
    FUNCTION_URL,
    data=payload_bytes,
    headers={
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": signature,
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

# ── Resultaat analyseren ─────────────────────────────────────────────────────

if not body.get("dry_run"):
    print("FOUT: geen dry_run-response. Volledige response:")
    print(json.dumps(body, indent=2, ensure_ascii=False))
    sys.exit(1)

header = body.get("header", {})
regels = body.get("regels", [])
match  = body.get("debiteur_match", {})

OK = "✓"
FAIL = "✗"

def check(label, actual, expected):
    ok = actual == expected
    icon = OK if ok else FAIL
    status = "" if ok else f"  VERWACHT: {expected!r}"
    print(f"  {icon}  {label}: {actual!r}{status}")
    return ok

print("── Debiteur-match ───────────────────────────────────────────")
print(f"  debiteur_nr : {match.get('debiteur_nr')}")
print(f"  bron        : {match.get('bron')}")
print(f"  zeker       : {match.get('zeker')}")
if match.get("debiteur_nr") is None:
    print("  !! Geen debiteur gevonden — pas email/bedrijfsnaam aan in het script")

print()
print("── Adresvelden (te controleren) ─────────────────────────────")
print(f"  afl_naam    : {header.get('afl_naam')!r}   ← moet bedrijfsnaam uit RugFlow zijn")
print(f"  afl_naam_2  : {header.get('afl_naam_2')!r}  ← moet contactpersoon (Shopify) zijn")
print(f"  fact_naam   : {header.get('fact_naam')!r}")

print()
print("── klant_referentie ─────────────────────────────────────────")
ref = header.get("klant_referentie", "")
print(f"  {ref!r}")
has_shopify_nr = f"Shopify: {TEST_ORDER['name']}" in ref
has_po = TEST_ORDER["note"] in ref if TEST_ORDER.get("note") else True
icon = OK if (has_shopify_nr and has_po) else FAIL
print(f"  {icon}  bevat Shopify-ordernummer: {has_shopify_nr}")
print(f"  {icon}  bevat klant-PO: {has_po}")

print()
print("── Orderregels ──────────────────────────────────────────────")
for i, regel in enumerate(regels):
    print(f"  Regel {i+1}: {regel.get('omschrijving')!r}")
    print(f"    artikelnr        : {regel.get('artikelnr')}")
    print(f"    is_maatwerk      : {regel.get('is_maatwerk')}")
    lengte = regel.get("maatwerk_lengte_cm")
    breedte = regel.get("maatwerk_breedte_cm")
    icon = OK if lengte == 300 and breedte == 400 else FAIL
    print(f"    {icon}  lengte×breedte   : {lengte} × {breedte}  (verwacht: 300 × 400)")
    print(f"    prijs            : {regel.get('prijs')}")

print()
print("── Volledige header (ter referentie) ────────────────────────")
for k, v in header.items():
    if v not in (None, ""):
        print(f"  {k}: {v!r}")
