import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeEuro, Loader2, Check, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

interface RegelInfo {
  artikelnr: string | null
  omschrijving: string
  prijs: number | null
  korting_pct: number
  is_pseudo?: boolean
}

interface Props {
  orderId: number
  debiteurNr: number
  /** orders.prijs_ontbreekt_sinds (ISO) — sinds wanneer de gate open staat. */
  teBevestigenSinds: string
  /** Geladen orderregels — voor weergave welke artikelen €0 hebben. */
  regels?: RegelInfo[]
}

/** Spiegelt fn_order_regels_prijs_gate — zelfde uitsluitingslogica. */
function vindNulPrijsRegels(regels: RegelInfo[]): RegelInfo[] {
  return regels.filter(
    (r) =>
      !r.is_pseudo &&
      r.artikelnr !== 'VERZEND' &&
      r.korting_pct < 100 &&
      (r.prijs === null || r.prijs === 0),
  )
}

interface Diagnose {
  prijslijstNr: string | null
  ontbrekendInLijst: string[] // artikelnrs die niet in de prijslijst staan
}

async function fetchDiagnose(debiteurNr: number, artikelnrs: string[]): Promise<Diagnose> {
  const { data: deb, error: debErr } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .single()
  if (debErr) throw debErr

  const prijslijstNr = deb?.prijslijst_nr ?? null
  if (!prijslijstNr || artikelnrs.length === 0) {
    return { prijslijstNr, ontbrekendInLijst: artikelnrs }
  }

  const { data: gevonden, error: plErr } = await supabase
    .from('prijslijst_regels')
    .select('artikelnr')
    .eq('prijslijst_nr', prijslijstNr)
    .in('artikelnr', artikelnrs)
  if (plErr) throw plErr

  const gevondenSet = new Set((gevonden ?? []).map((r) => r.artikelnr as string))
  return {
    prijslijstNr,
    ontbrekendInLijst: artikelnrs.filter((a) => !gevondenSet.has(a)),
  }
}

/**
 * Blokkade-banner (mig 396): deze order heeft ≥1 regel zonder prijs (€0/NULL).
 * Harde blokkade — start_pickronden weigert de order tot de prijs gecorrigeerd
 * of bewust bevestigd is.
 *
 * De oorzaak wordt live gediagnosticeerd:
 *   - Geen prijslijst gekoppeld aan klant → koppel een prijslijst.
 *   - Artikel niet in prijslijst → voeg het toe aan de prijslijst.
 *
 * Twee uitwegen:
 *   - "Corrigeer prijs" → order bewerken (trigger wist de gate automatisch).
 *   - "€0 klopt — bevestigen" → markeer_prijs_geaccepteerd (operator accepteert
 *     de €0 bewust, bv. een echte gratis-actie). Audit via order_events.
 */
export function PrijsOntbreektBanner({ orderId, debiteurNr, teBevestigenSinds, regels }: Props) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nulRegels = regels ? vindNulPrijsRegels(regels) : []
  const artikelnrs = nulRegels
    .map((r) => r.artikelnr)
    .filter((a): a is string => a !== null && a !== '')

  const { data: diagnose } = useQuery<Diagnose>({
    queryKey: ['prijs-ontbreekt-diagnose', orderId, debiteurNr, artikelnrs.join(',')],
    queryFn: () => fetchDiagnose(debiteurNr, artikelnrs),
    enabled: artikelnrs.length > 0,
    staleTime: 60_000,
  })

  async function handleBevestig() {
    setBusy(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('markeer_prijs_geaccepteerd', {
        p_order_id: orderId,
      })
      if (rpcErr) throw rpcErr

      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Build the reason text from the live diagnosis
  function redenTekst(): React.ReactNode {
    if (!diagnose) {
      // Still loading — show generic fallback
      return 'Controleer of er een actieve prijslijst voor deze klant is die dit artikel dekt.'
    }

    if (!diagnose.prijslijstNr) {
      return (
        <>
          Er is <strong>geen prijslijst gekoppeld</strong> aan deze klant. Koppel een prijslijst
          via de{' '}
          <Link
            to={`/klanten/${debiteurNr}`}
            className="underline hover:text-amber-700"
          >
            klantpagina
          </Link>
          .
        </>
      )
    }

    if (diagnose.ontbrekendInLijst.length > 0) {
      // Find the matching regels by artikelnr to show their omschrijving
      const ontbrekendRegels = nulRegels.filter(
        (r) => r.artikelnr && diagnose.ontbrekendInLijst.includes(r.artikelnr),
      )
      return (
        <>
          {ontbrekendRegels.length === 1 ? (
            <>
              Artikel <strong>{ontbrekendRegels[0].omschrijving}</strong> staat{' '}
              <strong>niet in prijslijst {diagnose.prijslijstNr}</strong>.
            </>
          ) : (
            <>
              Artikelen{' '}
              {ontbrekendRegels.map((r, i) => (
                <span key={r.artikelnr}>
                  {i > 0 && ', '}
                  <strong>{r.omschrijving}</strong>
                </span>
              ))}{' '}
              staan <strong>niet in prijslijst {diagnose.prijslijstNr}</strong>.
            </>
          )}{' '}
          Voeg het artikel toe aan de prijslijst of koppel een andere prijslijst aan de klant.
        </>
      )
    }

    // Article IS in the price list but priced at €0 there
    return (
      <>
        Het artikel staat in prijslijst <strong>{diagnose.prijslijstNr}</strong> maar heeft
        daar een prijs van <strong>€&nbsp;0,00</strong>. Corrigeer de prijs in de prijslijst.
      </>
    )
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
        <BadgeEuro size={18} />
        Prijs ontbreekt
      </div>

      {nulRegels.length > 0 && (
        <div className="mb-1 text-sm text-amber-900">
          {nulRegels.length === 1 ? (
            <>
              Artikel <span className="font-medium">{nulRegels[0].omschrijving}</span> heeft
              geen prijs (€&nbsp;0,00).
            </>
          ) : (
            <>
              {nulRegels.length} artikelen hebben geen prijs (€&nbsp;0,00):{' '}
              {nulRegels.map((r, i) => (
                <span key={r.artikelnr ?? i}>
                  {i > 0 && ', '}
                  <span className="font-medium">{r.omschrijving}</span>
                </span>
              ))}
              .
            </>
          )}
        </div>
      )}

      <div className="mb-3 text-sm text-amber-800">
        <span className="font-medium">Oorzaak:</span> {redenTekst()} Open sinds{' '}
        {new Date(teBevestigenSinds).toLocaleString('nl-NL')}.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/orders/${orderId}/bewerken`}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <Pencil size={14} />
          Corrigeer prijs
        </Link>
        <button
          onClick={handleBevestig}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          title="Bevestigt dat de €0-prijs(en) op deze order bewust kloppen — daarna kan de pickronde starten."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          € 0,00 klopt — bevestigen
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
