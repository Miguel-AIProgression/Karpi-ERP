import { useEffect, useState } from 'react'
import { Loader2, Check, AlertCircle } from 'lucide-react'
import {
  useKlantVervoerderConfig,
  useUpsertKlantVervoerderConfig,
  useVervoerders,
} from '@/modules/logistiek'

interface KlantVervoerderTabProps {
  debiteurNr: number
}

export function KlantVervoerderTab({ debiteurNr }: KlantVervoerderTabProps) {
  const { data: config, isLoading: configLoading } = useKlantVervoerderConfig(debiteurNr)
  const { data: vervoerders = [], isLoading: vervoerdersLoading } = useVervoerders()
  const upsert = useUpsertKlantVervoerderConfig()

  // Lokale draft zodat de gebruiker eerst kiest en daarna op "Opslaan" klikt.
  const [draft, setDraft] = useState<string | null>(null)
  const [showSavedTick, setShowSavedTick] = useState(false)

  useEffect(() => {
    if (config !== undefined) {
      setDraft(config?.vervoerder_code ?? null)
    }
  }, [config])

  if (debiteurNr <= 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klant geselecteerd</div>
  }

  if (configLoading || vervoerdersLoading) {
    return <div className="p-5 text-sm text-slate-400">Vervoerder-config laden…</div>
  }

  const huidig = config?.vervoerder_code ?? null
  const isGewijzigd = (draft ?? null) !== huidig
  const draftDef = vervoerders.find((v) => v.code === draft) ?? null
  const draftIsInactief = draftDef ? !draftDef.actief : false

  function handleSave() {
    upsert.mutate(
      { debiteur_nr: debiteurNr, vervoerder_code: draft },
      {
        onSuccess: () => {
          setShowSavedTick(true)
          window.setTimeout(() => setShowSavedTick(false), 2000)
        },
      },
    )
  }

  return (
    <div className="p-5 space-y-5 text-sm">
      <div>
        <div className="font-medium text-slate-900 mb-1">Vervoerder</div>
        <p className="text-xs text-slate-500">
          Welke vervoerder gebruikt deze klant? Bij "Klaar voor verzending" wordt de
          gekozen vervoerder automatisch aangeroepen. Wijzigen geldt alleen voor
          nieuwe zendingen — openstaande zendingen worden niet hergerouteerd.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-2">
          Keuze
        </label>
        <select
          value={draft ?? ''}
          onChange={(e) => setDraft(e.target.value === '' ? null : e.target.value)}
          disabled={upsert.isPending}
          className="w-full max-w-md px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white disabled:opacity-50"
        >
          <option value="">Geen (handmatige flow)</option>
          {vervoerders.map((v) => (
            <option key={v.code} value={v.code} disabled={!v.actief}>
              {v.display_naam} {v.actief ? '' : '(nog niet actief)'}
            </option>
          ))}
        </select>
      </div>

      {draftIsInactief && (
        <div className="p-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 flex items-start gap-2 max-w-xl">
          <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800">
            Deze vervoerder is nog niet actief geschakeld in de systeem-configuratie
            (<code>vervoerders.actief = FALSE</code>). Vraag een beheerder om de koppeling
            eerst te activeren — anders worden zendingen wel aangemaakt maar niet
            doorgestuurd.
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isGewijzigd || upsert.isPending}
          className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {upsert.isPending && <Loader2 size={14} className="animate-spin" />}
          Opslaan
        </button>
        {showSavedTick && (
          <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
            <Check size={12} /> Opgeslagen
          </span>
        )}
        {!isGewijzigd && !showSavedTick && (
          <span className="text-xs text-slate-400">Geen wijzigingen</span>
        )}
      </div>

      {upsert.isError && (
        <div className="text-xs text-rose-600">
          Opslaan mislukt: {String((upsert.error as Error).message)}
        </div>
      )}
    </div>
  )
}
