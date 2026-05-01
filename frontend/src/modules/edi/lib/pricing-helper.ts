import { supabase } from '@/lib/supabase/client'

interface OrderRegelForPricing {
  id: number
  artikelnr: string | null
  orderaantal: number | null
}

export async function herprijsEdiOrderUitPrijslijst(orderId: number): Promise<number> {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('debiteur_nr')
    .eq('id', orderId)
    .single()
  if (orderErr) throw orderErr
  if (!order?.debiteur_nr) return 0

  const { data: debiteur, error: debErr } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr, korting_pct')
    .eq('debiteur_nr', order.debiteur_nr)
    .single()
  if (debErr) throw debErr
  if (!debiteur?.prijslijst_nr) return 0

  const { data: regels, error: regelsErr } = await supabase
    .from('order_regels')
    .select('id, artikelnr, orderaantal')
    .eq('order_id', orderId)
  if (regelsErr) throw regelsErr

  const orderRegels = (regels ?? []) as OrderRegelForPricing[]
  const artikelnrs = [...new Set(orderRegels.map((r) => r.artikelnr).filter(Boolean))] as string[]
  if (artikelnrs.length === 0) return 0

  const { data: prijzen, error: prijzenErr } = await supabase
    .from('prijslijst_regels')
    .select('artikelnr, prijs')
    .eq('prijslijst_nr', debiteur.prijslijst_nr)
    .in('artikelnr', artikelnrs)
  if (prijzenErr) throw prijzenErr

  const prijsPerArtikel = new Map(
    (prijzen ?? []).map((row) => [row.artikelnr as string, Number(row.prijs)]),
  )
  const kortingPct = Number(debiteur.korting_pct ?? 0)
  let updated = 0

  for (const regel of orderRegels) {
    if (!regel.artikelnr) continue
    const prijs = prijsPerArtikel.get(regel.artikelnr)
    if (prijs == null) continue
    const aantal = Number(regel.orderaantal ?? 0)
    const bedrag = Math.round(prijs * aantal * (1 - kortingPct / 100) * 100) / 100
    const { error } = await supabase
      .from('order_regels')
      .update({ prijs, korting_pct: kortingPct, bedrag })
      .eq('id', regel.id)
    if (error) throw error
    updated += 1
  }

  return updated
}

export async function zoekDebiteurOpGln(kandidaten: (string | null)[]): Promise<number | null> {
  for (const gln of kandidaten) {
    if (!gln) continue
    const variants = gln.endsWith('.0') ? [gln, gln.slice(0, -2)] : [gln, `${gln}.0`]
    const { data } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, status, prijslijst_nr')
      .in('gln_bedrijf', variants)

    const matches = data ?? []
    const preferred =
      matches.find((d) => d.status === 'Actief' && d.prijslijst_nr) ??
      matches.find((d) => d.status === 'Actief') ??
      matches.find((d) => d.prijslijst_nr) ??
      matches[0]

    if (preferred?.debiteur_nr) return preferred.debiteur_nr
  }
  return null
}
