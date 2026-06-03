import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Check, Minus, ExternalLink, Beaker } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useEdiPartners } from '@/modules/edi/hooks/use-edi'
import { BERICHTTYPE_REGISTRY, type Berichttype } from '@/modules/edi/registry'
import type { EdiPartnerRow } from '@/modules/edi/queries/edi'

// Kolomvolgorde van het overzicht — leest labels uit de registry zodat een nieuw
// berichttype hier automatisch meekomt.
const KOLOMMEN: { code: Berichttype; sleutel: keyof EdiPartnerRow; kort: string }[] = [
  { code: 'order', sleutel: 'order_in', kort: 'Order in' },
  { code: 'orderbev', sleutel: 'orderbev_uit', kort: 'Orderbev.' },
  { code: 'factuur', sleutel: 'factuur_uit', kort: 'Factuur' },
  { code: 'verzendbericht', sleutel: 'verzend_uit', kort: 'Verzending' },
]

export function EdiPartnersOverzichtPage() {
  const { data, isLoading } = useEdiPartners()
  const [zoek, setZoek] = useState('')
  const [alleenActief, setAlleenActief] = useState(true)

  const rijen = useMemo(() => {
    let r = data ?? []
    if (alleenActief) r = r.filter((p) => p.transus_actief)
    const z = zoek.trim().toLowerCase()
    if (z) {
      r = r.filter(
        (p) =>
          (p.klant_naam ?? '').toLowerCase().includes(z) ||
          String(p.debiteur_nr).includes(z),
      )
    }
    return r
  }, [data, zoek, alleenActief])

  return (
    <>
      <PageHeader
        title="EDI-handelspartners"
        description="Welke berichten gaan naar/van welke klant via Transus"
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op naam of klantnr…"
            className="w-full pl-9 pr-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={alleenActief}
            onChange={(e) => setAlleenActief(e.target.checked)}
            className="accent-terracotta-500"
          />
          Alleen actieve partners
        </label>
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-5 py-3 font-medium text-slate-500">Partner</th>
                <th className="px-3 py-3 font-medium text-slate-500 w-24">Klantnr</th>
                {KOLOMMEN.map((k) => (
                  <th
                    key={k.code}
                    className="px-3 py-3 font-medium text-slate-500 text-center"
                    title={BERICHTTYPE_REGISTRY[k.code].uiLabel}
                  >
                    {k.kort}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium text-slate-500 text-center w-20">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    Laden…
                  </td>
                </tr>
              ) : rijen.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    Geen partners gevonden
                  </td>
                </tr>
              ) : (
                rijen.map((p) => (
                  <tr key={p.debiteur_nr} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        to={`/klanten/${p.debiteur_nr}`}
                        className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:text-terracotta-600 hover:underline"
                      >
                        {p.klant_naam ?? `Klant ${p.debiteur_nr}`}
                        <ExternalLink size={12} className="text-slate-400" />
                      </Link>
                      {p.test_modus && (
                        <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          <Beaker size={10} /> TEST
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">{p.debiteur_nr}</td>
                    {KOLOMMEN.map((k) => (
                      <td key={k.code} className="px-3 py-3 text-center">
                        <JaNee aan={Boolean(p[k.sleutel])} />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center">
                      {p.transus_actief ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                          Actief
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
                          Uit
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Per klant aan te passen via <span className="text-slate-500">Klant → tab "EDI"</span>.
        {' '}<Check size={11} className="inline text-emerald-600" /> = bericht actief voor deze partner.
      </p>
    </>
  )
}

function JaNee({ aan }: { aan: boolean }) {
  return aan ? (
    <Check size={16} className="inline text-emerald-600" />
  ) : (
    <Minus size={16} className="inline text-slate-300" />
  )
}
