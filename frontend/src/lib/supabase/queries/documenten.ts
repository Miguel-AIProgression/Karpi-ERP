import { supabase } from '../client'

export type DocumentKind = 'order' | 'inkooporder'

export interface DocumentItem {
  id: number
  bestandsnaam: string
  storage_path: string
  mime_type: string | null
  grootte_bytes: number | null
  omschrijving: string | null
  geupload_door: string | null
  geupload_op: string
}

const BUCKET = 'order-documenten'
const MAX_BYTES = 25 * 1024 * 1024

const TABLE: Record<DocumentKind, string> = {
  order: 'order_documenten',
  inkooporder: 'inkooporder_documenten',
}

const FK_COLUMN: Record<DocumentKind, string> = {
  order: 'order_id',
  inkooporder: 'inkooporder_id',
}

const PATH_PREFIX: Record<DocumentKind, string> = {
  order: 'orders',
  inkooporder: 'inkooporders',
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function buildStoragePath(kind: DocumentKind, parentId: number, originalName: string): string {
  const uuid = crypto.randomUUID()
  return `${PATH_PREFIX[kind]}/${parentId}/${uuid}-${sanitize(originalName)}`
}

export async function fetchDocumenten(
  kind: DocumentKind,
  parentId: number,
): Promise<DocumentItem[]> {
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('id, bestandsnaam, storage_path, mime_type, grootte_bytes, omschrijving, geupload_door, geupload_op')
    .eq(FK_COLUMN[kind], parentId)
    .order('geupload_op', { ascending: false })
  if (error) throw error
  return (data ?? []) as DocumentItem[]
}

export async function getDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 600)
  if (error) throw error
  return data.signedUrl
}

export async function uploadDocument(
  kind: DocumentKind,
  parentId: number,
  file: File,
  omschrijving?: string,
): Promise<DocumentItem> {
  if (file.size > MAX_BYTES) {
    throw new Error(`Bestand is te groot (max 25 MB). Dit bestand: ${(file.size / 1024 / 1024).toFixed(1)} MB`)
  }

  const path = buildStoragePath(kind, parentId, file.name)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) throw upErr

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const insertRow = {
    [FK_COLUMN[kind]]: parentId,
    bestandsnaam: file.name,
    storage_path: path,
    mime_type: file.type || null,
    grootte_bytes: file.size,
    omschrijving: omschrijving?.trim() || null,
    geupload_door: userId,
  }

  const { data, error } = await supabase
    .from(TABLE[kind])
    .insert(insertRow)
    .select('id, bestandsnaam, storage_path, mime_type, grootte_bytes, omschrijving, geupload_door, geupload_op')
    .single()

  if (error) {
    // Rollback storage-upload als DB-insert faalt
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data as DocumentItem
}

export async function deleteDocument(
  kind: DocumentKind,
  id: number,
  storagePath: string,
): Promise<void> {
  const { error: dbErr } = await supabase.from(TABLE[kind]).delete().eq('id', id)
  if (dbErr) throw dbErr
  const { error: storeErr } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (storeErr) throw storeErr
}

export async function updateDocumentOmschrijving(
  kind: DocumentKind,
  id: number,
  omschrijving: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE[kind])
    .update({ omschrijving: omschrijving.trim() || null })
    .eq('id', id)
  if (error) throw error
}
