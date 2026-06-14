// Labelbarcode — de Code128-waarde die fysiek op het verzendlabel staat en die
// ELKE vervoerder exact aangemeld krijgt. Eén bron voor label-render én alle
// carrier-payloads (HST BarCode, Verhoek ScanCode, Rhenus <sscc>).
//
// Achtergrond: de barcode op de doos is een fysiek feit over ONS label, niet
// een capability van een vervoerder — dezelfde doos, ongeacht wie hem ophaalt.
// Daarom leeft de AI(00)-prefix hier op één plek i.p.v. vier keer hardcoded /
// als per-carrier app_config-vlag. Dat laatste was precies de HST-overlossing-
// klasse bug: label en aangemelde barcode konden stil van elkaar afwijken
// (incident 12-06-2026 — labels met een SSCC die het depot niet kende).
//
// PUUR — geen DB, geen secrets — zodat de frontend hem via de re-export-shim
// deelt (ADR-0033). SSCC-waarde zelf blijft single-source uit zending_colli.sscc.

// GS1 Application Identifier 00 (SSCC) — maakt van de 18-cijferige SSCC de
// 20-cijferige scanbare Code128-waarde.
const AI_SSCC = '00';

/**
 * De barcode-waarde zoals die op het label gedrukt wordt en aan de vervoerder
 * wordt aangemeld: AI(00) + de 18-cijferige SSCC.
 *
 * Invariant: `null`/lege SSCC → `null`. Er mag nooit een niet-aangemelde
 * barcode geprint of verstuurd worden; een colli zonder SSCC levert dus geen
 * barcode op (label rendert zonder, carrier-preflight blokkeert al eerder).
 */
export function labelBarcode(sscc: string | null | undefined): string | null {
  if (sscc === null || sscc === undefined || sscc === '') return null;
  return `${AI_SSCC}${sscc}`;
}
