import { useRef, useState } from 'react'
import { Paperclip, Upload, Trash2, FileText, Image as ImageIcon } from 'lucide-react'

export interface BufferedDoc {
  id: string
  file: File
  omschrijving: string
}

interface Props {
  docs: BufferedDoc[]
  onChange: (docs: BufferedDoc[]) => void
  title?: string
  className?: string
}

const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,.txt,application/pdf,image/jpeg,image/png,image/webp'
const MAX_BYTES = 25 * 1024 * 1024

export function DocumentenBuffer({ docs, onChange, title = 'Documenten', className }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  function addFiles(files: FileList | File[]) {
    setError(null)
    const incoming: BufferedDoc[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" is groter dan 25 MB`)
        continue
      }
      incoming.push({ id: crypto.randomUUID(), file: f, omschrijving: '' })
    }
    if (incoming.length) onChange([...docs, ...incoming])
  }

  function remove(id: string) {
    onChange(docs.filter((d) => d.id !== id))
  }

  function setOmschrijving(id: string, value: string) {
    onChange(docs.map((d) => (d.id === id ? { ...d, omschrijving: value } : d)))
  }

  return (
    <section
      className={`bg-white rounded-[var(--radius)] border border-slate-200 p-5 ${className ?? ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium flex items-center gap-2">
          <Paperclip size={16} className="text-slate-500" />
          {title}
          {docs.length > 0 && (
            <span className="text-sm text-slate-400 font-normal">({docs.length})</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-[var(--radius-sm)]"
        >
          <Upload size={13} />
          Toevoegen
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-[var(--radius-sm)]">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-[var(--radius-sm)] border-2 border-dashed transition-colors ${
          dragOver ? 'border-terracotta-400 bg-terracotta-50' : 'border-slate-200'
        }`}
      >
        {docs.length === 0 ? (
          <div className="text-sm text-slate-400 p-6 text-center">
            Sleep PDF, afbeelding of Excel hierheen. Bestanden worden geüpload bij opslaan.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                {d.file.type.startsWith('image/') ? (
                  <ImageIcon size={20} className="text-slate-400 shrink-0" />
                ) : (
                  <FileText size={20} className="text-slate-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {d.file.name}
                  </div>
                  <input
                    type="text"
                    value={d.omschrijving}
                    onChange={(e) => setOmschrijving(d.id, e.target.value)}
                    placeholder="Omschrijving (optioneel)"
                    className="mt-0.5 text-xs border border-slate-200 rounded px-2 py-0.5 w-full"
                  />
                </div>
                <span className="text-xs text-slate-500 shrink-0">{formatBytes(d.file.size)}</span>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Verwijderen"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
