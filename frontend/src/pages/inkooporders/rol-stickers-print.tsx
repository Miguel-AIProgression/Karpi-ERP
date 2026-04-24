import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RolStickerLayout } from '@/components/inkooporders/rol-sticker-layout'
import { fetchRollenVoorStickers } from '@/lib/supabase/queries/inkooporders'

export function RolStickersPrintPage() {
  const [searchParams] = useSearchParams()
  const ids = useMemo(() => {
    const raw = searchParams.get('ids') ?? ''
    return raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  }, [searchParams])

  const { data: rollen, isLoading, error } = useQuery({
    queryKey: ['rol-stickers', ids],
    queryFn: () => fetchRollenVoorStickers(ids),
    enabled: ids.length > 0,
  })

  if (ids.length === 0) {
    return (
      <div className="print:hidden p-12 text-center">
        <PageHeader title="Geen rollen opgegeven" />
        <Link to="/inkoop" className="text-terracotta-500 hover:underline">
          Terug naar inkoop
        </Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="print:hidden">
        <PageHeader title="Stickers laden…" />
        <div className="text-slate-400">Even geduld…</div>
      </div>
    )
  }

  if (error || !rollen || rollen.length === 0) {
    return (
      <div className="print:hidden p-12 text-center">
        <PageHeader title="Geen rollen gevonden" />
        <pre className="text-xs text-slate-500 bg-slate-50 p-3 rounded max-w-xl mx-auto text-left overflow-auto">
          {error instanceof Error ? error.message : 'Onbekende fout'}
        </pre>
        <Link to="/inkoop" className="text-terracotta-500 hover:underline">
          Terug naar inkoop
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Stickers — ${rollen.length} rol${rollen.length === 1 ? '' : 'len'}`}
          description="Eén sticker per fysieke rol — plak op het tapijt."
          actions={
            <div className="flex items-center gap-3">
              <Link
                to="/inkoop"
                className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100"
              >
                <ArrowLeft size={16} />
                Terug
              </Link>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
              >
                <Printer size={16} />
                Printen
              </button>
            </div>
          }
        />
      </div>

      <div className="sticker-print-area flex flex-col items-start gap-4">
        {rollen.map((r) => (
          <RolStickerLayout key={r.id} rol={r} />
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
