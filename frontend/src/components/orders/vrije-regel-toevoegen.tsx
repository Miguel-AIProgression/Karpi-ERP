// Mig 524: vrije omschrijvingsregel toevoegen — operator vult zelf omschrijving
// en prijs in, zonder artikelnr. Geen voorraadinvloed, geen snijplan.
// Wordt aangeduid met is_vrije_regel=TRUE zodat de pickbaarheids-view en
// de zending-regels-trigger hem overslaan.
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { berekenRegelBedrag } from '@/lib/orders/bedrag'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

interface Props {
  lines: OrderRegelFormData[]
  onChange: (lines: OrderRegelFormData[]) => void
}

export function VrijeRegelToevoegen({ lines, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [omschrijving, setOmschrijving] = useState('')
  const [prijs, setPrijs] = useState('')
  const [aantal, setAantal] = useState('1')

  function reset() {
    setOmschrijving('')
    setPrijs('')
    setAantal('1')
    setOpen(false)
  }

  function voegToe() {
    const parsedPrijs = parseFloat(prijs.replace(',', '.'))
    const parsedAantal = parseInt(aantal, 10)
    if (!omschrijving.trim()) return
    if (!Number.isFinite(parsedPrijs) || parsedPrijs < 0) return
    if (!Number.isFinite(parsedAantal) || parsedAantal < 1) return

    const regel: OrderRegelFormData = {
      artikelnr: undefined,
      is_vrije_regel: true,
      omschrijving: omschrijving.trim(),
      orderaantal: parsedAantal,
      te_leveren: parsedAantal,
      prijs: parsedPrijs,
      korting_pct: 0,
      bedrag: berekenRegelBedrag(parsedPrijs, parsedAantal, 0),
      gewicht_kg: undefined,
    }

    onChange([...lines, regel])
    reset()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-slate-50 transition-colors"
        title="Vrije omschrijvingsregel — geen artikel, zelf omschrijving en prijs invullen"
      >
        <Plus className="h-3 w-3" />
        Vrije regel
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 bg-slate-50 border border-slate-200 rounded-[var(--radius-sm)] px-3 py-2">
      <div className="flex-1 min-w-[180px]">
        <label className="block text-xs text-slate-500 mb-0.5">Omschrijving *</label>
        <input
          autoFocus
          type="text"
          value={omschrijving}
          onChange={(e) => setOmschrijving(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }}
          placeholder="bv. Transportkosten, Spoedtoeslag…"
          className="w-full border border-slate-300 rounded-[var(--radius-sm)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>
      <div className="w-28">
        <label className="block text-xs text-slate-500 mb-0.5">Prijs (€) *</label>
        <input
          type="text"
          inputMode="decimal"
          value={prijs}
          onChange={(e) => setPrijs(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }}
          placeholder="0,00"
          className="w-full border border-slate-300 rounded-[var(--radius-sm)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>
      <div className="w-16">
        <label className="block text-xs text-slate-500 mb-0.5">Aantal</label>
        <input
          type="number"
          min="1"
          value={aantal}
          onChange={(e) => setAantal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }}
          className="w-full border border-slate-300 rounded-[var(--radius-sm)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>
      <button
        type="button"
        onClick={voegToe}
        disabled={!omschrijving.trim() || !prijs}
        className="px-3 py-1 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
      >
        Toevoegen
      </button>
      <button
        type="button"
        onClick={reset}
        className="p-1 text-slate-400 hover:text-slate-600"
        title="Annuleren"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
