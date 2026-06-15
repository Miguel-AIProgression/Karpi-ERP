// Best-effort track & trace-resolutie per vervoerder voor de verzendbevestiging-
// mail. De vervoerder verstuurt zelf de T&T-mail; wij nemen het trackingnummer
// (indien beschikbaar) óók op in de Karpi-verzendbevestiging zodat de klant het
// daar terugvindt.
//
// OPEN PUNT (niet blokkerend): de publieke T&T-URL-template per vervoerder is nog
// niet bevestigd — daarom tonen we voorlopig het trackingnummer als tekst
// (`url: null`). Zodra een template bekend is, vullen we `url` hier in; de mail-
// renderer toont dan automatisch een klikbare link.

// deno-lint-ignore no-explicit-any
type SbClient = any

export interface TrackTrace {
  /** Trackingnummer/-code zoals de klant het bij de vervoerder kan opzoeken. */
  nummer: string
  /** Publieke T&T-URL, of null als (nog) onbekend → toon nummer als tekst. */
  url: string | null
  vervoerder: string | null
}

export interface TrackTraceZending {
  id: number
  vervoerder_code: string | null
  track_trace: string | null
}

/**
 * Probeert een trackingnummer te vinden voor een zending. Volgorde:
 *   1. zendingen.track_trace (door de vervoerder-koppeling teruggeschreven)
 *   2. HST: hst_transportorders.extern_tracking_number
 *   3. Verhoek: verhoek_transportorders.track_trace_id
 * Geeft `null` als er (nog) geen tracking is — de mail blijft dan geldig.
 */
export async function resolveTrackTrace(
  sb: SbClient,
  zending: TrackTraceZending,
): Promise<TrackTrace | null> {
  const vervoerder = zending.vervoerder_code ?? null

  const direct = (zending.track_trace ?? '').trim()
  if (direct) return { nummer: direct, url: null, vervoerder }

  // HST
  try {
    const { data } = await sb
      .from('hst_transportorders')
      .select('extern_tracking_number')
      .eq('zending_id', zending.id)
      .not('extern_tracking_number', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nr = (data?.extern_tracking_number ?? '').trim?.() ?? ''
    if (nr) return { nummer: nr, url: null, vervoerder }
  } catch {
    // tabel/kolom niet beschikbaar — geen blokkade
  }

  // Verhoek
  try {
    const { data } = await sb
      .from('verhoek_transportorders')
      .select('track_trace_id')
      .eq('zending_id', zending.id)
      .not('track_trace_id', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nr = (data?.track_trace_id ?? '').trim?.() ?? ''
    if (nr) return { nummer: nr, url: null, vervoerder }
  } catch {
    // geen Verhoek-tabel — geen blokkade
  }

  return null
}
