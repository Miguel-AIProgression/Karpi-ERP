import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Check, Link2, Loader2, Search } from 'lucide-react'
import {
  useDebiteurenVoorKoppeling,
  useAfleveradressenVoorKoppeling,
  useKoppelEdiAfleveradres,
  useKoppelEdiDebiteurAlias,
} from '@/modules/edi/hooks/use-edi'

/**
 * Twee manieren om een ongematchte inkomende order te koppelen:
 *  - 'afleveradres'  → onthoud de aflever-GLN op een afleveradres (vaste vestiging,
 *    Hornbach-patroon, mig 306).
 *  - 'factuur_gln'   → onthoud de gefactureerd-GLN als debiteur-alias (centrale
 *    facturatie met meerdere factuur-entiteiten, BDSK/XXXLutz, mig 307).
 */
type KoppelModus = 'afleveradres' | 'factuur_gln'

export interface KoppelRegel {
  regelnummer: number
  artikelcode: string | null
  aantal: number
}

interface Props {
  berichtId: number
  /** GLN's uit de header — getoond zodat de operator ze kan herkennen. */
  glnAfleveradres: string | null
  glnBesteller: string | null
  glnGefactureerd: string | null
  /** Context uit de payload — helpt de operator herkennen om welke order het gaat. */
  afnemerNaam: string | null
  klantPo: string | null
  leverdatum: string | null
  regels: KoppelRegel[]
}

/**
 * Bootstrap-koppeling voor een inkomende order zonder debiteur-match. Toont de
 * order-inhoud (afnemer, klant-PO, regels) + de onbekende aflever-GLN, laat de
 * operator een (actieve) debiteur + bestaand afleveradres kiezen, en koppelt via
 * de RPC `koppel_edi_afleveradres` — die de GLN op het adres onthoudt en de order
 * aanmaakt. Volgende orders naar diezelfde vestiging matchen daarna automatisch.
 *
 * De debiteur-zoek wordt geprefild met de afnemer-naam uit de payload zodat de
 * juiste klant meestal meteen in de lijst staat.
 */
export function KoppelVestigingWidget({
  berichtId,
  glnAfleveradres,
  glnBesteller,
  glnGefactureerd,
  afnemerNaam,
  klantPo,
  leverdatum,
  regels,
}: Props) {
  // Default-modus: als de aflever-GLN ontbreekt maar er wél een factuur-GLN is,
  // start op de factuur-GLN-modus (centrale facturatie). Anders de vestiging-modus.
  const [modus, setModus] = useState<KoppelModus>(
    !glnAfleveradres && glnGefactureerd ? 'factuur_gln' : 'afleveradres',
  )
  const [zoek, setZoek] = useState(() => afnemerNaam?.trim() ?? '')
  const [debiteurNr, setDebiteurNr] = useState<number | undefined>()
  const [adresId, setAdresId] = useState<number | undefined>()
  const [orderId, setOrderId] = useState<number | null>(null)

  const { data: debiteuren = [], isLoading: debLoading } = useDebiteurenVoorKoppeling(zoek)
  const { data: adressen = [], isLoading: adrLoading } = useAfleveradressenVoorKoppeling(debiteurNr)
  const koppelAdres = useKoppelEdiAfleveradres()
  const koppelAlias = useKoppelEdiDebiteurAlias()

  const busy = koppelAdres.isPending || koppelAlias.isPending
  const foutMelding =
    (koppelAdres.isError && (koppelAdres.error instanceof Error ? koppelAdres.error.message : 'Koppelen mislukt.')) ||
    (koppelAlias.isError && (koppelAlias.error instanceof Error ? koppelAlias.error.message : 'Koppelen mislukt.')) ||
    null
  // Factuur-GLN-modus kan koppelen zodra een debiteur gekozen is; vestiging-modus
  // vereist óók een afleveradres.
  const kanKoppelen = modus === 'factuur_gln' ? !!debiteurNr && !!glnGefactureerd : !!debiteurNr && !!adresId

  function handleKoppel() {
    if (!debiteurNr) return
    if (modus === 'factuur_gln') {
      if (!glnGefactureerd) return
      koppelAlias.mutate(
        { berichtId, debiteurNr, gln: glnGefactureerd, reden: 'Centrale facturatie — extra factuur-GLN gekoppeld via bericht-detail' },
        { onSuccess: (id) => setOrderId(id) },
      )
    } else {
      if (!adresId) return
      koppelAdres.mutate(
        { berichtId, debiteurNr, afleveradresId: adresId },
        { onSuccess: (id) => setOrderId(id) },
      )
    }
  }

  if (orderId) {
    return (
      <div className="mb-6 p-4 rounded-[var(--radius)] border border-emerald-200 bg-emerald-50">
        <div className="font-medium text-emerald-800 mb-1 flex items-center gap-2">
          <Check size={16} /> {modus === 'factuur_gln' ? 'Factuur-GLN gekoppeld en order aangemaakt' : 'Vestiging gekoppeld en order aangemaakt'}
        </div>
        <p className="text-xs text-emerald-700">
          {modus === 'factuur_gln' ? (
            <>
              De factuur-GLN <code>{glnGefactureerd}</code> is onthouden als alias van deze
              debiteur. Volgende orders met deze factuur-GLN worden automatisch gekoppeld.
            </>
          ) : (
            <>
              De aflever-GLN <code>{glnAfleveradres}</code> is onthouden op het gekozen
              afleveradres. Volgende orders naar deze vestiging worden automatisch gekoppeld.
            </>
          )}
        </p>
        <Link
          to={`/orders/${orderId}`}
          className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline"
        >
          Bekijk order #{orderId}
        </Link>
      </div>
    )
  }

  return (
    <div className="mb-6 p-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50">
      <div className="font-medium text-amber-800 mb-2 flex items-center gap-2">
        <AlertCircle size={16} /> Geen debiteur gekoppeld — koppel vestiging
      </div>

      {/* Order-inhoud uit de payload zodat de operator weet om welke order het gaat */}
      <div className="mb-3 rounded-[var(--radius-sm)] border border-amber-200 bg-white p-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-slate-500">Afnemer: </span>
            <span className="font-semibold text-slate-900">{afnemerNaam ?? '—'}</span>
          </span>
          <span>
            <span className="text-slate-500">Klant-PO: </span>
            <span className="font-mono text-slate-700">{klantPo ?? '—'}</span>
          </span>
          <span>
            <span className="text-slate-500">Gewenste levering: </span>
            <span className="text-slate-700">{formatDatum(leverdatum)}</span>
          </span>
        </div>
        {regels.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-700">
            {regels.map((r) => (
              <li key={r.regelnummer} className="flex gap-2">
                <span className="font-medium tabular-nums">{r.aantal}×</span>
                <span className="font-mono">{r.artikelcode ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-xs">
        <GlnCel label="Aflever-GLN" gln={glnAfleveradres} accent />
        <GlnCel label="Besteller-GLN" gln={glnBesteller} />
        <GlnCel label="Gefactureerd-GLN" gln={glnGefactureerd} />
      </div>

      {/* Koppel-modus: op vestiging (aflever-GLN) of op factuur-GLN (centrale facturatie) */}
      <div className="mb-3 inline-flex rounded-[var(--radius-sm)] border border-amber-300 bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setModus('afleveradres')}
          className={`px-3 py-1.5 rounded-[calc(var(--radius-sm)-2px)] font-medium transition-colors ${
            modus === 'afleveradres' ? 'bg-terracotta-500 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Op vestiging (aflever-GLN)
        </button>
        <button
          type="button"
          onClick={() => setModus('factuur_gln')}
          disabled={!glnGefactureerd}
          className={`px-3 py-1.5 rounded-[calc(var(--radius-sm)-2px)] font-medium transition-colors disabled:opacity-40 ${
            modus === 'factuur_gln' ? 'bg-terracotta-500 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Op factuur-GLN (centraal)
        </button>
      </div>

      <p className="text-xs text-amber-700 mb-3">
        {modus === 'factuur_gln' ? (
          <>
            Centrale facturatie: kies de debiteur waar deze factuur-GLN bij hoort. De GLN{' '}
            <code>{glnGefactureerd}</code> wordt als extra factuur-GLN van die debiteur onthouden,
            zodat élke volgende order met deze factuur-GLN automatisch landt (los van de vestiging).
          </>
        ) : (
          <>
            Deze aflever-GLN is nog niet bekend. Kies de juiste debiteur en het fysieke
            afleveradres (vestiging). De GLN wordt onthouden zodat de volgende order naar
            diezelfde vestiging automatisch landt.
          </>
        )}
      </p>

      <div className="space-y-3 bg-white rounded-[var(--radius-sm)] border border-amber-200 p-3">
        {/* Debiteur zoeken + kiezen */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Debiteur</label>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              placeholder="Zoek op naam of debiteurnr…"
              className="w-full pl-8 pr-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
          </div>
          <select
            value={debiteurNr ?? ''}
            onChange={(e) => {
              setDebiteurNr(e.target.value ? Number(e.target.value) : undefined)
              setAdresId(undefined)
            }}
            className="w-full py-1.5 px-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          >
            <option value="">{debLoading ? 'Laden…' : '— kies debiteur —'}</option>
            {debiteuren.map((d) => (
              <option key={d.debiteur_nr} value={d.debiteur_nr}>
                {d.naam} (#{d.debiteur_nr}){d.plaats ? ` — ${d.plaats}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Afleveradres kiezen — alleen in vestiging-modus */}
        {modus === 'afleveradres' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Afleveradres (vestiging)</label>
            <select
              value={adresId ?? ''}
              onChange={(e) => setAdresId(e.target.value ? Number(e.target.value) : undefined)}
              disabled={!debiteurNr}
              className="w-full py-1.5 px-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            >
              <option value="">
                {!debiteurNr ? 'kies eerst een debiteur' : adrLoading ? 'Laden…' : '— kies afleveradres —'}
              </option>
              {adressen.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.naam, a.adres, [a.postcode, a.plaats].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(' · ')}
                  {a.gln_afleveradres ? `  [GLN ${a.gln_afleveradres}]` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {foutMelding && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] p-2">
            {foutMelding}
          </div>
        )}

        <button
          onClick={handleKoppel}
          disabled={!kanKoppelen || busy}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          {modus === 'factuur_gln' ? 'Koppel factuur-GLN + maak order' : 'Koppel vestiging + maak order'}
        </button>
      </div>
    </div>
  )
}

/** ISO YYYY-MM-DD → DD-MM-YYYY voor de UI; '—' als leeg/ongeldig. */
function formatDatum(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}

function GlnCel({ label, gln, accent }: { label: string; gln: string | null; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-[var(--radius-sm)] border border-amber-300 bg-white px-2 py-1' : 'px-2 py-1'}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-mono ${accent ? 'text-slate-900 font-semibold' : 'text-slate-600'}`}>
        {gln ?? '—'}
      </div>
    </div>
  )
}
