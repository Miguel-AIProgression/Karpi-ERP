// Order-hydratie — de inverse van Order-commit (zie CONTEXT.md): bouwt uit een
// bestaande Order de form-state (OrderRegelFormData[]) waarmee de order-form de
// bewerk-flow opent. Tweede adapter op het "bron → order-form-state"-seam dat
// po-prefill (klant-PO → form) al bewoont; spiegel van order-commit (form → plan).
//
// Aanleiding (ORD-2026-0614, 2026-06-18): de inline rehydratie in order-edit.tsx
// vergat `vrije_voorraad`/`besteld_inkoop`, waardoor berekenRegelDekking voor
// elke voorradige regel zónder omsticker-keuze een vals IO-tekort meldde en de
// LeverModusDialog ("wacht op inkoop") onterecht opende. Pure functie, geen
// React/I/O — fixture-getest in __tests__/order-hydratie.test.ts.
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

/**
 * Het regel-input-contract: de display-only velden die een form-regel uit
 * `producten` erft en die de order-form-beslissingen voeden —
 * `vrije_voorraad` + `besteld_inkoop` (gelezen door `berekenRegelDekking` →
 * het IO-tekort-/LeverModusDialog-oordeel) en `is_pseudo` + `is_dropship`
 * (gelezen door `isAdminPseudo`/`isDropshipRegel`). Eén bron zodat elke
 * "bron → order-form-state"-bouwer (addArticle, Order-hydratie, en straks
 * po-prefill) dezelfde velden zet; een vergeten veld wordt een test-failure
 * i.p.v. een stil vals IO-tekort.
 */
export interface RegelProductVelden {
  vrije_voorraad?: number | null
  besteld_inkoop?: number | null
  is_pseudo?: boolean | null
  is_dropship?: boolean | null
}

/**
 * Past de producten-display-velden toe op een form-regel. Gedeeld door de
 * artikel-select-bouwer (`addArticle`) en de Order-hydratie. NULL → undefined
 * zodat de optionele `OrderRegelFormData`-velden niet expliciet null dragen.
 */
export function metProductVelden(
  regel: OrderRegelFormData,
  velden: RegelProductVelden,
): OrderRegelFormData {
  return {
    ...regel,
    vrije_voorraad: velden.vrije_voorraad ?? undefined,
    besteld_inkoop: velden.besteld_inkoop ?? undefined,
    is_pseudo: velden.is_pseudo ?? undefined,
    is_dropship: velden.is_dropship ?? undefined,
  }
}

/**
 * Eén handmatige allocatie-keuze gekoppeld aan een orderregel — uitwisselbaar
 * (omstickeren) óf een inkooporder-claim (eigen of equivalent artikel, mig
 * 491-492). `bron`/`inkooporder_regel_id` zijn nodig om een IO-keuze niet per
 * ongeluk als voorraad-keuze te hydrateren bij het opnieuw opslaan.
 */
export interface OrderHydratieKeuze {
  order_regel_id: number
  bron?: 'voorraad' | 'inkooporder_regel'
  artikelnr: string
  aantal: number
  omschrijving?: string | null
  inkooporder_regel_id?: number | null
  verwacht_datum?: string | null
}

/**
 * Hydrateert de regels van een bestaande Order naar form-state voor de
 * bewerk-flow. Draagt alle bewaarde regel-velden over én — via
 * `metProductVelden` — de display-only producten-velden uit de
 * `fetchOrderRegels`-join, zodat `berekenRegelDekking` in de bewerk-flow
 * dezelfde dekking ziet als in de aanmaak-flow. Handmatige uitwisselbaar-
 * claims worden gerehydrateerd naar `uitwisselbaar_keuzes` (omstickeren).
 */
export function hydrateerOrderRegels(
  regels: OrderRegel[],
  handmatigeKeuzes: OrderHydratieKeuze[],
): OrderRegelFormData[] {
  // Groepeer handmatige keuzes per orderregel-id.
  const keuzesPerRegel = new Map<number, OrderRegelFormData['uitwisselbaar_keuzes']>()
  for (const k of handmatigeKeuzes) {
    const existing = keuzesPerRegel.get(k.order_regel_id) ?? []
    existing!.push({
      bron: k.bron,
      artikelnr: k.artikelnr,
      aantal: k.aantal,
      omschrijving: k.omschrijving ?? undefined,
      inkooporder_regel_id: k.inkooporder_regel_id ?? undefined,
      verwacht_datum: k.verwacht_datum ?? undefined,
    })
    keuzesPerRegel.set(k.order_regel_id, existing)
  }

  return regels.map((r) => {
    const basis: OrderRegelFormData = {
      id: r.id,
      artikelnr: r.artikelnr ?? undefined,
      karpi_code: r.karpi_code ?? undefined,
      omschrijving: r.omschrijving,
      omschrijving_2: r.omschrijving_2 ?? undefined,
      orderaantal: r.orderaantal,
      te_leveren: r.te_leveren,
      prijs: r.prijs ?? undefined,
      korting_pct: r.korting_pct,
      bedrag: r.bedrag ?? undefined,
      gewicht_kg: r.gewicht_kg ?? undefined,
      // Maatwerk
      is_maatwerk: r.is_maatwerk ?? false,
      maatwerk_vorm: r.maatwerk_vorm ?? undefined,
      maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? undefined,
      maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? undefined,
      maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? undefined,
      maatwerk_afwerking: r.maatwerk_afwerking ?? undefined,
      maatwerk_band_kleur: r.maatwerk_band_kleur ?? undefined,
      maatwerk_instructies: r.maatwerk_instructies ?? undefined,
      // Prijs-onderdelen — voor de maatwerk-breakdown-zin + herberekening.
      maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? undefined,
      maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? undefined,
      maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? undefined,
      maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? undefined,
      klant_referentie: r.klant_referentie ?? null,
      // Handmatige uitwisselbaar-claims gerehydrateerd (omstickeren).
      uitwisselbaar_keuzes: keuzesPerRegel.get(r.id) ?? [],
    }
    // Het regel-input-contract: producten-display-velden uit de join. Vóór deze
    // hydratie ontbraken vrije_voorraad/besteld_inkoop → vals IO-tekort.
    return metProductVelden(basis, {
      vrije_voorraad: r.vrije_voorraad,
      besteld_inkoop: r.besteld_inkoop,
      is_pseudo: r.is_pseudo,
      is_dropship: r.is_dropship,
    })
  })
}
