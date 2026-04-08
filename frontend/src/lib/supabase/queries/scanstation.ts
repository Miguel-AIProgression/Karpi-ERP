import { supabase } from '../client'
import type { ScannedItem, ScanActie } from '@/lib/types/productie'

/** Lookup a scancode in snijplannen first, then confectie_orders */
export async function lookupScancode(scancode: string): Promise<ScannedItem | null> {
  // Try snijplanning_overzicht first
  const { data: snijplan, error: snijErr } = await supabase
    .from('snijplanning_overzicht')
    .select('id, scancode, status, kwaliteit_code, kleur_code, snij_lengte_cm, snij_breedte_cm, klant_naam, order_nr, maatwerk_afwerking, product_omschrijving')
    .eq('scancode', scancode)
    .maybeSingle()

  if (snijErr) throw snijErr

  if (snijplan) {
    return {
      type: 'snijplan',
      id: snijplan.id,
      scancode: snijplan.scancode,
      status: snijplan.status,
      kwaliteit_code: snijplan.kwaliteit_code ?? '',
      kleur_code: snijplan.kleur_code ?? '',
      maat: `${snijplan.snij_breedte_cm}x${snijplan.snij_lengte_cm}`,
      klant_naam: snijplan.klant_naam,
      order_nr: snijplan.order_nr,
      afwerking: snijplan.maatwerk_afwerking,
    }
  }

  // Try confectie_overzicht
  const { data: confectie, error: confErr } = await supabase
    .from('confectie_overzicht')
    .select('id, scancode, status, kwaliteit_code, kleur_code, maatwerk_lengte_cm, maatwerk_breedte_cm, klant_naam, order_nr, maatwerk_afwerking, product_omschrijving')
    .eq('scancode', scancode)
    .maybeSingle()

  if (confErr) throw confErr

  if (confectie) {
    return {
      type: 'confectie',
      id: confectie.id,
      scancode: confectie.scancode,
      status: confectie.status,
      kwaliteit_code: confectie.kwaliteit_code,
      kleur_code: confectie.kleur_code,
      maat: `${confectie.maatwerk_breedte_cm ?? 0}x${confectie.maatwerk_lengte_cm ?? 0}`,
      klant_naam: confectie.klant_naam,
      order_nr: confectie.order_nr,
      afwerking: confectie.maatwerk_afwerking,
    }
  }

  return null
}

/** Insert a scan event (append-only log) */
export async function logScanEvent(
  scancode: string,
  actie: ScanActie,
  station: string,
  medewerker?: string
) {
  const { error } = await supabase
    .from('scan_events')
    .insert({ scancode, actie, station, medewerker: medewerker ?? null })

  if (error) throw error
}

/** Fetch items not yet 'Ingepakt' from snijplanning_overzicht (for openstaand table) */
export async function fetchOpenstaandItems() {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('id, scancode, status, kwaliteit_code, kleur_code, snij_lengte_cm, snij_breedte_cm, klant_naam, order_nr, maatwerk_afwerking, product_omschrijving')
    .in('status', ['Gesneden', 'In confectie', 'Gereed'])
    .order('order_nr', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    type: 'snijplan' as const,
    id: row.id,
    scancode: row.scancode,
    status: row.status,
    kwaliteit_code: row.kwaliteit_code ?? '',
    kleur_code: row.kleur_code ?? '',
    maat: `${row.snij_breedte_cm}x${row.snij_lengte_cm}`,
    klant_naam: row.klant_naam,
    order_nr: row.order_nr,
    afwerking: row.maatwerk_afwerking,
    product_omschrijving: row.product_omschrijving,
  }))
}

/** Mark a snijplan item as 'Ingepakt' and log the scan event */
export async function opboekenItem(snijplanId: number) {
  const { error } = await supabase
    .from('snijplannen')
    .update({ status: 'Ingepakt' })
    .eq('id', snijplanId)

  if (error) throw error
}
