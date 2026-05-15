import { supabase } from '../client'
import type { SelectedClient } from '@/components/orders/client-selector'
import type { PoMatchResultaat } from '@/lib/orders/po-prefill'

/** File -> base64 (zonder data:-prefix). */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export interface ParseKlantPoResultaat {
  match: PoMatchResultaat
}

export async function parseKlantPo(file: File): Promise<ParseKlantPoResultaat> {
  const pdf_base64 = await fileToBase64(file)
  const { data, error } = await supabase.functions.invoke('parse-klant-po', {
    body: { pdf_base64, bestandsnaam: file.name },
  })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context as Response | undefined
      if (ctx?.json) {
        const parsed = await ctx.json()
        if (parsed?.error) msg = parsed.error
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }
  return { match: (data as { match: PoMatchResultaat }).match }
}

/**
 * Haalt de volledige SelectedClient op bij een debiteur_nr. Spiegelt exact de
 * select + mapping van ClientSelector (frontend/src/components/orders/client-selector.tsx)
 * zodat prijslijst/korting/adres-logica in OrderForm identiek werkt.
 */
export async function fetchSelectedClientVoorPrefill(
  debiteurNr: number,
): Promise<SelectedClient | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select(
      'debiteur_nr, naam, adres, postcode, plaats, land, fact_naam, fact_adres, fact_postcode, fact_plaats, email_factuur, email_overig, vertegenw_code, prijslijst_nr, korting_pct, betaler, inkoopgroepen(naam), gratis_verzending, standaard_maat_werkdagen, maatwerk_weken, deelleveringen_toegestaan, default_lever_type',
    )
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { inkoopgroepen, ...rest } = data as unknown as Record<string, unknown> & {
    inkoopgroepen: { naam: string } | null
  }
  return {
    ...(rest as unknown as Omit<SelectedClient, 'inkooporganisatie'>),
    inkooporganisatie: inkoopgroepen?.naam ?? null,
  } as SelectedClient
}
