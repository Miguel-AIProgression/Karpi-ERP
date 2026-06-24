import { useState } from 'react'
import { Scissors, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useKandidaatRollenVoorConversie, useConverteerNaarMaatwerk } from '@/modules/snijplanning'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import { useAuth } from '@/hooks/use-auth'

interface OmzettenNaarMaatwerkDialogProps {
  regel: OrderRegel
  orderId: number
  onClose: () => void
}

/** Zet een vaste-maat-orderregel zonder dekking om naar maatwerk — mits er
 *  een eigen of uitwisselbare rol groot genoeg is om uit te snijden (mig 472). */
export function OmzettenNaarMaatwerkDialog({ regel, orderId, onClose }: OmzettenNaarMaatwerkDialogProps) {
  const [lengteCm, setLengteCm] = useState(regel.product_lengte_cm ?? 0)
  const [breedteCm, setBreedteCm] = useState(regel.product_breedte_cm ?? 0)
  // Externe vertegenwoordiger (mig 489): read-only — geen maatwerk-conversie.
  const { isExternRep } = useAuth()

  const kwaliteitCode = regel.product_kwaliteit_code
  const kleurCode = regel.product_kleur_code
  const maatGeldig = lengteCm > 0 && breedteCm > 0

  const { data: kandidaten, isLoading: kandidatenLoading } = useKandidaatRollenVoorConversie(
    kwaliteitCode && kleurCode && maatGeldig
      ? { kwaliteitCode, kleurCode, lengteCm, breedteCm }
      : null,
  )

  const mutation = useConverteerNaarMaatwerk()

  if (isExternRep) return null

  const heeftKandidaat = (kandidaten?.length ?? 0) > 0
  const kanBevestigen = heeftKandidaat && !mutation.isPending

  function bevestig() {
    mutation.mutate(
      { orderRegelId: regel.id, orderId, lengteCm, breedteCm },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-terracotta-500" />
            <h2 className="font-semibold text-slate-900">Zet om naar maatwerk</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600">
            {regel.omschrijving} wordt uit een rol gesneden i.p.v. uit voorraad/inkoop besteld.
            Bevestig de afmeting — de bestaande claim op deze regel wordt vrijgegeven.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Lengte (cm)</label>
              <input
                type="number"
                min={1}
                value={lengteCm || ''}
                onChange={(e) => setLengteCm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Breedte (cm)</label>
              <input
                type="number"
                min={1}
                value={breedteCm || ''}
                onChange={(e) => setBreedteCm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
            </div>
          </div>

          {!kwaliteitCode || !kleurCode ? (
            <p className="text-sm text-rose-600">Geen kwaliteit/kleur bekend voor dit artikel — omzetten niet mogelijk.</p>
          ) : !maatGeldig ? (
            <p className="text-sm text-slate-400">Vul een lengte en breedte in om kandidaat-rollen te zoeken.</p>
          ) : kandidatenLoading ? (
            <p className="text-sm text-slate-400">Rollen zoeken…</p>
          ) : heeftKandidaat ? (
            <div className="rounded-[var(--radius-sm)] bg-emerald-50 border border-emerald-100 px-3 py-2">
              <p className="text-sm text-emerald-700 flex items-center gap-1.5 font-medium">
                <CheckCircle2 size={14} /> {kandidaten!.length} kandidaat-{kandidaten!.length === 1 ? 'rol' : 'rollen'} gevonden
              </p>
              <ul className="mt-1 text-xs text-emerald-700 space-y-0.5">
                {kandidaten!.slice(0, 4).map((k) => (
                  <li key={k.rol_id}>
                    {k.rolnummer} — {k.kwaliteit_code}/{k.kleur_code} ({k.lengte_cm}×{k.breedte_cm} cm)
                    {!k.is_exact && ' · uitwisselbaar'}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-[var(--radius-sm)] bg-rose-50 border border-rose-100 px-3 py-2">
              <p className="text-sm text-rose-700 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} /> Geen rol beschikbaar — omzetten niet mogelijk
              </p>
              <p className="mt-1 text-xs text-rose-600">
                Geen eigen of uitwisselbare rol groot genoeg voor {lengteCm}×{breedteCm} cm.
              </p>
            </div>
          )}

          {mutation.isError && (
            <p className="text-sm text-rose-600">
              {mutation.error instanceof Error ? mutation.error.message : 'Omzetten mislukt'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={bevestig}
            disabled={!kanBevestigen}
            className="px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-40"
          >
            {mutation.isPending ? 'Omzetten…' : 'Zet om naar maatwerk'}
          </button>
        </div>
      </div>
    </div>
  )
}
