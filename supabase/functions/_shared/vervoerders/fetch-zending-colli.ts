// Zending-colli-seam (CONTEXT.md: Zending-colli) — de ENIGE plek die de colli
// van een zending ophaalt en beslist welke kolommen canoniek zijn. Álle
// vervoerder-adapters (HST, Verhoek, Rhenus) en de proef-xml-scripts lezen via
// deze functie; ze herleiden afmetingen/gewicht/omschrijving nooit zelf uit de
// live `order_regels → producten`-join.
//
// Achtergrond: afmetingen komen uit de BEVROREN zending_colli-snapshot
// (mig 399, lengte_cm/breedte_cm = COALESCE(maatwerk_*, product_*) op moment
// van colli-aanmaak) — dezelfde rij die label en pakbon lezen. Vóór deze seam
// leefde de query+mapping op VIJF plekken; een bron-wijziging (zoals mig 399)
// was daardoor een N-plekken-edit die een stale checkout of een vergeten
// adapter stilletjes kon missen. Eén laag boven de [[Labelbarcode]]-seam,
// zelfde patroon.
//
// Mig 420: filtert bundel_colli_id IS NULL — gebundelde kind-colli (Rhenus
// colli-bundeling) vallen uit het bericht; de bundel-rij gaat als 1 collo mee.
//
// NIET puur (raakt de DB) → edge-only, geen cross-root-deling met de frontend
// (ADR-0033); die heeft zijn eigen printset-pad. Neemt een SupabaseClient.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Canonieke superset-shape: bevat alles wat één van de adapters nodig heeft.
// Een adapter die minder gebruikt (Rhenus geen omschrijving/artikelnr, HST geen
// dims) negeert de extra velden — structurele subtype-compatibiliteit laat de
// per-adapter colli-input-types dit zonder map accepteren.
export interface ZendingColli {
  colli_nr: number;
  sscc: string | null;
  gewicht_kg: number | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
  omschrijving_snapshot: string | null;
  artikelnr: string | null;
  // Mig 485: pallet-type van een bundel-rij (EP/SP voor HST, PLTS/HPLT voor Rhenus
  // sinds mig 489). NULL voor losse colli en niet-pallet-bundels. HST mapt dit op
  // PackageUnitID; Rhenus op packageTypeCode; Verhoek negeert het.
  pallet_type: string | null;
  // Mig 490: laadhoogte (cm) van een Rhenus-pallet-bundel → <dimension><height>.
  // NULL voor rollen/los/HST.
  hoogte_cm: number | null;
}

export interface FetchZendingColliResult {
  colli: ZendingColli[];
  /** Query-foutmelding, of `null` bij succes. De caller beslist zelf wat een
   *  fout betekent (markFout met eigen tekst) — deze seam haalt alleen op. */
  error: string | null;
}

// Eén canonieke kolomlijst. De `order_regels:order_regel_id ( artikelnr )`-embed
// gebruikt de expliciete FK-kolom-alias tegen PGRST201 (zelfde hint die Verhoek
// al draaide). Colli zonder order_regel_id → artikelnr null, géén drop van rijen.
const COLLI_SELECT =
  'colli_nr, sscc, gewicht_kg, lengte_cm, breedte_cm, hoogte_cm, omschrijving_snapshot, pallet_type, ' +
  'order_regels:order_regel_id ( artikelnr )';

export async function fetchZendingColli(
  supabase: SupabaseClient,
  zendingId: number,
): Promise<FetchZendingColliResult> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select(COLLI_SELECT)
    .eq('zending_id', zendingId)
    // Mig 420: gebundelde kind-colli horen niet in het carrier-bericht; alleen
    // losse colli + bundel-rijen (die hun eigen SSCC dragen).
    .is('bundel_colli_id', null)
    .order('colli_nr', { ascending: true });
  if (error) return { colli: [], error: error.message };

  // deno-lint-ignore no-explicit-any
  const colli: ZendingColli[] = ((data ?? []) as any[]).map((r) => ({
    colli_nr: r.colli_nr,
    sscc: r.sscc,
    gewicht_kg: r.gewicht_kg,
    lengte_cm: r.lengte_cm,
    breedte_cm: r.breedte_cm,
    omschrijving_snapshot: r.omschrijving_snapshot,
    artikelnr: r.order_regels?.artikelnr ?? null,
    pallet_type: r.pallet_type ?? null,
    hoogte_cm: r.hoogte_cm ?? null,
  }));
  return { colli, error: null };
}
