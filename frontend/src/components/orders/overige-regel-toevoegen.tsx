// Handmatig een admin-pseudo-regel (her)toevoegen aan een order — VERZEND,
// VORMTOESLAG, DROPSHIP-KLEIN/-GROOT, BUNDELKORTING, DREMPELKORTING
// (`producten.is_pseudo=TRUE`, ADR-0018). Deze artikelen zijn met opzet
// overal elders verborgen uit de normale artikel-zoekers (KwaliteitFirstSelector/
// MaatwerkArtikelPicker/ArticleSelector filteren allemaal `is_pseudo=false`) —
// dit is de enige plek waar je ze bewust weer kan opzoeken en terugzetten.
//
// Aanleiding: gebruiker verwijderde per ongeluk de VORMTOESLAG-companion-regel
// (mig 465) van een maatwerk-regel en kon 'm nergens terugzetten.
//
// VORMTOESLAG is een bijzonder geval: het is geen order-brede regel maar een
// companion die altijd direct ná zijn maatwerk-regel moet staan (array-positie-
// convention, zie vorm-toeslag-regel.ts). Voor dat artikel toont deze
// component daarom een extra stap "bij welke maatwerk-regel hoort dit?" en
// hergebruikt `syncVormToeslagRegel` — dezelfde functie die de companion ook
// bijhoudt bij een normale prijs-wijziging — zodat de regel op de juiste
// positie met de juiste (al op de parent bewaarde) toeslag terugkomt. De
// overige pseudo-artikelen zijn order-niveau en worden gewoon achteraan
// toegevoegd.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/formatters'
import { berekenRegelBedrag } from '@/lib/orders/bedrag'
import { syncVormToeslagRegel, VORMTOESLAG_ARTIKEL_ID } from '@/lib/orders/vorm-toeslag-regel'
import type { MaatwerkVormRow } from '@/modules/maatwerk'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

interface PseudoProduct {
  artikelnr: string
  omschrijving: string
  verkoopprijs: number | null
}

async function fetchPseudoProducten(): Promise<PseudoProduct[]> {
  const { data, error } = await supabase
    .from('producten')
    .select('artikelnr, omschrijving, verkoopprijs')
    .eq('is_pseudo', true)
    .order('omschrijving')
  if (error) throw error
  return (data ?? []) as PseudoProduct[]
}

interface Props {
  lines: OrderRegelFormData[]
  onChange: (lines: OrderRegelFormData[]) => void
  vormen: MaatwerkVormRow[]
}

export function OverigeRegelToevoegen({ lines, onChange, vormen }: Props) {
  const [open, setOpen] = useState(false)
  const [gekozenProduct, setGekozenProduct] = useState<PseudoProduct | null>(null)
  const { data: producten = [] } = useQuery({
    queryKey: ['producten', 'pseudo'],
    queryFn: fetchPseudoProducten,
    staleTime: 5 * 60 * 1000,
  })

  // Maatwerk-regels die een vormtoeslag horen te hebben (parent.maatwerk_vorm_toeslag
  // > 0) maar waarvan de companion-regel er nu niet (meer) direct achter staat.
  const maatwerkZonderVormtoeslagRegel = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) =>
      l.is_maatwerk
      && (l.maatwerk_vorm_toeslag ?? 0) > 0
      && lines[i + 1]?.artikelnr !== VORMTOESLAG_ARTIKEL_ID,
    )

  function sluitAf() {
    setOpen(false)
    setGekozenProduct(null)
  }

  function voegOrderNiveauRegelToe(product: PseudoProduct) {
    const prijs = product.verkoopprijs ?? 0
    const aantal = 1
    const newLine: OrderRegelFormData = {
      artikelnr: product.artikelnr,
      omschrijving: product.omschrijving,
      orderaantal: aantal,
      te_leveren: aantal,
      prijs,
      korting_pct: 0,
      bedrag: berekenRegelBedrag(prijs, aantal, 0),
      is_maatwerk: false,
      is_pseudo: true,
    }
    onChange([...lines, newLine])
    sluitAf()
  }

  function voegVormtoeslagToe(parentIndex: number) {
    const parent = lines[parentIndex]
    const vormCode = parent.maatwerk_vorm ?? 'rechthoek'
    const vormNaam = vormen.find((v) => v.code === vormCode)?.naam ?? vormCode
    onChange(syncVormToeslagRegel(lines, parentIndex, vormNaam))
    sluitAf()
  }

  function kiesProduct(product: PseudoProduct) {
    if (product.artikelnr === VORMTOESLAG_ARTIKEL_ID) {
      // Maar 1 kandidaat-parent? Meteen toevoegen, geen onnodige tussenstap.
      if (maatwerkZonderVormtoeslagRegel.length === 1) {
        voegVormtoeslagToe(maatwerkZonderVormtoeslagRegel[0].i)
        return
      }
      setGekozenProduct(product)
      return
    }
    voegOrderNiveauRegelToe(product)
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        title="Handmatig een administratieve regel toevoegen (verzendkosten, vormtoeslag, dropshipment, korting) — bv. om een per ongeluk verwijderde regel terug te zetten"
      >
        <Plus size={13} />
        Overige regel toevoegen
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-[var(--radius)] border border-slate-200 bg-white p-2 shadow-lg">
          {!gekozenProduct ? (
            <>
              <div className="px-1 pb-1.5 text-xs font-medium text-slate-500">
                Welke administratieve regel?
              </div>
              <div className="space-y-0.5">
                {producten.length === 0 && (
                  <div className="px-2 py-2 text-xs text-slate-400">Laden…</div>
                )}
                {producten.map((p) => (
                  <button
                    key={p.artikelnr}
                    type="button"
                    onClick={() => kiesProduct(p)}
                    disabled={p.artikelnr === VORMTOESLAG_ARTIKEL_ID && maatwerkZonderVormtoeslagRegel.length === 0}
                    className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      p.artikelnr === VORMTOESLAG_ARTIKEL_ID && maatwerkZonderVormtoeslagRegel.length === 0
                        ? 'Geen maatwerk-regel in deze order mist een vormtoeslag'
                        : undefined
                    }
                  >
                    <span>{p.omschrijving}</span>
                    {p.verkoopprijs != null && (
                      <span className="ml-2 shrink-0 text-slate-400">{formatCurrency(p.verkoopprijs)}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="px-1 pb-1.5 text-xs font-medium text-slate-500">
                Bij welke maatwerk-regel hoort de vormtoeslag?
              </div>
              <div className="space-y-0.5">
                {maatwerkZonderVormtoeslagRegel.map(({ l, i }) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => voegVormtoeslagToe(i)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="truncate">{l.omschrijving}</span>
                    <span className="ml-2 shrink-0 text-slate-400">{formatCurrency(l.maatwerk_vorm_toeslag ?? 0)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setGekozenProduct(null)}
                className="mt-1.5 px-2 py-1 text-xs text-slate-400 hover:text-slate-600"
              >
                ← Terug
              </button>
            </>
          )}
          <button
            type="button"
            onClick={sluitAf}
            className="mt-1 w-full rounded-[var(--radius-sm)] px-2 py-1 text-center text-xs text-slate-400 hover:text-slate-600"
          >
            Annuleren
          </button>
        </div>
      )}
    </div>
  )
}
