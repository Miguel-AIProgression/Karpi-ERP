import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDocumenten,
  uploadDocument,
  deleteDocument,
  updateDocumentOmschrijving,
  type DocumentKind,
} from '@/lib/supabase/queries/documenten'

const queryKey = (kind: DocumentKind, parentId: number | undefined) =>
  ['documenten', kind, parentId] as const

export function useDocumenten(kind: DocumentKind, parentId: number | undefined) {
  return useQuery({
    queryKey: queryKey(kind, parentId),
    queryFn: () => fetchDocumenten(kind, parentId!),
    enabled: !!parentId,
  })
}

export function useUploadDocument(kind: DocumentKind, parentId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, omschrijving }: { file: File; omschrijving?: string }) => {
      if (!parentId) throw new Error('Geen parent-id beschikbaar')
      return uploadDocument(kind, parentId, file, omschrijving)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(kind, parentId) }),
  })
}

export function useDeleteDocument(kind: DocumentKind, parentId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, storagePath }: { id: number; storagePath: string }) =>
      deleteDocument(kind, id, storagePath),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(kind, parentId) }),
  })
}

export function useUpdateDocumentOmschrijving(
  kind: DocumentKind,
  parentId: number | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, omschrijving }: { id: number; omschrijving: string }) =>
      updateDocumentOmschrijving(kind, id, omschrijving),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(kind, parentId) }),
  })
}
