import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { useStickerData } from '@/modules/snijplanning'

export function StickerPrintPage() {
  const { id } = useParams<{ id: string }>()
  const snijplanId = Number(id)
  const { data: sticker, isLoading } = useStickerData(
    Number.isFinite(snijplanId) ? snijplanId : null,
  )

  if (isLoading) {
    return (
      <div className="print:hidden">
        <PageHeader title="Stickers laden..." />
        <div className="text-slate-400">Even geduld...</div>
      </div>
    )
  }

  if (!sticker) {
    return (
      <div className="print:hidden">
        <PageHeader title="Snijplan niet gevonden" />
        <Link to="/snijplanning" className="text-terracotta-500 hover:underline">
          Terug naar snijplanning
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Screen-only controls */}
      <div className="print:hidden">
        <PageHeader
          title={`Stickers — ${sticker.snijplan_nr}`}
          description={`${sticker.kwaliteit_naam} ${sticker.kleur_code} — ${sticker.klant_naam}`}
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
                Printen
              </button>
            </div>
          }
        />

        <p className="text-sm text-slate-500 mb-6">
          Twee identieke stickers: één voor het tapijt, één voor het orderdossier.
        </p>
      </div>

      {/* Stickers — visible on both screen and print */}
      <div className="sticker-print-area flex flex-col items-start gap-4">
        <StickerLayout sticker={sticker} label="Sticker tapijt" />
        <StickerLayout sticker={sticker} label="Sticker orderdossier" />
      </div>

      {/* Print styles */}
      <style>{`
        @media screen {
          .sticker-label {
            border: 1px dashed #cbd5e1;
          }
        }
        @media print {
          /* Hide everything except stickers */
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
            size: 148mm 106mm;
            margin: 0;
          }
        }
      `}</style>
    </>
  )
}
