import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchVormMaten,
  type MaatwerkVormRow,
  type AfwerkingTypeRow,
} from '@/lib/supabase/queries/op-maat'
import { formatCurrency } from '@/lib/utils/formatters'
import { VormTegel } from './vorm-tegel'
import { VormMaatChip } from './vorm-maat-chip'

export interface VormAfmetingData {
  vormCode: string
  lengteCm?: number
  breedteCm?: number
  diameterCm?: number
  afwerkingCode: string
  bandKleur: string
  instructies: string
}

interface VormAfmetingSelectorProps {
  vormen: MaatwerkVormRow[]
  afwerkingen: AfwerkingTypeRow[]
  standaardAfwerking: string | null
  standaardBandKleur: string | null
  maxBreedteCm: number | null
  alleenRechtMaatwerk: boolean
  onChange: (data: VormAfmetingData) => void
}

export function VormAfmetingSelector({
  vormen,
  afwerkingen,
  standaardAfwerking,
  standaardBandKleur,
  maxBreedteCm,
  alleenRechtMaatwerk,
  onChange,
}: VormAfmetingSelectorProps) {
  const [data, setData] = useState<VormAfmetingData>({
    vormCode: vormen[0]?.code ?? '',
    lengteCm: undefined,
    breedteCm: undefined,
    diameterCm: undefined,
    afwerkingCode: '',
    bandKleur: '',
    instructies: '',
  })
  const [afwijkendeMaten, setAfwijkendeMaten] = useState(false)

  // Beperk vormen tot rechthoek bij Beach Life-achtige kwaliteiten
  const beschikbareVormen = useMemo(
    () => (alleenRechtMaatwerk ? vormen.filter((v) => v.code === 'rechthoek') : vormen),
    [vormen, alleenRechtMaatwerk],
  )

  // Sync naar parent bij elke datawijziging
  useEffect(() => {
    onChange(data)
  }, [data, onChange])

  // Forceer geldige vorm: als huidige vormCode niet (meer) in beschikbareVormen voorkomt
  useEffect(() => {
    if (beschikbareVormen.length > 0) {
      const isInLijst = beschikbareVormen.some((v) => v.code === data.vormCode)
      if (!isInLijst) {
        setData((prev) => ({ ...prev, vormCode: beschikbareVormen[0].code }))
      }
    }
  }, [beschikbareVormen, data.vormCode])

  // Pre-fill afwerking vanuit kwaliteit+kleur default
  useEffect(() => {
    if (standaardAfwerking) {
      setData((prev) =>
        prev.afwerkingCode === standaardAfwerking ? prev : { ...prev, afwerkingCode: standaardAfwerking }
      )
    }
  }, [standaardAfwerking])

  // Pre-fill bandkleur vanuit kwaliteit+kleur default
  useEffect(() => {
    if (standaardBandKleur) {
      setData((prev) =>
        prev.bandKleur === standaardBandKleur ? prev : { ...prev, bandKleur: standaardBandKleur }
      )
    }
  }, [standaardBandKleur])

  // Vaste-maat-suggesties (mig 180): tonen als vorm geen kan_afwijkende_maten heeft
  const { data: vormMaten = [] } = useQuery({
    queryKey: ['vorm-maten', data.vormCode],
    queryFn: () => fetchVormMaten(data.vormCode),
    enabled: !!data.vormCode,
  })

  // Reset toggle bij vormwissel
  useEffect(() => {
    setAfwijkendeMaten(false)
  }, [data.vormCode])

  function update(partial: Partial<VormAfmetingData>) {
    setData((prev) => ({ ...prev, ...partial }))
  }

  const selectedVormRow = beschikbareVormen.find((v) => v.code === data.vormCode)
  const isDiameter = selectedVormRow?.afmeting_type === 'diameter'
  const kanAfwijkend = selectedVormRow?.kan_afwijkende_maten ?? true
  const selectedAfwerking = afwerkingen.find((a) => a.code === data.afwerkingCode)

  const breedteWaarde = isDiameter ? data.diameterCm : data.breedteCm
  const showBreedteWarning = maxBreedteCm != null && breedteWaarde != null && breedteWaarde > maxBreedteCm

  const toonAfmetingInputs = afwijkendeMaten || vormMaten.length === 0

  return (
    <div className="space-y-4">
      {alleenRechtMaatwerk && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] p-2">
          Deze kwaliteit kan alleen in recht maatwerk geproduceerd worden.
        </p>
      )}

      {/* Vorm tegel-grid */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Vorm</label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {beschikbareVormen.map((v) => (
            <VormTegel
              key={v.code}
              vorm={v}
              selected={data.vormCode === v.code}
              onClick={() => {
                const newIsDiameter = v.afmeting_type === 'diameter'
                update({
                  vormCode: v.code,
                  lengteCm: newIsDiameter ? undefined : data.lengteCm,
                  breedteCm: newIsDiameter ? undefined : data.breedteCm,
                  diameterCm: newIsDiameter ? data.diameterCm : undefined,
                })
              }}
            />
          ))}
        </div>
      </div>

      {/* Vaste-maten chips */}
      {vormMaten.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Maat</label>
          <div className="flex flex-wrap gap-2">
            {vormMaten.map((m) => {
              const isActive = m.diameter_cm
                ? data.diameterCm === m.diameter_cm
                : data.lengteCm === m.lengte_cm && data.breedteCm === m.breedte_cm
              return (
                <VormMaatChip
                  key={m.id}
                  maat={m}
                  active={isActive}
                  onClick={() =>
                    update(
                      m.diameter_cm
                        ? { diameterCm: m.diameter_cm, lengteCm: undefined, breedteCm: undefined }
                        : { lengteCm: m.lengte_cm!, breedteCm: m.breedte_cm!, diameterCm: undefined },
                    )
                  }
                />
              )
            })}
          </div>

          {kanAfwijkend && (
            <button
              type="button"
              onClick={() => setAfwijkendeMaten((p) => !p)}
              className="text-xs text-purple-700 underline mt-2"
            >
              {afwijkendeMaten ? '← terug naar standaardmaten' : 'Afwijkende maat invoeren →'}
            </button>
          )}
        </div>
      )}

      {/* Afmeting inputs — alleen tonen als geen chips of toggle aan */}
      {toonAfmetingInputs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isDiameter ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Diameter (cm)</label>
              <input
                type="number"
                min={1}
                step={1}
                value={data.diameterCm ?? ''}
                onChange={(e) => update({ diameterCm: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="bijv. 200"
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
              />
              {showBreedteWarning && (
                <p className="mt-1 text-xs text-red-600">
                  Let op: maximale rolbreedte is {maxBreedteCm} cm
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Lengte (cm)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={data.lengteCm ?? ''}
                  onChange={(e) => update({ lengteCm: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="bijv. 300"
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Breedte (cm)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={data.breedteCm ?? ''}
                  onChange={(e) => update({ breedteCm: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="bijv. 400"
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
                />
                {showBreedteWarning && (
                  <p className="mt-1 text-xs text-red-600">
                    Let op: maximale rolbreedte is {maxBreedteCm} cm
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Afwerking rij */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Afwerking</label>
          <select
            value={data.afwerkingCode}
            onChange={(e) => update({ afwerkingCode: e.target.value, bandKleur: '' })}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
          >
            <option value="">Geen afwerking</option>
            {afwerkingen.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.naam}{a.prijs > 0 ? ` (+${formatCurrency(a.prijs)})` : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedAfwerking?.heeft_band_kleur && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Bandkleur</label>
            <input
              type="text"
              value={data.bandKleur}
              onChange={(e) => update({ bandKleur: e.target.value })}
              placeholder="bijv. zwart"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
            />
          </div>
        )}

        <div className={selectedAfwerking?.heeft_band_kleur ? '' : 'sm:col-span-2'}>
          <label className="block text-sm font-medium text-slate-700 mb-1">Instructies</label>
          <input
            type="text"
            value={data.instructies}
            onChange={(e) => update({ instructies: e.target.value })}
            placeholder="Extra snij/confectie instructies..."
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
          />
        </div>
      </div>
    </div>
  )
}
