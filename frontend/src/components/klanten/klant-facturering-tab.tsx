import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { FactuurLijst } from '@/components/facturatie/factuur-lijst'

interface Props {
  debiteurNr: number
  factuurvoorkeur: 'per_zending' | 'wekelijks'
  emailFactuur: string | null
  btwPercentage: number
  btwNummer: string | null
}

export function KlantFactureringTab({
  debiteurNr, factuurvoorkeur, emailFactuur, btwPercentage, btwNummer,
}: Props) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['klanten', debiteurNr] })

  const voorkeurMut = useMutation({
    mutationFn: async (v: 'per_zending' | 'wekelijks') => {
      const { error } = await supabase.from('debiteuren')
        .update({ factuurvoorkeur: v }).eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess,
  })
  const btwMut = useMutation({
    mutationFn: async (v: number) => {
      const { error } = await supabase.from('debiteuren')
        .update({ btw_percentage: v }).eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess,
  })

  const btwWaarschuwing = btwPercentage === 0 && !btwNummer

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Factuurvoorkeur</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={factuurvoorkeur === 'per_zending'}
              onChange={() => voorkeurMut.mutate('per_zending')} />
            Direct na verzending
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={factuurvoorkeur === 'wekelijks'}
              onChange={() => voorkeurMut.mutate('wekelijks')} />
            Verzamelfactuur per week
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">E-mailadres factuur</h3>
        <div className="text-sm">
          {emailFactuur
            ? <span className="text-slate-600">{emailFactuur}</span>
            : <span className="text-red-600">Niet ingesteld — zonder e-mailadres kan geen factuur verstuurd worden</span>}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW-percentage</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min={0}
            max={100}
            defaultValue={btwPercentage}
            key={btwPercentage}
            onBlur={(e) => {
              const v = Number(e.currentTarget.value)
              if (!Number.isNaN(v) && v !== btwPercentage) btwMut.mutate(v)
            }}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-500">%</span>
          <button type="button" onClick={() => btwMut.mutate(21)}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">21% NL</button>
          <button type="button" onClick={() => btwMut.mutate(0)}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">0% EU/export</button>
        </div>
        {btwWaarschuwing && (
          <p className="mt-2 text-xs text-amber-700">
            Let op: 0% BTW zonder btw-nummer. Intracommunautaire verlegging vereist een
            geldig btw-nummer bij de afnemer — vul dat in op de Info-tab.
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Facturen</h3>
        <FactuurLijst debiteurNr={debiteurNr} />
      </section>
    </div>
  )
}
