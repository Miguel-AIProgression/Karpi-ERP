import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { OrderConfig } from '@/lib/supabase/queries/order-config'
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
import { berekenAfleverdatum, type AfleverdatumResult } from '@/lib/utils/afleverdatum'

/** Smal contract voor afleverdatum-bepaling — subset van SelectedClient. */
export interface KlantLevertermijn {
  standaard_maat_werkdagen: number | null
  maatwerk_weken: number | null
}

/**
 * Wikkelt `berekenAfleverdatum` met de form-context: filter admin-pseudo's
 * (mig 272, ADR-0018), detecteer maatwerk vs standaard-maat, vallenback klant → globale config →
 * hardcoded defaults (5 werkdagen / 4 weken). Lege orders krijgen een
 * standaard-maat-leverdatum zodat het week-veld niet leeg blijft.
 *
 * Pure functie. Bouwt boven op `lib/utils/afleverdatum.ts:berekenAfleverdatum`
 * die de pure dagen/weken-formule bezit. Deze laag voegt de orderregel-
 * filtering en de fallback-keten toe — gedragsregel die in de form-flow
 * leeft, niet in de basisformule.
 */
export function bepaalOrderAfleverdatum(
  regels: OrderRegelFormData[],
  client: KlantLevertermijn | null,
  cfg: OrderConfig | undefined,
): AfleverdatumResult {
  const contentRegels = regels.filter((r) => !isAdminPseudo(r))
  const heeftStandaardMaat = contentRegels.some((r) => !r.is_maatwerk)
  const heeftMaatwerk = contentRegels.some((r) => r.is_maatwerk)
  const standaardMaatWerkdagen =
    client?.standaard_maat_werkdagen ?? cfg?.standaard_maat_werkdagen ?? 5
  const maatwerkWeken = client?.maatwerk_weken ?? cfg?.maatwerk_weken ?? 4

  return berekenAfleverdatum({
    heeftStandaardMaat: heeftStandaardMaat || contentRegels.length === 0,
    heeftMaatwerk,
    standaardMaatWerkdagen,
    maatwerkWeken,
  })
}
