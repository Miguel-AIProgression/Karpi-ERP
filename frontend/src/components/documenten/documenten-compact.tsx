import { useRef, useState } from 'react'
import {
  Paperclip, Upload, Trash2, FileText, Image as ImageIcon,
  ChevronDown, ChevronRight, Loader2, Plus,
} from 'lucide-react'
import {
  useDocumenten,
  useUploadDocument,
  useDeleteDocument,
} from '@/hooks/use-documenten'
import { getDocumentSignedUrl, type DocumentItem, type DocumentKind } from '@/lib/supabase/queries/documenten'

interface Props {
  kind: DocumentKind
  parentId: number | undefined
  className?: string
  /** Toon het paneel standaard uitgeklapt — handig in form-context. */
  defaultOpen?: boolean
}

const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,.txt,application/pdf,image/jpeg,image/png,image/webp'

export function DocumentenCompact({ kind, parentId, className, defaultOpen = false }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const { data: docs, isLoading } = useDocumenten(kind, parentId)
  const upload = useUploadDocument(kind, parentId)
  const remove = useDeleteDocument(kind, parentId)
  const [open, setOpen] = useState(defaultOpen)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const count = docs?.length ?? 0

  async function handleFiles(files: FileList | File[]) {
    setError(null)
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ file })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload mislukt')
        return
      }
    }
    setOpen(true)
  }

  function pickFiles(e: React.MouseEvent) {
    e.stopPropagation()
    fileInput.current?.click()
  }

  return (
    <div className={`text-sm ${className ?? ''}`}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (parentId) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!parentId) return
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] border transition-colors ${
          dragOver
            ? 'border-terracotta-300 bg-terracotta-50'
            : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!parentId}
          className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Paperclip size={13} className="text-slate-500" />
          <span className="font-medium">
            {count === 0 ? 'Documenten' : count === 1 ? '1 document' : `${count} documenten`}
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1">
          {upload.isPending && <Loader2 size={13} className="animate-spin text-slate-400" />}
          <button
            type="button"
            onClick={pickFiles}
            disabled={!parentId || upload.isPending}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-50 rounded"
            title={parentId ? 'Document toevoegen' : 'Eerst opslaan om bijlagen toe te voegen'}
          >
            {count === 0 ? (
              <>
                <Plus size={12} /> Toevoegen
              </>
            ) : (
              <>
                <Upload size={12} /> Upload
              </>
            )}
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <div className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {open && (
        <div className="mt-1 border border-slate-200 rounded-[var(--radius-sm)] bg-white">
          {isLoading ? (
            <div className="text-xs text-slate-400 px-3 py-3 text-center">Laden…</div>
          ) : count === 0 ? (
            <div className="text-xs text-slate-400 px-3 py-3 text-center">
              {parentId
                ? 'Sleep een PDF hierheen of klik op Toevoegen.'
                : 'Documenten kunnen pas worden toegevoegd nadat het record is opgeslagen.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs!.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  onDelete={() => remove.mutate({ id: d.id, storagePath: d.storage_path })}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function DocumentRow({ doc, onDelete }: { doc: DocumentItem; onDelete: () => void }) {
  const [opening, setOpening] = useState(false)

  async function open() {
    try {
      setOpening(true)
      const url = await getDocumentSignedUrl(doc.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setOpening(false)
    }
  }

  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      {doc.mime_type?.startsWith('image/') ? (
        <ImageIcon size={14} className="text-slate-400 shrink-0" />
      ) : (
        <FileText size={14} className="text-slate-400 shrink-0" />
      )}
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="flex-1 min-w-0 text-left text-xs text-slate-700 hover:text-terracotta-600 truncate"
        title={doc.bestandsnaam}
      >
        {doc.bestandsnaam}
      </button>
      <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
        {formatBytes(doc.grootte_bytes)}
      </span>
      <button
        type="button"
        onClick={() => {
          if (confirm(`"${doc.bestandsnaam}" verwijderen?`)) onDelete()
        }}
        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
        title="Verwijderen"
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
