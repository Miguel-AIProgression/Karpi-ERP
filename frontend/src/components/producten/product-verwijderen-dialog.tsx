import { useState, type FormEvent } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeleteProduct } from '@/hooks/use-producten'
import type { ProductDetail } from '@/lib/supabase/queries/producten'

interface Props {
  product: ProductDetail
  onClose: () => void
}

export function ProductVerwijderenDialog({ product, onClose }: Props) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const verwijder = useDeleteProduct()

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    verwijder.mutate(product.artikelnr, {
      onSuccess: () => navigate('/producten'),
      onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Artikel verwijderen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <p>
              Artikel <span className="font-mono">{product.artikelnr}</span>{' '}
              ({product.omschrijving}) wordt definitief verwijderd. Dit kan niet
              ongedaan gemaakt worden. Is het artikel nog ergens in gebruik
              (rollen, orders, inkooporders, ...), dan weigert de database dit.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button type="submit" disabled={verwijder.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {verwijder.isPending ? 'Bezig…' : 'Verwijderen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
