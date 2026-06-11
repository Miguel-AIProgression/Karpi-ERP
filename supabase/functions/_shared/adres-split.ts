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

export function normalizeCountry(land: string): string {
  const trimmed = (land ?? '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (upper === 'NEDERLAND' || upper === 'THE NETHERLANDS' || upper === 'HOLLAND') {
    return 'NL';
  }
  if (upper === 'DUITSLAND' || upper === 'GERMANY') return 'DE';
  if (upper === 'BELGIE' || upper === 'BELGIË' || upper === 'BELGIUM') return 'BE';
  if (upper === 'FRANKRIJK' || upper === 'FRANCE') return 'FR';
  return upper;
}
