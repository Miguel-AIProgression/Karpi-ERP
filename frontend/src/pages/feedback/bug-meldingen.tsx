import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useAuth } from '@/hooks/use-auth'
import { isBugBeheerder } from '@/lib/bug/beheerder'
import { useBugMeldingen, useSetBugStatus } from '@/hooks/use-bug-meldingen'
import {
  getBugBijlageSignedUrl,
  type BugMelding,
  type BugMeldingStatus,
  type BugUrgentie,
} from '@/lib/supabase/queries/bug-meldingen'

const STATUS_COLORS: Record<BugMeldingStatus, { bg: string; text: string }> = {
  'Open': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Verwerkt': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Geaccepteerd': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
}

const URGENTIE_COLORS: Record<BugUrgentie, { bg: string; text: string }> = {
  'Laag': { bg: 'bg-slate-100', text: 'text-slate-600' },
  'Middel': { bg: 'bg-amber-50', text: 'text-amber-700' },
  'Hoog': { bg: 'bg-rose-100', text: 'text-rose-700' },
}

function Badge({ kleur, children }: { kleur: { bg: string; text: string }; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${kleur.bg} ${kleur.text}`}>
      {children}
    </span>
  )
}

function formatDatum(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function BugMeldingenPage() {
  const { user } = useAuth()
  const beheerder = isBugBeheerder(user)
  const { data: meldingen = [], isLoading } = useBugMeldingen()
  const [toonAfgerond, setToonAfgerond] = useState(false)

  const zichtbaar = toonAfgerond
    ? meldingen
    : meldingen.filter((m) => m.status !== 'Geaccepteerd')

  return (
    <>
      <PageHeader
        title={beheerder ? 'Alle meldingen' : 'Mijn meldingen'}
        description={
          beheerder
            ? 'Gemelde bugs en feedback van alle gebruikers.'
            : 'Bugs en feedback die jij hebt gemeld.'
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={toonAfgerond}
              onChange={(e) => setToonAfgerond(e.target.checked)}
            />
            Toon geaccepteerde
          </label>
        }
      />

      {isLoading ? (
        <div className="p-8 text-slate-500">Laden…</div>
      ) : zichtbaar.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Geen meldingen.
        </div>
      ) : (
        <div className="space-y-3">
          {zichtbaar.map((m) => (
            <MeldingKaart key={m.id} melding={m} beheerder={beheerder} isMelder={m.gemeld_door === user?.id} />
          ))}
        </div>
      )}
    </>
  )
}

function MeldingKaart({
  melding,
  beheerder,
  isMelder,
}: {
  melding: BugMelding
  beheerder: boolean
  isMelder: boolean
}) {
  const setStatus = useSetBugStatus()

  function zet(status: BugMeldingStatus) {
    setStatus.mutate({ id: melding.id, status })
  }

  return (
    <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge kleur={STATUS_COLORS[melding.status]}>{melding.status}</Badge>
            <Badge kleur={URGENTIE_COLORS[melding.urgentie]}>{melding.urgentie}</Badge>
            <span className="text-xs text-slate-400">{formatDatum(melding.created_at)}</span>
          </div>
          <h3 className="mt-2 font-medium text-slate-900">{melding.titel}</h3>
          {melding.omschrijving && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{melding.omschrijving}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {beheerder && melding.gemeld_door_email && (
              <span>Door: {melding.gemeld_door_email}</span>
            )}
            {melding.pagina_url && (
              <a
                href={melding.pagina_url}
                className="truncate text-terracotta-600 hover:underline"
                title={melding.pagina_url}
              >
                {pad(melding.pagina_url)}
              </a>
            )}
            {melding.bijlage_path && <BijlageLink path={melding.bijlage_path} />}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {beheerder && melding.status === 'Open' && (
            <ActieKnop onClick={() => zet('Verwerkt')} disabled={setStatus.isPending}>
              Markeer verwerkt
            </ActieKnop>
          )}
          {beheerder && melding.status === 'Verwerkt' && (
            <ActieKnop variant="ghost" onClick={() => zet('Open')} disabled={setStatus.isPending}>
              Terugzetten naar open
            </ActieKnop>
          )}
          {isMelder && melding.status === 'Verwerkt' && (
            <ActieKnop variant="primary" onClick={() => zet('Geaccepteerd')} disabled={setStatus.isPending}>
              Accepteren
            </ActieKnop>
          )}
        </div>
      </div>
    </div>
  )
}

function ActieKnop({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'ghost'
}) {
  const styles =
    variant === 'primary'
      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
      : variant === 'ghost'
        ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
        : 'bg-slate-900 text-white hover:bg-slate-800'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}

function BijlageLink({ path }: { path: string }) {
  const [laden, setLaden] = useState(false)
  async function open() {
    setLaden(true)
    try {
      const url = await getBugBijlageSignedUrl(path)
      window.open(url, '_blank', 'noopener')
    } finally {
      setLaden(false)
    }
  }
  return (
    <button onClick={open} disabled={laden} className="flex items-center gap-1 text-terracotta-600 hover:underline disabled:opacity-50">
      <Paperclip size={12} /> {laden ? 'Openen…' : 'Bijlage'}
    </button>
  )
}

function pad(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
