import { landNaarIso2 } from '@/lib/utils/land-vlag'

// HST-depotnummer per afleverpostcode.
//
// Bron: "Postcodeverdeling NL+BE.xlsx" (door HST aangeleverd, 2026-06-17); de
// NL-tabel is geverifieerd tegen de bijgewerkte verdeler "Map1.xlsx" (periode
// vanaf 2026-07-01) — alle 85 NL-ranges identiek, geen wijziging. HST
// sorteert binnenkomende colli op depot op basis van de afleverpostcode; ze
// willen dat depotnummer ZELF op het etiket zien dat Karpi print en plakt.
// Print-only: het depot zit NIET in de HST-API-payload — HST scant alleen de
// SSCC-barcode (zie mig 175-instellingen + hst-send/payload-builder). Daarom
// leeft deze lookup puur in de frontend label-laag; geen DB/edge nodig.
//
// Lookup: de eerste 4 cijfers van de postcode (NL '7122 LB' → 7122, BE '1000'
// → 1000) binnen een [van, tot]-range (grenzen inclusief). Per land een eigen
// ranges-tabel; de tabellen zijn niet-overlappend en dekken de hele 1000-9999.
// Werk deze tabellen bij wanneer HST een nieuwe postcodeverdeling stuurt.

/** [van, tot, depot] — 4-cijferige postcode-ondergrens/bovengrens (inclusief). */
type DepotRange = readonly [van: number, tot: number, depot: number]

const NL_DEPOTS: readonly DepotRange[] = [
  [1000, 1012, 10],
  [1013, 1014, 17],
  [1015, 1019, 10],
  [1020, 1039, 17],
  [1040, 1040, 10],
  [1041, 1047, 17],
  [1048, 1066, 10],
  [1067, 1067, 17],
  [1068, 1119, 10],
  [1120, 1159, 17],
  [1160, 1439, 10],
  [1440, 1789, 17],
  [1790, 1799, 17],
  [1800, 2099, 17],
  [2100, 2899, 27],
  [2900, 3399, 33],
  [3400, 3409, 41],
  [3410, 3411, 27],
  [3412, 3413, 41],
  [3414, 3429, 27],
  [3430, 3439, 41],
  [3440, 3449, 27],
  [3450, 3459, 39],
  [3460, 3479, 27],
  [3480, 3599, 39],
  [3600, 3699, 10],
  [3700, 3749, 39],
  [3750, 3754, 74],
  [3755, 3759, 10],
  [3760, 3769, 39],
  [3770, 3889, 74],
  [3890, 3899, 10],
  [3900, 3979, 39],
  [3980, 4299, 41],
  [4300, 4799, 46],
  [4800, 4869, 52],
  [4870, 4899, 46],
  [4900, 5299, 52],
  [5300, 5499, 41],
  [5500, 5599, 60],
  [5600, 5699, 52],
  [5700, 6499, 60],
  [6500, 6699, 41],
  [6700, 6729, 39],
  [6730, 6739, 74],
  [6740, 6790, 39],
  [6791, 6899, 74],
  [6900, 6919, 75],
  [6920, 6939, 74],
  [6940, 6949, 75],
  [6950, 6979, 74],
  [6980, 6989, 75],
  [6990, 6995, 74],
  [6996, 7199, 75],
  [7200, 7219, 74],
  [7220, 7229, 75],
  [7230, 7239, 74],
  [7240, 7279, 75],
  [7280, 7469, 74],
  [7470, 7739, 75],
  [7740, 7769, 84],
  [7770, 7799, 75],
  [7800, 8049, 84],
  [8050, 8059, 74],
  [8060, 8069, 84],
  [8070, 8145, 74],
  [8146, 8159, 75],
  [8160, 8199, 74],
  [8200, 8259, 10],
  [8260, 8399, 84],
  [8400, 8409, 98],
  [8410, 8439, 84],
  [8440, 8469, 98],
  [8470, 8489, 84],
  [8490, 8879, 98],
  [8880, 8899, 98],
  [8900, 9159, 98],
  [9160, 9166, 98],
  [9167, 9329, 98],
  [9330, 9349, 84],
  [9350, 9399, 98],
  [9400, 9489, 84],
  [9490, 9499, 98],
  [9500, 9589, 84],
  [9590, 9999, 98],
]

const BE_DEPOTS: readonly DepotRange[] = [
  [1000, 1999, 90],
  [2000, 2199, 20],
  [2200, 2299, 30],
  [2300, 2399, 52],
  [2400, 2499, 30],
  [2500, 2899, 20],
  [2900, 2999, 20],
  [3000, 3499, 20],
  [3500, 3600, 30],
  [3601, 3789, 60],
  [3790, 3799, 44],
  [3800, 3899, 30],
  [3900, 3944, 60],
  [3945, 3945, 30],
  [3946, 3969, 60],
  [3970, 3980, 30],
  [3981, 3999, 60],
  [4000, 4999, 44],
  [5000, 6599, 77],
  [6600, 6999, 26],
  [7000, 7499, 77],
  [7500, 7699, 77],
  [7700, 7799, 26],
  [7800, 7999, 77],
  [8000, 8999, 20],
  [9000, 9999, 90],
]

const DEPOT_TABELLEN: Record<string, readonly DepotRange[]> = {
  NL: NL_DEPOTS,
  BE: BE_DEPOTS,
}

/** Eerste 4 cijfers van de postcode als getal, of null bij <4 cijfers. */
function postcodeCijfers(postcode: string | null | undefined): number | null {
  if (!postcode) return null
  const cijfers = postcode.replace(/\D/g, '').slice(0, 4)
  if (cijfers.length < 4) return null
  return Number(cijfers)
}

/**
 * HST-depotnummer voor een afleverpostcode + land, of `null` als er geen depot
 * te bepalen is (onbekend/ongeldig land, onleesbare postcode, of geen range-
 * match). Land mag ISO-2 ('NL') of vrije naam ('Nederland') zijn — genormali-
 * seerd via de gedeelde land-seam. Returnt het kale depotnummer als string; de
 * presentatie ('Depot 74') doet de label-component.
 */
export function hstDepotVoorPostcode(
  postcode: string | null | undefined,
  land: string | null | undefined,
): string | null {
  const pc = postcodeCijfers(postcode)
  if (pc === null) return null

  const iso = landNaarIso2(land)
  if (!iso) return null

  const tabel = DEPOT_TABELLEN[iso]
  if (!tabel) return null

  const match = tabel.find(([van, tot]) => pc >= van && pc <= tot)
  return match ? String(match[2]) : null
}
