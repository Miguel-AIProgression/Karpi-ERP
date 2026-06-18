// frontend/src/modules/magazijn/queries/pickronde.ts
import { supabase } from '@/lib/supabase/client'

export type NietGevondenModus = 'blokkeer' | 'splits'

export interface MarkeerNietGevondenArgs {
  colliId: number
  modus: NietGevondenModus
  opmerking?: string | null
  pickerId: number | null
}

export async function startPickronde(orderId: number, pickerId: number): Promise<number> {
  const { data, error } = await supabase.rpc('start_pickronde', {
    p_order_id: orderId,
    p_picker_id: pickerId,
  })
  if (error) throw toError(error, 'Pickronde starten mislukt')
  return Number(data)
}

export async function markeerColliNietGevonden(
  args: MarkeerNietGevondenArgs
): Promise<void> {
  const { error } = await supabase.rpc('markeer_colli_niet_gevonden', {
    p_zending_colli_id: args.colliId,
    p_modus: args.modus,
    p_opmerking: args.opmerking ?? null,
    p_picker_id: args.pickerId,
  })
  if (error) throw toError(error, 'Markeren niet-gevonden mislukt')
}

export async function voltooiPickronde(
  zendingId: number,
  pickerId: number | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('voltooi_pickronde', {
    p_zending_id: zendingId,
    p_picker_id: pickerId,
  })
  if (error) throw toError(error, 'Pickronde voltooien mislukt')
  return Number(data)
}

/** Per-zending-uitkomst van de bulk-afrond-RPC (mig 412). */
export interface VoltooiPickrondeUitkomst {
  zending_id: number
  zending_nr: string | null
  /** TRUE = afgerond naar 'Klaar voor verzending'; FALSE = overgeslagen (zie reden). */
  ok: boolean
  /** Reden bij ok=FALSE (bv. openstaand pick-probleem of al voltooid). */
  reden: string | null
}

// Mig 412: rondt meerdere pickrondes (zendingen status 'Picken') in één call af.
// De RPC slaat per-zending fouten (pick-probleem / al voltooid) over i.p.v. de
// hele batch te laten falen, dus we throwen alleen bij een harde RPC-fout en
// geven anders de per-zending-uitkomsten terug zodat de caller kan rapporteren.
export async function voltooiPickrondes(
  zendingIds: number[],
  pickerId: number | null,
): Promise<VoltooiPickrondeUitkomst[]> {
  const { data, error } = await supabase.rpc('voltooi_pickronden', {
    p_zending_ids: zendingIds,
    p_picker_id: pickerId,
  })
  if (error) throw toError(error, 'Pickrondes voltooien mislukt')
  return (
    (data ?? []) as Array<{
      zending_id: number | string
      zending_nr: string | null
      ok: boolean
      reden: string | null
    }>
  ).map((r) => ({
    zending_id: Number(r.zending_id),
    zending_nr: r.zending_nr,
    ok: r.ok,
    reden: r.reden,
  }))
}

// Mig 398: draait een nog-niet-gepickte pickronde terug. Verwijdert de zending
// en zet de betrokken order(s) terug naar 'Klaar voor picken'. Backend weigert
// als er al gepickt is of de zending niet meer status 'Picken' heeft.
export async function annuleerPickronde(
  zendingId: number,
  reden?: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('annuleer_pickronde', {
    p_zending_id: zendingId,
    p_reden: reden ?? null,
  })
  if (error) throw toError(error, 'Pickronde terugdraaien mislukt')
  return Number(data)
}

// Colli-fetch voor de pick-vinkjes-UI.
export interface PickColliRij {
  id: number
  colli_nr: number
  sscc: string | null
  pick_uitkomst: 'open' | 'gepickt' | 'niet_gevonden'
  pick_opmerking: string | null
  omschrijving_snapshot: string | null
}

export async function fetchColliVoorZending(zendingId: number): Promise<PickColliRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select('id, colli_nr, sscc, pick_uitkomst, pick_opmerking, omschrijving_snapshot')
    .eq('zending_id', zendingId)
    // Mig 421: de synthetische bundel-rij (is_bundel=TRUE) is geen fysiek pick-item —
    // je verzamelt de kind-colli, niet de zak. Die rij weglaten houdt de pick-vinkjes
    // schoon (de gebundelde kinderen blijven gewoon afvinkbaar).
    .eq('is_bundel', false)
    .order('colli_nr', { ascending: true })

  if (error) throw toError(error, 'Colli ophalen mislukt')
  return (data ?? []) as PickColliRij[]
}

export interface PickProbleemRij {
  colli_id: number
  zending_id: number
  zending_nr: string
  order_nr: string
  klant_naam: string | null
  omschrijving_snapshot: string | null
  pick_opmerking: string | null
}

export async function fetchPickProblemen(): Promise<PickProbleemRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select(`
      id, pick_opmerking, omschrijving_snapshot,
      zending_id,
      zendingen!inner (
        zending_nr, status,
        orders!zendingen_order_id_fkey!inner (
          order_nr,
          debiteuren:debiteuren!orders_debiteur_nr_fkey ( naam )
        )
      )
    `)
    .eq('pick_uitkomst', 'niet_gevonden')
    .eq('zendingen.status', 'Picken')

  if (error) throw toError(error, 'Pick-problemen ophalen mislukt')
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: number
      pick_opmerking: string | null
      omschrijving_snapshot: string | null
      zending_id: number
      zendingen: {
        zending_nr: string
        orders: { order_nr: string; debiteuren?: { naam: string | null } | null }
      }
    }
    return {
      colli_id: r.id,
      zending_id: r.zending_id,
      zending_nr: r.zendingen.zending_nr,
      order_nr: r.zendingen.orders.order_nr,
      klant_naam: r.zendingen.orders.debiteuren?.naam ?? null,
      omschrijving_snapshot: r.omschrijving_snapshot,
      pick_opmerking: r.pick_opmerking,
    }
  })
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return new Error(`${fallback}: ${parts.join(' ')}`)
  }
  return new Error(`${fallback}: ${String(error)}`)
}
