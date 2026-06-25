// Downloadt het bedrijfslogo uit Storage voor PDF-headers (pakbon + factuur).
// Eén plek voor de bucket/pad-defaults en de format-detectie zodat die niet uit
// elkaar driften tussen de factuur- en pakbon-renderers.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface BedrijfLogo {
  bytes: Uint8Array
  format: 'jpg' | 'png'
}

/** Best-effort: ontbreekt het logo of faalt de download, dan undefined (de PDF
 *  rendert dan het tekstmerk). Defaults: bucket 'public-assets', pad
 *  'karpi-logo.jpg'. */
export async function fetchBedrijfLogo(
  supabase: SupabaseClient,
  opts?: { bucket?: string; pad?: string },
): Promise<BedrijfLogo | undefined> {
  const bucket = opts?.bucket ?? 'public-assets'
  const pad = opts?.pad ?? 'karpi-logo.jpg'
  try {
    const dl = await supabase.storage.from(bucket).download(pad)
    if (!dl.data) return undefined
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    return { bytes, format: pad.toLowerCase().endsWith('.png') ? 'png' : 'jpg' }
  } catch {
    return undefined
  }
}
