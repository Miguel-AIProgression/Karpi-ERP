// Gedeelde adres-helpers voor vervoerder-adapters (hst-send, verhoek-send).
// Puur — geen DB/secrets. Geëxtraheerd uit hst-send/payload-builder.ts
// (ADR-0031): beide vervoerders willen straat + huisnummer in aparte velden.

// Splitst "Tweede Broekdijk 10 A" → { street: "Tweede Broekdijk", number: "10", addition: "A" }
// HST wil straat, nummer en toevoeging in aparte velden. Een lege StreetNumber
// keurt HST af met HTTP 400 "Afleveradres niet aanwezig/compleet" — de parser
// moet dus ook werkelijke webshop-invoer aankunnen (incident ZEND-2026-0002,
// 11-06-2026: "Saturnusstraat 60 (Unit 30)" → StreetNumber leeg → 400):
//   "Saturnusstraat 60 (Unit 30)"  → 60, "Unit 30"   (haakjes/blokhaken → toevoeging)
//   "Biltstraat 35 [001]"          → 35, "001"
//   "westeresch 1-5"               → 1,  "-5"        (reeks blijft reconstrueerbaar)
//   "Koeweistraat, 6"              → 6               (komma's genegeerd)
//   "Raasdorperweg 181G"           → 181, "G"
export function splitAdres(adres: string): { street: string; number: string; addition: string } {
  let trimmed = (adres ?? '').trim();
  if (!trimmed) return { street: '', number: '', addition: '' };

  // (…)- en […]-delen zijn toevoegingen (unit/etage/filiaalcode), geen straat.
  const extras: string[] = [];
  trimmed = trimmed
    .replace(/[([]([^)\]]*)[)\]]/g, (_geheel, inner: string) => {
      if (inner.trim()) extras.push(inner.trim());
      return ' ';
    })
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Eerste losstaand cijfer-token ná de straatnaam = huisnummer; de rest
  // (letters, "-5", "A", "3hoog") is toevoeging — wat het ook is, het mag
  // nooit meer tot een lege StreetNumber leiden zolang er een nummer in
  // het adres staat.
  const m = trimmed.match(/^(.+?)\s+(\d+)\s*(.*)$/);
  if (!m) {
    return { street: trimmed, number: '', addition: extras.join(' ') };
  }
  const addition = [m[3]?.trim(), ...extras].filter(Boolean).join(' ');
  return {
    street: m[1].trim(),
    number: m[2].trim(),
    addition,
  };
}

// Landnaam → ISO-2-code. Spiegelt de SQL-bron normaliseer_land (mig 214) één-op-
// één. De SQL↔TS-pariteit is geborgd door de golden-contracttest:
//   frontend/src/lib/orders/__tests__/golden/normaliseer-land.golden.json
//   + assert_normaliseer_land_contract() in de laatste
//     *_normaliseer_land_contract*.sql-migratie (SQL)
//   + normaliseer-land.contract.test.ts (TS, Vitest).
// Wie deze tabel wijzigt: golden bijwerken + nieuwe contract-migratie, anders
// wordt de contracttest rood. De sleutels zijn de POST-normalisatie-vorm
// (uppercase, diakriet-vrij, whitespace-genormaliseerd) — zie schoonLand.
const LAND_NAAR_ISO2: Record<string, string> = {
  NEDERLAND: 'NL', HOLLAND: 'NL', NETHERLANDS: 'NL', 'THE NETHERLANDS': 'NL',
  BELGIE: 'BE', BELGIUM: 'BE', BELGIQUE: 'BE',
  DUITSLAND: 'DE', GERMANY: 'DE', DEUTSCHLAND: 'DE',
  FRANKRIJK: 'FR', FRANCE: 'FR',
  LUXEMBURG: 'LU', LUXEMBOURG: 'LU',
  OOSTENRIJK: 'AT', AUSTRIA: 'AT', OSTERREICH: 'AT',
  ZWITSERLAND: 'CH', SWITZERLAND: 'CH', SCHWEIZ: 'CH',
  ITALIE: 'IT', ITALY: 'IT', ITALIA: 'IT',
  SPANJE: 'ES', SPAIN: 'ES', ESPANA: 'ES',
  POLEN: 'PL', POLAND: 'PL', POLSKA: 'PL',
  TSJECHIE: 'CZ', 'CZECH REPUBLIC': 'CZ', CZECHIA: 'CZ',
  DENEMARKEN: 'DK', DENMARK: 'DK', DANMARK: 'DK',
  ZWEDEN: 'SE', SWEDEN: 'SE', SVERIGE: 'SE',
  NOORWEGEN: 'NO', NORWAY: 'NO', NORGE: 'NO',
  ENGELAND: 'GB', GROOTBRITTANNIE: 'GB', 'GROOT-BRITTANNIE': 'GB', UK: 'GB', 'UNITED KINGDOM': 'GB',
  IERLAND: 'IE', IRELAND: 'IE',
};

// Trim → uppercase → diakritieken strippen → whitespace-runs naar één spatie.
// Exact de voorbewerking van normaliseer_land (mig 214) zodat 'BELGIË',
// 'Österreich' en 'United  Kingdom' op dezelfde sleutel uitkomen.
function schoonLand(land: string): string {
  return land
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Strikt: bekende landnaam of ISO-2-code → ISO-2; onbekend → null.
 * Voor de frontend-vlag-emoji, die een expliciet null-contract verwacht
 * (een onbekend land = geen vlag, geen rare passthrough-code).
 */
export function landNaarIso2Strikt(land: string | null | undefined): string | null {
  if (!land) return null;
  const schoon = schoonLand(land);
  if (!schoon) return null;
  if (/^[A-Z]{2}$/.test(schoon)) return schoon; // al een ISO-2-code
  return LAND_NAAR_ISO2[schoon] ?? null;
}

/**
 * Lenient: zoals landNaarIso2Strikt, maar een ONBEKEND land komt uppercased
 * (diakriet-vrij, whitespace-genormaliseerd) terug i.p.v. null — exotische
 * landen blijven zo bruikbaar in vrachtbrief-/EDI-velden. Lege input → ''.
 * Spiegelt normaliseer_land (mig 214), op de leeg→'' i.p.v. NULL-conventie na.
 * Dit is de variant die HST/Verhoek/Rhenus + de factuur-paden gebruiken.
 */
export function normalizeCountry(land: string | null | undefined): string {
  if (!land) return '';
  const schoon = schoonLand(land);
  if (!schoon) return '';
  return landNaarIso2Strikt(schoon) ?? schoon;
}
