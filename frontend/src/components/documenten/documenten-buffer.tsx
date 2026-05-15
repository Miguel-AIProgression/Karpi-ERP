import { useEffect, useRef, useState } from 'react'
import {
  Paperclip,
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  X,
  ExternalLink,
  Eye,
} from 'lucide-react'

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
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const previewDoc = previewId ? (docs.find((d) => d.id === previewId) ?? null) : null

  useEffect(() => {
    if (!previewDoc) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(previewDoc.file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [previewDoc])

  useEffect(() => {
    if (!previewId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewId])

  // Sluit preview automatisch als het bestand uit de buffer verdwijnt
  useEffect(() => {
    if (previewId && !docs.some((d) => d.id === previewId)) {
      setPreviewId(null)
    }
  }, [docs, previewId])

  function canPreview(file: File): boolean {
    const t = file.type.toLowerCase()
    return (
      t === 'application/pdf' ||
      t.startsWith('image/') ||
      t.startsWith('text/') ||
      file.name.toLowerCase().endsWith('.pdf')
    )
  }

  async function addFiles(files: FileList | File[]) {
    setError(null)
    const incoming: BufferedDoc[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" is groter dan 25 MB`)
        continue
      }
      try {
        // Lees bytes meteen in geheugen — virtuele bestanden uit mailclients
        // (Outlook, Thunderbird, Gmail web) verliezen anders hun referentie
        // tegen de tijd dat het formulier wordt opgeslagen.
        const buf = await f.arrayBuffer()
        const materialized = new File([buf], f.name, {
          type: f.type || 'application/octet-stream',
          lastModified: f.lastModified,
        })
        incoming.push({ id: crypto.randomUUID(), file: materialized, omschrijving: '' })
      } catch {
        setError(`Kon "${f.name}" niet lezen. Sla 'm eerst op vanuit de mail en upload via "Toevoegen".`)
      }
    }
    if (incoming.length) onChange([...docs, ...incoming])
  }

  // Lees alles wat de browser óók-synchroon-leesbaar uit de drop biedt.
  // Sommige clients (Gmail web, Outlook on the web, Chrome op Windows) leveren
  // geen `files` maar wel string-payloads (DownloadURL, text/uri-list) of
  // virtuele bestanden via items[].
  function snapshotDrop(dt: DataTransfer): {
    files: File[]
    downloadUrl: string | null
    uriList: string | null
    html: string | null
    types: string[]
  } {
    const files: File[] = []
    if (dt.files && dt.files.length > 0) {
      files.push(...Array.from(dt.files))
    }
    if (files.length === 0 && dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i]
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) files.push(f)
        }
      }
    }
    let downloadUrl: string | null = null
    let uriList: string | null = null
    let html: string | null = null
    const types = Array.from(dt.types ?? [])
    if (types.includes('DownloadURL')) {
      const raw = dt.getData('DownloadURL')
      if (raw) downloadUrl = raw
    }
    if (types.includes('text/uri-list')) {
      const raw = dt.getData('text/uri-list')
      if (raw) uriList = raw
    } else if (types.includes('text/x-moz-url')) {
      const raw = dt.getData('text/x-moz-url')
      if (raw) uriList = raw
    }
    if (types.includes('text/html')) {
      const raw = dt.getData('text/html')
      if (raw) html = raw
    }
    return { files, downloadUrl, uriList, html, types }
  }

  function dataUrlToFile(dataUrl: string, fallbackName: string): File | null {
    const match = dataUrl.match(/^data:([^;,]+)(?:;([^,]*))?,(.*)$/)
    if (!match) return null
    const mime = match[1] || 'application/octet-stream'
    const meta = match[2] || ''
    const payload = match[3] || ''
    let bytes: Uint8Array
    try {
      if (meta.includes('base64')) {
        const bin = atob(payload)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(payload))
      }
    } catch {
      return null
    }
    const ext = mime.split('/')[1]?.split('+')[0] || 'bin'
    const name = fallbackName.includes('.') ? fallbackName : `${fallbackName}.${ext}`
    return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: mime })
  }

  function extractDataUrlFromHtml(html: string): { url: string; name: string } | null {
    const imgDataMatch = html.match(/<img\b[^>]*\bsrc=["'](data:[^"']+)["'][^>]*>/i)
    if (imgDataMatch) {
      const altMatch = html.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)
      return { url: imgDataMatch[1], name: altMatch?.[1] || 'afbeelding' }
    }
    const anyDataMatch = html.match(/(data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/i)
    if (anyDataMatch) return { url: anyDataMatch[1], name: 'bijlage' }
    return null
  }

  async function fetchAsFile(url: string, fallbackName: string, fallbackType: string): Promise<File | null> {
    const attempts: RequestInit[] = [{ credentials: 'include' }, { credentials: 'omit' }]
    for (const init of attempts) {
      try {
        const res = await fetch(url, init)
        if (!res.ok) continue
        const blob = await res.blob()
        let name = fallbackName
        const cd = res.headers.get('content-disposition')
        const match = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
        if (match?.[1]) name = decodeURIComponent(match[1])
        const type = blob.type || fallbackType || 'application/octet-stream'
        return new File([blob], name, { type })
      } catch {
        // probeer volgende variant
      }
    }
    return null
  }

  async function handleDropSnapshot(snap: ReturnType<typeof snapshotDrop>) {
    if (snap.files.length > 0) {
      void addFiles(snap.files)
      return
    }

    // Chrome: DownloadURL = "mime:filename:url"
    if (snap.downloadUrl) {
      const parts = snap.downloadUrl.split(':')
      // Eerste segment = mime, laatste segmenten = URL (kan ':' bevatten)
      const mime = parts.shift() ?? 'application/octet-stream'
      const name = parts.shift() ?? 'bijlage'
      const url = parts.join(':')
      const f = await fetchAsFile(url, name, mime)
      if (f) {
        void addFiles([f])
        return
      }
    }

    if (snap.uriList) {
      const url = snap.uriList.split('\n').find((line) => line && !line.startsWith('#'))
      if (url) {
        const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'bijlage')
        const f = await fetchAsFile(url, name, 'application/octet-stream')
        if (f) {
          void addFiles([f])
          return
        }
      }
    }

    // text/html-fallback: bevat soms een data:-URL (inline images)
    if (snap.html) {
      const dataHit = extractDataUrlFromHtml(snap.html)
      if (dataHit) {
        const f = dataUrlToFile(dataHit.url, dataHit.name)
        if (f) {
          void addFiles([f])
          return
        }
      }
    }

    setError(
      'Je mailclient geeft het bestand niet rechtstreeks vrij — dit is een browser-beveiliging bij webmail. ' +
        'Werkt wél: bijlage rechts-klikken in de mail → Kopiëren, daarna in dit vak op Ctrl+V drukken. ' +
        'Of: sla \'m eerst lokaal op en gebruik "Toevoegen".',
    )
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const cd = e.clipboardData
    if (!cd) return
    const collected: File[] = []
    if (cd.files && cd.files.length > 0) {
      collected.push(...Array.from(cd.files))
    }
    if (collected.length === 0 && cd.items && cd.items.length > 0) {
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i]
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) collected.push(f)
        }
      }
    }
    if (collected.length === 0) return
    e.preventDefault()
    void addFiles(collected)
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
            if (e.target.files) void addFiles(e.target.files)
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
        tabIndex={0}
        onPaste={handlePaste}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          // Snapshot synchroon — dataTransfer wordt na de event-tick ongeldig,
          // dus alle reads (items, getData, files) moeten hier gebeuren.
          const snap = snapshotDrop(e.dataTransfer)
          void handleDropSnapshot(snap)
        }}
        className={`rounded-[var(--radius-sm)] border-2 border-dashed transition-colors ${
          dragOver ? 'border-terracotta-400 bg-terracotta-50' : 'border-slate-200'
        }`}
      >
        {docs.length === 0 ? (
          <div className="text-sm text-slate-400 p-6 text-center">
            Sleep PDF, afbeelding of Excel hierheen — of plak (Ctrl+V) een gekopieerde bijlage. Bestanden worden geüpload bij opslaan.
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
                  {canPreview(d.file) ? (
                    <button
                      type="button"
                      onClick={() => setPreviewId(d.id)}
                      className="text-sm font-medium text-slate-800 truncate text-left hover:text-terracotta-600 hover:underline w-full"
                      title="Klik om voorvertoning te openen"
                    >
                      {d.file.name}
                    </button>
                  ) : (
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {d.file.name}
                    </div>
                  )}
                  <input
                    type="text"
                    value={d.omschrijving}
                    onChange={(e) => setOmschrijving(d.id, e.target.value)}
                    placeholder="Omschrijving (optioneel)"
                    className="mt-0.5 text-xs border border-slate-200 rounded px-2 py-0.5 w-full"
                  />
                </div>
                <span className="text-xs text-slate-500 shrink-0">{formatBytes(d.file.size)}</span>
                {canPreview(d.file) && (
                  <button
                    type="button"
                    onClick={() => setPreviewId(d.id)}
                    className="p-1.5 text-slate-400 hover:text-terracotta-600 hover:bg-terracotta-50 rounded"
                    title="Voorvertoning"
                  >
                    <Eye size={14} />
                  </button>
                )}
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

      {previewDoc && previewUrl && (
        <div
          className="fixed top-0 right-0 h-full w-[min(720px,55vw)] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col"
          role="dialog"
          aria-label={`Voorvertoning ${previewDoc.file.name}`}
        >
          <header className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-slate-50">
            <FileText size={16} className="text-slate-500 shrink-0" />
            <div className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">
              {previewDoc.file.name}
            </div>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded"
              title="Open in nieuw tabblad"
            >
              <ExternalLink size={16} />
            </a>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded"
              title="Sluiten (Esc)"
            >
              <X size={16} />
            </button>
          </header>
          <div className="flex-1 min-h-0 bg-slate-100">
            {previewDoc.file.type.startsWith('image/') ? (
              <div className="w-full h-full overflow-auto flex items-start justify-center p-4">
                <img
                  src={previewUrl}
                  alt={previewDoc.file.name}
                  className="max-w-full h-auto"
                />
              </div>
            ) : (
              <iframe
                key={previewUrl}
                src={previewUrl}
                title={previewDoc.file.name}
                className="w-full h-full border-0"
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
