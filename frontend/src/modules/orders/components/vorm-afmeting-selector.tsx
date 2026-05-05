import { useState, useEffect } from 'react'
import type { MaatwerkVormRow, AfwerkingTypeRow } from '@/lib/supabase/queries/op-maat'
import { formatCurrency } from '@/lib/utils/formatters'

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
  onChange: (data: VormAfmetingData) => void
}

export function VormAfmetingSelector({
  vormen,
  afwerkingen,
  standaardAfwerking,
  standaardBandKleur,
  maxBreedteCm,
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

  // Sync naar parent bij elke datawijziging
  useEffect(() => {
    onChange(data)
  }, [data, onChange])

  // Initialiseer standaard vorm zodra vormen laden
  useEffect(() => {
    if (vormen.length > 0) {
      setData((prev) => prev.vormCode ? prev : { ...prev, vormCode: vormen[0].code })
    }
  }, [vormen])

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

  function update(partial: Partial<VormAfmetingData>) {
    setData((prev) => ({ ...prev, ...partial }))
  }

  const selectedVorm = vormen.find((v) => v.code === data.vormCode)
  const isDiameter = selectedVorm?.afmeting_type === 'diameter'
  const selectedAfwerking = afwerkingen.find((a) => a.code === data.afwerkingCode)

  const breedteWaarde = isDiameter ? data.diameterCm : data.breedteCm
  const showBreedteWarning = maxBreedteCm != null && breedteWaarde != null && breedteWaarde > maxBreedteCm

  return (
    <div className="space-y-4">
      {/* Vorm + afmetingen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Vorm dropdown */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vorm</label>
          <select
            value={data.vormCode}
            onChange={(e) => {
              const newVorm = vormen.find((v) => v.code === e.target.value)
              const newIsDiameter = newVorm?.afmeting_type === 'diameter'
              update({
                vormCode: e.target.value,
                lengteCm: newIsDiameter ? undefined : data.lengteCm,
                breedteCm: newIsDiameter ? undefined : data.breedteCm,
                diameterCm: newIsDiameter ? data.diameterCm : undefined,
              })
            }}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
          >
            {vormen.map((v) => (
              <option key={v.code} value={v.code}>
                {v.naam}{v.toeslag > 0 ? ` (+${formatCurrency(v.toeslag)})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Dynamische afmeting inputs */}
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

      {/* Afwerking rij */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Afwerking dropdown */}
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

        {/* Bandkleur — alleen als afwerking heeft_band_kleur */}
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

        {/* Instructies */}
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
