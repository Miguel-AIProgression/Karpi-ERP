// ADR-0025: shape-bias in reststuk-scoring — score = oppervlak × √(kort/lang).
// Eén bron; guillotine-packing (packer-kost) en compute-reststukken
// (UI/rapportage, frontend via ADR-0033-shim) importeren beide hierheen.
// (Was 3× hand-gekopieerd "in lockstep" — audit 2026-07-02.)
//
// `score = area × √(short/long)`. Pure m² is shape-blind: een 150×450
// (verkoopbaar als tapijt) en een 75×905 (alleen staaltjes-bruikbaar) krijgen
// bij gelijke area dezelfde score, waardoor de packer/UI onbedoeld voor lange
// smalle strips kan kiezen. De wortel-weighting straft extreme aspect-ratio's
// af zonder kwalificerende strips helemaal weg te schrijven:
//
//   150×450  → 67500 × √0.333 ≈ 38 950
//   75×905   → 67875 × √0.083 ≈ 19 550   ← duidelijk minder voorkeur
//   200×200  → 40000 × √1.000 = 40 000   ← klein vierkant wint van lange strip
//
// Deze functie is pure kwalificatie-agnostisch: callers filteren zelf op de
// reststuk-kwalificatie-drempel (`RESTSTUK_MIN_SHORT`/`RESTSTUK_MIN_LONG`,
// zie `./reststuk-config.ts`) vóórdat ze scoren — er wordt hier dus nooit op
// een non-kwalificerende (en dus mogelijk `long <= 0`) rechthoek gerekend.
export function reststukScore(r: { width: number; height: number }): number {
  const short = Math.min(r.width, r.height)
  const long = Math.max(r.width, r.height)
  return r.width * r.height * Math.sqrt(short / long)
}
