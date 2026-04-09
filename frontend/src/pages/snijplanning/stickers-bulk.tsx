import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { useSnijplannenVoorGroep, useRolSnijstukken } from '@/hooks/use-snijplanning'

export function StickersBulkPage() {
  const [params] = useSearchParams()
  const kwaliteit = params.get('kwaliteit') ?? ''
  const kleur = params.get('kleur') ?? ''
  const rolParam = params.get('rol')
  const rolId = rolParam && Number.isFinite(Number(rolParam)) ? Number(rolParam) : null
  const statusFilter = params.get('status')

  // Haal stukken op: per groep OF per rol (niet beide)
  const { data: groepStukken } = useSnijplannenVoorGroep(kwaliteit, kleur, !rolId && !!kwaliteit && !!kleur)
  const { data: rolStukken } = useRolSnijstukken(rolId)

  const alleStukken = rolStukken ?? groepStukken ?? []
  const stukken = statusFilter
    ? alleStukken.filter(s => s.status === statusFilter)
    : alleStukken

  const title = rolId
    ? `Stickers — Rol`
    : `Stickers — ${kwaliteit} ${kleur}`

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={`${stukken.length} stukken × 2 stickers = ${stukken.length * 2} stickers`}
          actions={
            <div className="flex items-center gap-3">
              <Link
                to="/snijplanning"
                className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft size={16} />
                Terug
              </Link>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 transition-colors"
              >
                <Printer size={16} />
                Alles printen ({stukken.length * 2} stickers)
              </button>
            </div>
          }
        />
      </div>

      {/* Stickers grid — 2 per stuk */}
      <div className="sticker-print-area">
        {stukken.map((stuk) => (
          <div key={stuk.id} className="mb-4 print:mb-0">
            <div className="text-xs text-slate-400 mb-1 print:hidden">
              {stuk.snijplan_nr} — {stuk.klant_naam}
            </div>
            <div className="flex flex-col items-start gap-2 print:gap-0">
              <StickerLayout snijplan={stuk} label="Sticker tapijt" />
              <StickerLayout snijplan={stuk} label="Sticker orderdossier" />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .sticker-print-area,
          .sticker-print-area * { visibility: visible; }
          .sticker-print-area {
            position: absolute;
            top: 0;
            left: 0;
          }
          .sticker-label {
            page-break-after: always;
            margin: 0;
            border: none;
          }
          @page {
            size: 100mm 60mm;
            margin: 0;
          }
        }
      `}</style>
    </>
  )
}
