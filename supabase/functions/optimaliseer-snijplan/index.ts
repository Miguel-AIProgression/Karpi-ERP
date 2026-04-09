// Supabase Edge Function: optimaliseer-snijplan
// FFDH (First Fit Decreasing Height) 2D strip-packing algorithm
// for optimal placement of carpet pieces on rolls.
//
// Expects tables: snijvoorstellen, snijvoorstel_plaatsingen
// Uses view: snijplanning_overzicht
// Uses table: rollen

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnijplanPiece {
  id: number
  lengte_cm: number
  breedte_cm: number
  maatwerk_vorm: string | null
  order_nr: string | null
  klant_naam: string | null
  afleverdatum: string | null
  area_cm2: number
}

interface Roll {
  id: number
  rolnummer: string
  lengte_cm: number
  breedte_cm: number
  status: string
  oppervlak_m2: number
  sort_priority: number // 1=reststuk, 2=beschikbaar
  is_exact: boolean     // true = exact kwaliteit match, false = uitwisselbaar
}

interface Shelf {
  y: number         // Y position (top of shelf)
  height: number    // tallest piece on this shelf
  usedWidth: number // how much X is consumed
  maxWidth: number  // = roll width
}

interface Placement {
  snijplan_id: number
  positie_x_cm: number
  positie_y_cm: number
  lengte_cm: number   // placed width dimension (along X)
  breedte_cm: number  // placed height dimension (along Y)
  geroteerd: boolean
}

interface RollResult {
  rol_id: number
  rolnummer: string
  rol_lengte_cm: number
  rol_breedte_cm: number
  rol_status: string
  plaatsingen: Placement[]
  gebruikte_lengte_cm: number
  afval_percentage: number
  restlengte_cm: number
}

interface UnplacedPiece {
  snijplan_id: number
  reden: string
}

// ---------------------------------------------------------------------------
// FFDH strip-packing algorithm
// ---------------------------------------------------------------------------

/**
 * Check of minstens één toekomstig stuk (in enige orientatie) past in een gat
 * van `gapWidth` breed en `shelfHeight` hoog.
 */
function gapIsUseful(
  gapWidth: number,
  shelfHeight: number,
  futurePieces: SnijplanPiece[],
): boolean {
  return futurePieces.some(p =>
    (p.lengte_cm <= gapWidth && p.breedte_cm <= shelfHeight) ||
    (p.breedte_cm <= gapWidth && p.lengte_cm <= shelfHeight)
  )
}

/**
 * Try to place a single piece on a roll using FFDH with lookahead scoring.
 *
 * Axes:
 *   X = across roll width (breedte)
 *   Y = along roll length (lengte)
 *
 * Scoring tiers (lower = better):
 *   0: Perfect fit (remaining width = 0)
 *   1: Existing shelf, gap fillable by future piece
 *   2: New shelf, gap fillable by future piece
 *   3: Existing shelf, unusable gap
 *   4: New shelf, unusable gap
 * Tiebreakers: least height waste, then least width waste.
 */
function tryPlacePiece(
  piece: SnijplanPiece,
  shelves: Shelf[],
  rollWidth: number,
  rollLength: number,
  futurePieces: SnijplanPiece[],
): Placement | null {
  // Two orientations to try
  const orientations: Array<{
    w: number   // width along X
    h: number   // height along Y
    rotated: boolean
  }> = [
    { w: piece.lengte_cm, h: piece.breedte_cm, rotated: false },
    { w: piece.breedte_cm, h: piece.lengte_cm, rotated: true },
  ]

  let bestPlacement: Placement | null = null
  let bestTier = Infinity
  let bestHeightWaste = Infinity
  let bestWidthWaste = Infinity

  for (const orient of orientations) {
    // Skip if piece wider than roll
    if (orient.w > rollWidth) continue

    // 1. Try existing shelves
    for (const shelf of shelves) {
      if (orient.h <= shelf.height && shelf.usedWidth + orient.w <= shelf.maxWidth) {
        const remaining = shelf.maxWidth - shelf.usedWidth - orient.w
        const heightWaste = shelf.height - orient.h
        const tier = remaining === 0 ? 0
          : gapIsUseful(remaining, shelf.height, futurePieces) ? 1
          : 3

        if (
          tier < bestTier ||
          (tier === bestTier && heightWaste < bestHeightWaste) ||
          (tier === bestTier && heightWaste === bestHeightWaste && remaining < bestWidthWaste)
        ) {
          bestTier = tier
          bestHeightWaste = heightWaste
          bestWidthWaste = remaining
          bestPlacement = {
            snijplan_id: piece.id,
            positie_x_cm: shelf.usedWidth,
            positie_y_cm: shelf.y,
            lengte_cm: orient.w,
            breedte_cm: orient.h,
            geroteerd: orient.rotated,
          }
        }
      }
    }

    // 2. Try creating a new shelf
    const totalShelfHeight = shelves.reduce(
      (sum, s) => Math.max(sum, s.y + s.height),
      0,
    )
    if (totalShelfHeight + orient.h <= rollLength && orient.w <= rollWidth) {
      const remaining = rollWidth - orient.w
      const heightWaste = 0 // new shelf matches piece height exactly
      const tier = remaining === 0 ? 0
        : gapIsUseful(remaining, orient.h, futurePieces) ? 2
        : 4

      if (
        tier < bestTier ||
        (tier === bestTier && heightWaste < bestHeightWaste) ||
        (tier === bestTier && heightWaste === bestHeightWaste && remaining < bestWidthWaste)
      ) {
        bestTier = tier
        bestHeightWaste = heightWaste
        bestWidthWaste = remaining
        bestPlacement = {
          snijplan_id: piece.id,
          positie_x_cm: 0,
          positie_y_cm: totalShelfHeight,
          lengte_cm: orient.w,
          breedte_cm: orient.h,
          geroteerd: orient.rotated,
        }
      }
    }
  }

  return bestPlacement
}

/**
 * Run FFDH packing for a list of pieces onto a single roll.
 * Returns placed pieces and remaining unplaced pieces.
 */
function packRoll(
  pieces: SnijplanPiece[],
  rollWidth: number,
  rollLength: number,
): { placed: Placement[]; remaining: SnijplanPiece[] } {
  const shelves: Shelf[] = []
  const placed: Placement[] = []
  const remaining: SnijplanPiece[] = []
  const placedIds = new Set<number>()

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    // Lookahead: alleen toekomstige, nog niet geplaatste stukken
    const futurePieces = pieces.slice(i + 1).filter(p => !placedIds.has(p.id))
    const placement = tryPlacePiece(piece, shelves, rollWidth, rollLength, futurePieces)

    if (placement) {
      placed.push(placement)
      placedIds.add(piece.id)

      // Update or create shelf
      const existingShelf = shelves.find(
        (s) => s.y === placement.positie_y_cm,
      )
      if (existingShelf) {
        existingShelf.usedWidth += placement.lengte_cm
      } else {
        shelves.push({
          y: placement.positie_y_cm,
          height: placement.breedte_cm,
          usedWidth: placement.lengte_cm,
          maxWidth: rollWidth,
        })
      }
    } else {
      remaining.push(piece)
    }
  }

  return { placed, remaining }
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

/** Calculate actual area of a piece (accounting for round shapes). */
function pieceArea(p: Placement, vorm: string | null): number {
  if (vorm === 'rond') {
    const diameter = Math.min(p.lengte_cm, p.breedte_cm)
    return Math.PI * (diameter / 2) ** 2
  }
  return p.lengte_cm * p.breedte_cm
}

function calcRollStats(
  placements: Placement[],
  rollWidth: number,
  rollLength: number,
  pieceVormMap: Map<number, string | null>,
): { gebruikte_lengte_cm: number; afval_percentage: number; restlengte_cm: number } {
  if (placements.length === 0) {
    return { gebruikte_lengte_cm: 0, afval_percentage: 0, restlengte_cm: rollLength }
  }

  const gebruikte_lengte_cm = Math.max(
    ...placements.map((p) => p.positie_y_cm + p.breedte_cm),
  )

  const totalPieceArea = placements.reduce(
    (sum, p) => sum + pieceArea(p, pieceVormMap.get(p.snijplan_id) ?? null),
    0,
  )

  const usedRectArea = rollWidth * gebruikte_lengte_cm
  const afval_percentage =
    usedRectArea > 0
      ? Math.round((1 - totalPieceArea / usedRectArea) * 1000) / 10
      : 0

  const restlengte_cm = rollLength - gebruikte_lengte_cm

  return { gebruikte_lengte_cm, afval_percentage, restlengte_cm }
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ---- Auth & client setup ----
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ---- Parse & validate input ----
    const { kwaliteit_code, kleur_code, tot_datum } = await req.json()

    if (!kwaliteit_code || !kleur_code) {
      return new Response(
        JSON.stringify({
          error: 'kwaliteit_code en kleur_code zijn verplicht',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1: Fetch waiting snijplannen via the view ----
    let spQuery = supabase
      .from('snijplanning_overzicht')
      .select(
        'id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, order_nr, klant_naam, afleverdatum, kwaliteit_code, kleur_code',
      )
      .eq('status', 'Wacht')
      .eq('kwaliteit_code', kwaliteit_code)
      .eq('kleur_code', kleur_code)

    if (tot_datum) {
      // Include items with afleverdatum <= tot_datum OR afleverdatum IS NULL
      spQuery = spQuery.or(`afleverdatum.lte.${tot_datum},afleverdatum.is.null`)
    }

    const { data: snijplannen, error: spError } = await spQuery

    if (spError) throw spError

    if (!snijplannen || snijplannen.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Geen wachtende snijplannen gevonden voor ${kwaliteit_code} / ${kleur_code}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1b: Find interchangeable quality codes via collecties ----
    // Kwaliteiten in the same collectie are interchangeable (same material, different name)
    const { data: kwaliteit } = await supabase
      .from('kwaliteiten')
      .select('code, collectie_id')
      .eq('code', kwaliteit_code)
      .maybeSingle()

    let uitwisselbareCodes: string[] = [kwaliteit_code]
    if (kwaliteit?.collectie_id) {
      const { data: verwant } = await supabase
        .from('kwaliteiten')
        .select('code')
        .eq('collectie_id', kwaliteit.collectie_id)
      if (verwant) {
        uitwisselbareCodes = verwant.map((k: { code: string }) => k.code)
      }
    }

    // ---- Step 1c: Fetch available rolls (exact + interchangeable) ----
    // kleur_code in rollen may have ".0" suffix (e.g. "13.0" vs "13")
    const kleurVariants = [kleur_code]
    if (!kleur_code.includes('.')) kleurVariants.push(`${kleur_code}.0`)
    if (kleur_code.endsWith('.0')) kleurVariants.push(kleur_code.replace('.0', ''))

    const { data: rollen, error: rolError } = await supabase
      .from('rollen')
      .select('id, rolnummer, lengte_cm, breedte_cm, status, oppervlak_m2, kwaliteit_code')
      .in('kwaliteit_code', uitwisselbareCodes)
      .in('kleur_code', kleurVariants)
      .in('status', ['beschikbaar', 'reststuk'])

    if (rolError) throw rolError

    if (!rollen || rollen.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Geen beschikbare rollen voor ${kwaliteit_code} ${kleur_code}` +
            (uitwisselbareCodes.length > 1
              ? ` (ook gezocht: ${uitwisselbareCodes.filter(c => c !== kwaliteit_code).join(', ')})`
              : ''),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 2: Sort pieces and rolls ----

    // Pieces: descending by max dimension (widest first), then by area
    const pieces: SnijplanPiece[] = snijplannen.map((sp: Record<string, unknown>) => ({
      id: sp.id as number,
      lengte_cm: sp.snij_lengte_cm as number,
      breedte_cm: sp.snij_breedte_cm as number,
      maatwerk_vorm: sp.maatwerk_vorm as string | null,
      order_nr: sp.order_nr as string | null,
      klant_naam: sp.klant_naam as string | null,
      afleverdatum: sp.afleverdatum as string | null,
      area_cm2: (sp.snij_lengte_cm as number) * (sp.snij_breedte_cm as number),
    }))
    pieces.sort((a, b) => {
      const maxA = Math.max(a.lengte_cm, a.breedte_cm)
      const maxB = Math.max(b.lengte_cm, b.breedte_cm)
      if (maxB !== maxA) return maxB - maxA  // widest first
      return b.area_cm2 - a.area_cm2         // then by area
    })

    // Build a lookup: snijplan_id -> maatwerk_vorm (for area calculations)
    const pieceVormMap = new Map<number, string | null>(
      pieces.map((p) => [p.id, p.maatwerk_vorm]),
    )

    // Rolls: reststukken first (ascending area), then beschikbaar (ascending area)
    // Rolls: exact kwaliteit first, then interchangeable. Within each: reststuk first, then smallest.
    const sortedRolls: Roll[] = rollen
      .map((r: Record<string, unknown>) => ({
        id: r.id as number,
        rolnummer: r.rolnummer as string,
        lengte_cm: r.lengte_cm as number,
        breedte_cm: r.breedte_cm as number,
        status: r.status as string,
        oppervlak_m2: r.oppervlak_m2 as number,
        sort_priority: (r.status as string) === 'reststuk' ? 1 : 2,
        is_exact: (r.kwaliteit_code as string) === kwaliteit_code,
      }))
      .sort((a, b) => {
        // 1. Exact kwaliteit match first
        if (a.is_exact !== b.is_exact) return a.is_exact ? -1 : 1
        // 2. Reststuk before beschikbaar
        if (a.sort_priority !== b.sort_priority) return a.sort_priority - b.sort_priority
        // 3. Smallest area first
        return a.lengte_cm * a.breedte_cm - b.lengte_cm * b.breedte_cm
      })

    // ---- Step 3: FFDH packing across rolls ----
    let unplacedPieces = [...pieces]
    const rollResults: RollResult[] = []

    for (const roll of sortedRolls) {
      if (unplacedPieces.length === 0) break

      const { placed, remaining } = packRoll(
        unplacedPieces,
        roll.breedte_cm, // X axis = roll width
        roll.lengte_cm,  // Y axis = roll length
      )

      if (placed.length > 0) {
        const stats = calcRollStats(
          placed,
          roll.breedte_cm,
          roll.lengte_cm,
          pieceVormMap,
        )

        rollResults.push({
          rol_id: roll.id,
          rolnummer: roll.rolnummer,
          rol_lengte_cm: roll.lengte_cm,
          rol_breedte_cm: roll.breedte_cm,
          rol_status: roll.status,
          plaatsingen: placed,
          ...stats,
        })
      }

      unplacedPieces = remaining
    }

    const nietGeplaatst: UnplacedPiece[] = unplacedPieces.map((p) => ({
      snijplan_id: p.id,
      reden: 'Geen rol met voldoende ruimte',
    }))

    // ---- Step 4: Calculate summary ----
    const totaalGeplaatst = rollResults.reduce(
      (sum, r) => sum + r.plaatsingen.length,
      0,
    )

    const totaalM2Gebruikt = rollResults.reduce((sum, r) => {
      return (
        sum +
        (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000
      )
    }, 0)

    const totaalM2Afval = rollResults.reduce((sum, r) => {
      const usedArea = (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000
      return sum + usedArea * (r.afval_percentage / 100)
    }, 0)

    const gemiddeldAfvalPct =
      rollResults.length > 0
        ? Math.round(
            (rollResults.reduce((s, r) => s + r.afval_percentage, 0) /
              rollResults.length) *
              10,
          ) / 10
        : 0

    // ---- Step 5: Save to database ----

    // 5a. Get voorstel_nr
    const { data: nrData, error: nrError } = await supabase.rpc(
      'volgend_nummer',
      { p_type: 'SNIJV' },
    )
    if (nrError) throw nrError
    const voorstel_nr = nrData as string

    // 5b. Insert snijvoorstel
    const { data: voorstel, error: vsError } = await supabase
      .from('snijvoorstellen')
      .insert({
        voorstel_nr,
        kwaliteit_code,
        kleur_code,
        totaal_stukken: pieces.length,
        totaal_rollen: rollResults.length,
        totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 100) / 100,
        totaal_m2_afval: Math.round(totaalM2Afval * 100) / 100,
        afval_percentage: gemiddeldAfvalPct,
        status: 'concept',
      })
      .select('id')
      .single()

    if (vsError) throw vsError

    const voorstel_id = voorstel.id

    // 5c. Insert all plaatsingen
    const plaatsingen = rollResults.flatMap((r) =>
      r.plaatsingen.map((p) => ({
        voorstel_id,
        rol_id: r.rol_id,
        snijplan_id: p.snijplan_id,
        positie_x_cm: p.positie_x_cm,
        positie_y_cm: p.positie_y_cm,
        lengte_cm: p.lengte_cm,
        breedte_cm: p.breedte_cm,
        geroteerd: p.geroteerd,
      })),
    )

    if (plaatsingen.length > 0) {
      const { error: plError } = await supabase
        .from('snijvoorstel_plaatsingen')
        .insert(plaatsingen)

      if (plError) throw plError
    }

    // ---- Build response ----
    const result = {
      voorstel_id,
      voorstel_nr,
      rollen: rollResults,
      niet_geplaatst: nietGeplaatst,
      samenvatting: {
        totaal_stukken: pieces.length,
        geplaatst: totaalGeplaatst,
        niet_geplaatst: nietGeplaatst.length,
        totaal_rollen: rollResults.length,
        gemiddeld_afval_pct: gemiddeldAfvalPct,
        totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 10) / 10,
        totaal_m2_afval: Math.round(totaalM2Afval * 10) / 10,
      },
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('optimaliseer-snijplan error:', message)

    return new Response(
      JSON.stringify({ error: `Interne fout: ${message}` }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
