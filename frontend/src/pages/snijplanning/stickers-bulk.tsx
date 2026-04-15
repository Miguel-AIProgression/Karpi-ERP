import { useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { ReststukStickerLayout } from '@/components/snijplanning/reststuk-sticker-layout'
import { useSnijplannenVoorGroep, useRolSnijstukken } from '@/hooks/use-snijplanning'
import { supabase } from '@/lib/supabase/client'

interface ReststukRol {
  id: number
  rolnummer: string
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  reststuk_datum: string | null
  oorsprong_rol_id: number | null
}

function useReststukkenVoorRollen(rolIds: number[]) {
  const sortedIds = [...rolIds].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['reststukken-voor-rollen', sortedIds],
    queryFn: async (): Promise<ReststukRol[]> => {
      if (rolIds.length === 0) return []
      const { data, error } = await supabase
        .from('rollen')
        .select('id, rolnummer, kwaliteit_code, kleur_code, lengte_cm, breedte_cm, reststuk_datum, oorsprong_rol_id')
        .in('oorsprong_rol_id', rolIds)
        .in('rol_type', ['reststuk', 'aangebroken'])
        .order('rolnummer', { ascending: true })
      if (error) throw error
      return (data ?? []) as ReststukRol[]
    },
    enabled: rolIds.length > 0,
  })
}

export function StickersBulkPage() {
  const [params] = useSearchParams()
  const kwaliteit = params.get('kwaliteit') ?? ''
  const kleur = params.get('kleur') ?? ''
  const rolParam = params.get('rol')
  const rolId = rolParam && Number.isFinite(Number(rolParam)) ? Number(rolParam) : null
  const statusFilter = params.get('status')

  const { data: groepStukken } = useSnijplannenVoorGroep(kwaliteit, kleur, !rolId && !!kwaliteit && !!kleur)
  const { data: rolStukken } = useRolSnijstukken(rolId)

  const alleStukken = rolStukken ?? groepStukken ?? []
  const stukken = statusFilter
    ? alleStukken.filter(s => s.status === statusFilter)
    : alleStukken

  const rolIdsUitStukken = Array.from(
    new Set(stukken.map(s => s.rol_id).filter((id): id is number => id !== null))
  )
  const { data: reststukken = [] } = useReststukkenVoorRollen(rolIdsUitStukken)

  // Preview reststukken uit modal (nog niet in DB — voltooi_snijplan_rol niet gedraaid)
  const previewReststukken = useMemo(() => {
    if (!rolId) return [] as { rolnummer: string; kwaliteit_code: string; kleur_code: string; lengte_cm: number; breedte_cm: number }[]
    const raw = sessionStorage.getItem(`reststuk-preview-${rolId}`)
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }, [rolId])

  const title = rolId
    ? `Stickers — Rol`
    : `Stickers — ${kwaliteit} ${kleur}`

  const totaalReststukken = reststukken.length + previewReststukken.length
  const totaalStickers = stukken.length * 2 + totaalReststukken
  const beschrijving = totaalReststukken > 0
    ? `${stukken.length} stukken × 2 + ${totaalReststukken} reststukken = ${totaalStickers} stickers`
    : `${stukken.length} stukken × 2 stickers = ${totaalStickers} stickers`

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={beschrijving}
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
                Alles printen ({totaalStickers} stickers)
              </button>
            </div>
          }
        />
      </div>

      {/* Stickers grid — 2 per stuk + reststukken */}
      <div className="sticker-print-area">
        {stukken.map((stuk) => (
          <div key={stuk.id} className="mb-4 print:mb-0">
            <div className="flex flex-col items-start gap-2 print:gap-0">
              <StickerLayout snijplan={stuk} label="Sticker tapijt" />
              <StickerLayout snijplan={stuk} label="Sticker orderdossier" />
            </div>
          </div>
        ))}

        {reststukken.map((r) => (
          <div key={`rest-${r.id}`} className="mb-4 print:mb-0">
            <ReststukStickerLayout
              rolnummer={r.rolnummer}
              kwaliteit={r.kwaliteit_code}
              kleur={r.kleur_code}
              lengte_cm={r.lengte_cm}
              breedte_cm={r.breedte_cm}
              datum={r.reststuk_datum
                ? new Date(r.reststuk_datum).toLocaleDateString('nl-NL')
                : ''}
            />
          </div>
        ))}

        {previewReststukken.map((r, i) => (
          <div key={`rest-preview-${i}`} className="mb-4 print:mb-0">
            <ReststukStickerLayout
              rolnummer={r.rolnummer}
              kwaliteit={r.kwaliteit_code}
              kleur={r.kleur_code}
              lengte_cm={r.lengte_cm}
              breedte_cm={r.breedte_cm}
              datum={new Date().toLocaleDateString('nl-NL')}
            />
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
