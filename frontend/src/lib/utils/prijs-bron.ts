import type { PrijsBron, PrijsBreakdown } from '@/lib/supabase/queries/order-mutations'
import { getVormDisplay } from '@/lib/utils/vorm-labels'

interface PrijsBronFormatted {
  /** Korte 1-regel hint die onder het prijs-input verschijnt */
  label: string
  /** Hover-tooltip met volledige breakdown */
  tooltip: string
  /** Tailwind-klasse voor kleur (groen=goed, amber=fallback, rood=ontbreekt) */
  kleur: string
}

function fmtBedrag(n: number | undefined): string {
  if (n == null) return '—'
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtM2(n: number | undefined): string {
  if (n == null) return '—'
  return `${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`
}

/**
 * Vertaalt het resultaat van `bereken_orderregel_prijs` (mig 191) naar een
 * Nederlandstalige hint + tooltip voor de orderregel-prijs-cel. Mapping:
 *   prijslijst_vast              → geen hint (standaard pad, prijs is "schoon")
 *   product_vaste_verkoopprijs   → geen hint (mig 253 — vaste-maat artikel, eigen prijs, schoon)
 *   prijslijst_m2                → m² × prijs uit klant-prijslijst (+ vormtoeslag)
 *   maatwerk_artikel_m2          → m² × verkoopprijs maatwerk-artikel (+ vormtoeslag)
 *   kwaliteit_m2                 → m² × generieke kwaliteits-m²-prijs (+ vormtoeslag)
 *   product_verkoopprijs         → standaard verkoopprijs van het product
 *   geen / onbekend              → ⚠ geen prijs te bepalen
 */
export function formatPrijsBron(bron: PrijsBron, b: PrijsBreakdown): PrijsBronFormatted {
  const vormLabel = b.vorm_code ? getVormDisplay(b.vorm_code).label : 'Rechthoek'
  const heeftToeslag = (b.vorm_toeslag ?? 0) > 0
  const m2Deel = `${fmtM2(b.oppervlak_m2)} × ${fmtBedrag(b.m2_prijs)}/m²`
  const vormDeel = heeftToeslag
    ? ` + ${fmtBedrag(b.vorm_toeslag)} (${vormLabel})`
    : ''

  switch (bron) {
    case 'prijslijst_vast':
      return { label: '', tooltip: 'Prijs uit klant-prijslijst', kleur: 'text-emerald-600' }

    case 'product_vaste_verkoopprijs':
      return {
        label: '',
        tooltip: 'Vaste-maat artikel — eigen verkoopprijs uit producten-tabel '
          + '(geen klant-prijslijst-regel, mig 253)',
        kleur: 'text-emerald-600',
      }

    case 'prijslijst_m2':
      return {
        label: `m²-prijs uit prijslijst · ${m2Deel}${vormDeel}`,
        tooltip: `Berekend uit klant-prijslijst (artikel ${b.maatwerk_artikel ?? '—'}): `
          + `${fmtM2(b.oppervlak_m2)} × ${fmtBedrag(b.m2_prijs)}${vormDeel}`,
        kleur: 'text-sky-600',
      }

    case 'maatwerk_artikel_m2':
      return {
        label: `m² uit maatwerk-artikel · ${m2Deel}${vormDeel}`,
        tooltip: `Klant-prijslijst heeft geen m²-prijs voor dit artikel. `
          + `Fallback op verkoopprijs van maatwerk-artikel ${b.maatwerk_artikel ?? '—'}: `
          + `${fmtM2(b.oppervlak_m2)} × ${fmtBedrag(b.m2_prijs)}${vormDeel}`,
        kleur: 'text-amber-600',
      }

    case 'kwaliteit_m2':
      return {
        label: `m² uit kwaliteit ${b.kwaliteit_code ?? ''} · ${m2Deel}${vormDeel}`,
        tooltip: `Geen prijslijst-prijs en geen kleur-specifiek maatwerk-artikel. `
          + `Fallback op generieke m²-prijs voor kwaliteit ${b.kwaliteit_code ?? ''}: `
          + `${fmtM2(b.oppervlak_m2)} × ${fmtBedrag(b.m2_prijs)}${vormDeel}`,
        kleur: 'text-amber-600',
      }

    case 'product_verkoopprijs':
      return {
        label: 'Standaard verkoopprijs',
        tooltip: 'Geen prijslijst-prijs en geen m²-fallback mogelijk — '
          + 'gebruikt producten.verkoopprijs als laatste redmiddel.',
        kleur: 'text-amber-600',
      }

    case 'onbekend_artikel':
      return {
        label: '⚠ Artikel niet gevonden',
        tooltip: 'Het opgegeven artikelnr bestaat niet in de productentabel.',
        kleur: 'text-rose-600',
      }

    case 'geen':
    default:
      return {
        label: '⚠ Geen prijs bekend',
        tooltip: b.reden ?? 'Geen prijs in prijslijst, geen m²-fallback en geen verkoopprijs.',
        kleur: 'text-rose-600',
      }
  }
}
