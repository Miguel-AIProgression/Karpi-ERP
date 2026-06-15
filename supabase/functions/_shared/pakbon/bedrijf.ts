// Haalt de bedrijfsgegevens (app_config 'bedrijfsgegevens') + logo op voor de
// pakbon-PDF. Spiegelt de logo/bedrijf-fetch van factuur-pdf/index.ts zodat de
// pakbon dezelfde header-bron deelt. Gedeeld door pakbon-pdf en
// stuur-verzendbevestiging.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { PakbonBedrijf } from './types.ts'
import type { PakbonPdfLogo } from './pakbon-pdf.ts'

interface BedrijfConfigRaw extends PakbonBedrijf {
  logo_storage_bucket?: string
  logo_storage_pad?: string
}

export interface BedrijfMetLogo {
  bedrijf: PakbonBedrijf
  logo?: PakbonPdfLogo
}

export async function fetchBedrijfMetLogo(supabase: SupabaseClient): Promise<BedrijfMetLogo> {
  const res = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'bedrijfsgegevens')
    .maybeSingle()
  if (res.error) throw new Error(`Fetch bedrijfsgegevens: ${res.error.message}`)
  if (!res.data?.waarde) {
    throw new Error('Bedrijfsgegevens ontbreken (app_config sleutel "bedrijfsgegevens")')
  }
  const raw = res.data.waarde as BedrijfConfigRaw

  // Logo best-effort — ontbreekt het, dan rendert de pakbon het tekstmerk.
  const bucket = raw.logo_storage_bucket ?? 'public-assets'
  const pad = raw.logo_storage_pad ?? 'karpi-logo.jpg'
  let logo: PakbonPdfLogo | undefined
  try {
    const dl = await supabase.storage.from(bucket).download(pad)
    if (dl.data) {
      const bytes = new Uint8Array(await dl.data.arrayBuffer())
      logo = { bytes, format: pad.toLowerCase().endsWith('.png') ? 'png' : 'jpg' }
    }
  } catch {
    // Geen logo — geen blokkade.
  }

  return { bedrijf: raw, logo }
}
