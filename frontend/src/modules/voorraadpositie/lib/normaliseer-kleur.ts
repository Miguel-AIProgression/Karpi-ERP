// Single source of truth voor kleur-normalisatie aan client-zijde.
//
// SQL-equivalent: regexp_replace(kleur_code, '\.0+$', '') — mig 179, en
// idem in mig 115/137-bron-RPC's. Frontend dupliceert dit bewust:
//   - input-canonicalisering vóór de RPC-call (zodat queryKey-cache-hits
//     consistent zijn ongeacht of de caller '15' of '15.0' meegeeft);
//   - output-canonicalisering ná de RPC-respons (defensief, sluit aan
//     op partner-kleurcodes die mogelijk uit andere bronnen komen).
//
// '15.0'  → '15'
// '15.00' → '15'
// '15'    → '15'
// '15.5'  → '15.5'  (alleen trailing .0+ wordt gestript, niet alle decimalen)

export function normaliseerKleurcode(code: string): string {
  return code.replace(/\.0+$/, '')
}
