import { supabase } from '../client'

export type BugMeldingStatus = 'Open' | 'Verwerkt' | 'Geaccepteerd'
export type BugUrgentie = 'Laag' | 'Middel' | 'Hoog'

export interface BugMelding {
  id: number
  titel: string
  omschrijving: string | null
  urgentie: BugUrgentie
  pagina_url: string | null
  status: BugMeldingStatus
  bijlage_path: string | null
  gemeld_door: string | null
  gemeld_door_email: string | null
  created_at: string
  updated_at: string
  verwerkt_op: string | null
  verwerkt_opgelost: string | null
  verwerkt_testen: string | null
  verwerkt_gezien_op: string | null
  geaccepteerd_op: string | null
}

const BUCKET = 'bug-bijlagen'
const MAX_BYTES = 10 * 1024 * 1024

const SELECT_COLS =
  'id, titel, omschrijving, urgentie, pagina_url, status, bijlage_path, gemeld_door, gemeld_door_email, created_at, updated_at, verwerkt_op, verwerkt_opgelost, verwerkt_testen, verwerkt_gezien_op, geaccepteerd_op'

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export interface NieuweBugMelding {
  titel: string
  omschrijving?: string
  urgentie?: BugUrgentie
  pagina_url?: string
  file?: File | null
}

export async function createBugMelding(input: NieuweBugMelding): Promise<BugMelding> {
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) throw new Error('Niet ingelogd')

  let bijlagePath: string | null = null
  if (input.file) {
    if (input.file.size > MAX_BYTES) {
      throw new Error(
        `Bestand is te groot (max 10 MB). Dit bestand: ${(input.file.size / 1024 / 1024).toFixed(1)} MB`,
      )
    }
    bijlagePath = `${user.id}/${crypto.randomUUID()}-${sanitize(input.file.name)}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(bijlagePath, input.file, {
        contentType: input.file.type || 'application/octet-stream',
        upsert: false,
      })
    if (upErr) throw upErr
  }

  const { data, error } = await supabase
    .from('bug_meldingen')
    .insert({
      titel: input.titel.trim(),
      omschrijving: input.omschrijving?.trim() || null,
      urgentie: input.urgentie ?? 'Middel',
      pagina_url: input.pagina_url ?? null,
      bijlage_path: bijlagePath,
      gemeld_door: user.id,
      gemeld_door_email: user.email ?? null,
    })
    .select(SELECT_COLS)
    .single()

  if (error) {
    // Rollback storage-upload als de DB-insert faalt
    if (bijlagePath) await supabase.storage.from(BUCKET).remove([bijlagePath])
    throw error
  }
  return data as BugMelding
}

/** Eigen meldingen, of (voor de beheerder) alle meldingen — RLS scoped het resultaat. */
export async function fetchBugMeldingen(): Promise<BugMelding[]> {
  const { data, error } = await supabase
    .from('bug_meldingen')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as BugMelding[]
}

/** Notitie-velden die de beheerder optioneel meegeeft bij het verwerken. */
export interface VerwerktNotitie {
  opgelost?: string
  testen?: string
}

export async function setBugStatus(
  id: number,
  status: BugMeldingStatus,
  notitie?: VerwerktNotitie,
): Promise<BugMelding> {
  const { data, error } = await supabase.rpc('set_bug_status', {
    p_id: id,
    p_status: status,
    p_opgelost: notitie?.opgelost?.trim() || null,
    p_testen: notitie?.testen?.trim() || null,
  })
  if (error) throw error
  return data as BugMelding
}

/** Markeert alle eigen Verwerkt-meldingen als gezien; dooft de teller rechtsboven. */
export async function markeerVerwerktGezien(): Promise<number> {
  const { data, error } = await supabase.rpc('markeer_verwerkt_gezien')
  if (error) throw error
  return (data as number) ?? 0
}

export async function getBugBijlageSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}
