import { useState, useMemo } from 'react'
import { Loader2, X, AlertTriangle, CreditCard, Euro } from 'lucide-react'
import {
  useMaakCreditfactuur,
  useStuurCreditfactuur,
  useCreditnotasVoorFactuur,
} from '../hooks/use-facturen'
import type { FactuurDetail, FactuurRegel } from '../queries/facturen'
import { formatCurrency } from '@/lib/utils/formatters'

interface Props {
  factuur: FactuurDetail
  regels: FactuurRegel[]
  onClose: () => void
  onCreated: (creditfactuurId: number) => void
}

type Methode = 'orderregel' | 'los_bedrag'

interface RegelSelectie {
  geselecteerd: boolean
  aantal: number
}

export function CreditfactuurDialog({ factuur, regels, onClose, onCreated }: Props) {
  const [methode, setMethode] = useState<Methode>('orderregel')
  const [regelSelectie, setRegelSelectie] = useState<Record<number, RegelSelectie>>(() => {
    const init: Record<number, RegelSelectie> = {}
    for (const r of regels) {
      init[r.id] = { geselecteerd: false, aantal: Math.abs(r.aantal) }
    }
    return init
  })

  const [losBedrag, setLosBedrag] = useState('')
  const [losInclBtw, setLosInclBtw] = useState(false)
  const [losReden, setLosReden] = useState('')

  const [voorraadBijwerken, setVoorraadBijwerken] = useState(false)
  const [verzenden, setVerzenden] = useState(false)

  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  const maak = useMaakCreditfactuur()
  const stuur = useStuurCreditfactuur()
  const { data: bestaandeCreditnotas } = useCreditnotasVoorFactuur(factuur.id)

  // Totaal al gecrediteerd
  const reedsGecrediteerd = useMemo(
    () => (bestaandeCreditnotas ?? []).reduce((sum, c) => sum + Math.abs(c.totaal), 0),
    [bestaandeCreditnotas],
  )
  const debetTotaal = Math.abs(factuur.totaal)
  const resterendLimiet = debetTotaal - reedsGecrediteerd

  // Effectief BTW-tarief (zelfde logica als DB: verlegd → 0%)
  const btwPct = factuur.btw_verlegd ? 0 : (factuur.btw_percentage ?? 0)

  // Bereken preview-bedrag van de huidige selectie
  const geselecteerdeRegels = useMemo(() => {
    if (methode !== 'orderregel') return []
    return regels.filter((r) => regelSelectie[r.id]?.geselecteerd)
  }, [methode, regels, regelSelectie])

  const previewSubtotaal = useMemo(() => {
    if (methode === 'orderregel') {
      return geselecteerdeRegels.reduce((sum, r) => {
        const s = regelSelectie[r.id]
        const bedragPerStuk = Math.abs(r.bedrag) / Math.abs(r.aantal || 1)
        return sum + bedragPerStuk * (s?.aantal ?? Math.abs(r.aantal))
      }, 0)
    } else {
      const bedrag = parseFloat(losBedrag.replace(',', '.'))
      if (isNaN(bedrag) || bedrag <= 0) return 0
      if (losInclBtw) return bedrag / (1 + btwPct / 100)
      return bedrag
    }
  }, [methode, geselecteerdeRegels, regelSelectie, losBedrag, losInclBtw, btwPct, regels])

  const previewBtw = previewSubtotaal * (btwPct / 100)
  const previewTotaal = previewSubtotaal + previewBtw

  const overschrijdt = previewTotaal > resterendLimiet + 0.01

  function toggleRegel(regelId: number) {
    setRegelSelectie((prev) => ({
      ...prev,
      [regelId]: { ...prev[regelId], geselecteerd: !prev[regelId].geselecteerd },
    }))
  }

  function setAantal(regelId: number, waarde: string) {
    const n = parseInt(waarde, 10)
    if (isNaN(n) || n < 1) return
    const max = Math.abs(regels.find((r) => r.id === regelId)?.aantal ?? 1)
    setRegelSelectie((prev) => ({
      ...prev,
      [regelId]: { ...prev[regelId], aantal: Math.min(n, max) },
    }))
  }

  async function handleSubmit() {
    setFout(null)

    if (methode === 'orderregel' && geselecteerdeRegels.length === 0) {
      setFout('Selecteer minimaal één factuurregel om te crediteren.')
      return
    }
    if (methode === 'los_bedrag') {
      const b = parseFloat(losBedrag.replace(',', '.'))
      if (isNaN(b) || b <= 0) {
        setFout('Vul een geldig bedrag in.')
        return
      }
    }
    if (overschrijdt) {
      setFout(`Creditbedrag (${formatCurrency(previewTotaal)}) overschrijdt het resterende limiet (${formatCurrency(resterendLimiet)}).`)
      return
    }

    setBezig(true)
    try {
      let creditId: number

      if (methode === 'orderregel') {
        const heeftGewijzigdAantal = geselecteerdeRegels.some(
          (r) => regelSelectie[r.id].aantal !== Math.abs(r.aantal),
        )
        if (heeftGewijzigdAantal) {
          // Modus B: deelcredit met aangepast aantal
          creditId = await maak.mutateAsync({
            factuur_id: factuur.id,
            deelcredit_regels: geselecteerdeRegels.map((r) => ({
              id: r.id,
              aantal: regelSelectie[r.id].aantal,
            })),
            voorraad_bijwerken: voorraadBijwerken,
          })
        } else {
          // Modus A: geselecteerde regels, volledig aantal
          creditId = await maak.mutateAsync({
            factuur_id: factuur.id,
            factuur_regel_ids: geselecteerdeRegels.map((r) => r.id),
            voorraad_bijwerken: voorraadBijwerken,
          })
        }
      } else {
        // Modus C: los bedrag
        creditId = await maak.mutateAsync({
          factuur_id: factuur.id,
          los_bedrag: parseFloat(losBedrag.replace(',', '.')),
          los_bedrag_incl_btw: losInclBtw,
          los_reden: losReden.trim() || undefined,
        })
      }

      if (verzenden) {
        await stuur.mutateAsync(creditId)
      }

      onCreated(creditId)
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err))
      setBezig(false)
    }
  }

  // Pseudo-artikelen: crediteerbaar maar geen voorraad-ophoging (bewaakt door DB).
  const PSEUDO_ARTIKELNRS = new Set([
    'VERZEND', 'BUNDELKORTING', 'DREMPELKORTING', 'VORMTOESLAG', 'DROPSHIP-KLEIN', 'DROPSHIP-GROOT',
  ])
  function isPseudo(r: FactuurRegel) {
    return r.artikelnr != null && PSEUDO_ARTIKELNRS.has(r.artikelnr)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-terracotta-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              Creditnota aanmaken
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Debetfactuur info */}
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Debetfactuur</span>
              <span className="font-medium text-slate-900">{factuur.factuur_nr}</span>
            </div>
            <div className="flex justify-between text-slate-600 mt-1">
              <span>Factuurtotaal (incl. BTW)</span>
              <span className="font-medium text-slate-900">{formatCurrency(debetTotaal)}</span>
            </div>
            {reedsGecrediteerd > 0 && (
              <div className="flex justify-between text-slate-600 mt-1">
                <span>Al gecrediteerd</span>
                <span className="font-medium text-red-600">− {formatCurrency(reedsGecrediteerd)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-slate-200 mt-2 pt-2">
              <span className="text-slate-700">Resterend kredietlimiet</span>
              <span className={resterendLimiet <= 0 ? 'text-red-600' : 'text-emerald-600'}>
                {formatCurrency(resterendLimiet)}
              </span>
            </div>
          </div>

          {resterendLimiet <= 0.01 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Deze factuur is volledig gecrediteerd. Er kan geen nieuwe creditnota worden aangemaakt.</span>
            </div>
          )}

          {/* Methode keuze */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Krediteringsmethode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethode('orderregel')}
                className={`rounded-lg border-2 px-4 py-3 text-left text-sm transition-colors ${
                  methode === 'orderregel'
                    ? 'border-terracotta-500 bg-terracotta-50 text-terracotta-800'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="font-medium">Factuurregels crediteren</div>
                <div className="text-xs mt-0.5 opacity-70">Kies regels en pas aantal aan</div>
              </button>
              <button
                type="button"
                onClick={() => setMethode('los_bedrag')}
                className={`rounded-lg border-2 px-4 py-3 text-left text-sm transition-colors ${
                  methode === 'los_bedrag'
                    ? 'border-terracotta-500 bg-terracotta-50 text-terracotta-800'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="font-medium">Los bedrag crediteren</div>
                <div className="text-xs mt-0.5 opacity-70">Coulance, korting achteraf</div>
              </button>
            </div>
          </div>

          {/* Factuurregels selectie */}
          {methode === 'orderregel' && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Selecteer te crediteren regels</p>
              {regels.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Geen regels gevonden op deze factuur.</p>
              ) : (
                <div className="space-y-1 rounded-lg border border-slate-200 overflow-hidden">
                  {regels.map((r) => {
                    const sel = regelSelectie[r.id]
                    const pseudo = isPseudo(r)
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                          sel?.geselecteerd ? 'bg-terracotta-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => toggleRegel(r.id)}
                      >
                        <input
                          type="checkbox"
                          checked={sel?.geselecteerd ?? false}
                          onChange={() => toggleRegel(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 accent-terracotta-600 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800 truncate">
                            {r.omschrijving ?? r.artikelnr}
                          </span>
                          {r.omschrijving_2 && (
                            <span className="text-slate-400 ml-1 text-xs">{r.omschrijving_2}</span>
                          )}
                          {pseudo && (
                            <span className="ml-2 text-xs text-slate-400">(geen voorraad)</span>
                          )}
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          {sel?.geselecteerd ? (
                            <input
                              type="number"
                              min={1}
                              max={Math.abs(r.aantal)}
                              value={sel.aantal}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setAantal(r.id, e.target.value)}
                              className="w-16 rounded border border-slate-300 px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-terracotta-500"
                            />
                          ) : (
                            <span className="text-slate-500">{Math.abs(r.aantal)}×</span>
                          )}
                          <span className="w-20 text-right text-slate-700 tabular-nums">
                            {formatCurrency(Math.abs(r.bedrag))}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Los bedrag */}
          {methode === 'los_bedrag' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Creditbedrag
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={losBedrag}
                      onChange={(e) => setLosBedrag(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setLosInclBtw(!losInclBtw)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      losInclBtw
                        ? 'border-terracotta-500 bg-terracotta-50 text-terracotta-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {losInclBtw ? 'Incl. BTW' : 'Excl. BTW'}
                  </button>
                </div>
                {btwPct > 0 && (
                  <p className="text-xs text-slate-400 mt-1">BTW-tarief: {btwPct}%</p>
                )}
                {factuur.btw_verlegd && (
                  <p className="text-xs text-amber-600 mt-1">BTW verlegd — effectief 0%</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Omschrijving <span className="font-normal text-slate-400">(optioneel)</span>
                </label>
                <input
                  type="text"
                  placeholder="Bijv. coulance, korting achteraf, …"
                  value={losReden}
                  onChange={(e) => setLosReden(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                />
              </div>
            </div>
          )}

          {/* Preview subtotaal */}
          {previewTotaal > 0 && (
            <div className={`rounded-lg px-4 py-3 text-sm ${overschrijdt ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              <div className={`flex justify-between ${overschrijdt ? 'text-red-700' : 'text-emerald-800'}`}>
                <span>Subtotaal creditnota</span>
                <span className="tabular-nums">{formatCurrency(previewSubtotaal)}</span>
              </div>
              {btwPct > 0 && (
                <div className={`flex justify-between mt-0.5 ${overschrijdt ? 'text-red-600' : 'text-emerald-700'}`}>
                  <span>BTW {btwPct}%</span>
                  <span className="tabular-nums">{formatCurrency(previewBtw)}</span>
                </div>
              )}
              <div className={`flex justify-between font-semibold border-t mt-1.5 pt-1.5 ${overschrijdt ? 'border-red-300 text-red-800' : 'border-emerald-300 text-emerald-900'}`}>
                <span>Totaal creditnota</span>
                <span className="tabular-nums">− {formatCurrency(previewTotaal)}</span>
              </div>
              {overschrijdt && (
                <p className="text-red-700 text-xs mt-1.5">
                  Dit overschrijdt het resterende kredietlimiet van {formatCurrency(resterendLimiet)}.
                </p>
              )}
            </div>
          )}

          {/* Toggles */}
          <div className="space-y-3 pt-1 border-t border-slate-100">
            {methode === 'orderregel' && (
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => setVoorraadBijwerken(!voorraadBijwerken)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${voorraadBijwerken ? 'bg-terracotta-500' : 'bg-slate-300'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${voorraadBijwerken ? 'translate-x-4' : ''}`}
                  />
                </div>
                <span className="text-sm text-slate-700">Voorraad bijwerken <span className="text-slate-400">(alleen producten, niet verzend- of kortingsregels)</span></span>
              </label>
            )}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setVerzenden(!verzenden)}
                className={`relative h-5 w-9 rounded-full transition-colors ${verzenden ? 'bg-terracotta-500' : 'bg-slate-300'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${verzenden ? 'translate-x-4' : ''}`}
                />
              </div>
              <span className="text-sm text-slate-700">Creditfactuur direct e-mailen naar klant</span>
            </label>
          </div>

          {/* Fout */}
          {fout && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{fout}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={bezig}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={bezig || resterendLimiet <= 0.01 || overschrijdt}
            className="flex items-center gap-2 rounded-lg bg-terracotta-600 px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-700 disabled:opacity-50"
          >
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
            {bezig
              ? 'Bezig…'
              : verzenden
              ? 'Aanmaken & versturen'
              : 'Creditnota aanmaken'}
          </button>
        </div>
      </div>
    </div>
  )
}
