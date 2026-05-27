import { useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { ReststukStickerLayout } from '@/components/snijplanning/reststuk-sticker-layout'
import { useSnijplannenVoorGroep, useRolSnijstukken, useStickerDataBulk } from '@/modules/snijplanning'
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

  // Sticker-data (klanteigen-naam, poolmateriaal, EAN) per snijplan, mig 295
  const snijplanIds = stukken.map(s => s.id)
  const { data: stickers = [] } = useStickerDataBulk(snijplanIds)
  const stickerById = new Map(stickers.map(s => [s.snijplan_id, s]))

  // Preview reststukken uit modal (nog niet in DB — voltooi_snijplan_rol niet gedraaid)
  const previewReststukken = useMemo(() => {
    type PreviewReststuk = { rolnummer: string; kwaliteit_code: string; kleur_code: string; lengte_cm: number; breedte_cm: number }
    if (!rolId) return [] as PreviewReststuk[]
    const raw = sessionStorage.getItem(`reststuk-preview-${rolId}`)
    if (!raw) return [] as PreviewReststuk[]
    try { return JSON.parse(raw) as PreviewReststuk[] } catch { return [] as PreviewReststuk[] }
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

        <div className="mb-4 rounded-[var(--radius-sm)] border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">⚠️ Print-instellingen (Ctrl+P) — anders ontstaan lege pagina's of valt content tegen de randen:</div>
          <ul className="ml-5 list-disc space-y-0.5 text-xs">
            <li>
              <strong>Papierformaat = Custom 148×106 mm</strong> (de stickerrol)
            </li>
            <li>
              <strong>Marges = Geen</strong> (onder "Meer instellingen")
            </li>
            <li>
              <strong>Schaal = 100% / Ware grootte</strong>
            </li>
            <li>
              Als de oude Edge-dialoog opent: vink <strong>"Laat de app mijn afdrukvoorkeuren wijzigen"</strong> aan.
            </li>
          </ul>
        </div>
      </div>

      {/* Stickers grid — 2 per stuk + reststukken. Plat-DOM: alle wrappers
          zijn DIRECTE children van .sticker-print-area zodat `+`-sibling
          en `:not(:last-of-type)`-selectoren in print-CSS werken voor
          page-breaks. Screen-spacing via `print:mb-0` op de wrappers. */}
      <div className="sticker-print-area flex flex-col items-start gap-2 print:gap-0">
        {stukken.flatMap((stuk) => {
          const sticker = stickerById.get(stuk.id)
          if (!sticker) return []
          return [
            <StickerLayout key={`${stuk.id}-tapijt`} sticker={sticker} label="Sticker tapijt" />,
            <StickerLayout key={`${stuk.id}-dossier`} sticker={sticker} label="Sticker orderdossier" />,
          ]
        })}

        {reststukken.map((r) => (
          <ReststukStickerLayout
            key={`rest-${r.id}`}
            rolnummer={r.rolnummer}
            kwaliteit={r.kwaliteit_code}
            kleur={r.kleur_code}
            lengte_cm={r.lengte_cm}
            breedte_cm={r.breedte_cm}
            datum={r.reststuk_datum
              ? new Date(r.reststuk_datum).toLocaleDateString('nl-NL')
              : ''}
          />
        ))}

        {previewReststukken.map((r, i) => (
          <ReststukStickerLayout
            key={`rest-preview-${i}`}
            rolnummer={r.rolnummer}
            kwaliteit={r.kwaliteit_code}
            kleur={r.kleur_code}
            lengte_cm={r.lengte_cm}
            breedte_cm={r.breedte_cm}
            datum={new Date().toLocaleDateString('nl-NL')}
          />
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
            gap: 0 !important;
          }
          /* Belt-and-suspenders: ook als tailwind print:hidden zou falen,
             expliciet de screen-only labels (sub-titels boven elke sticker)
             weghalen. Zonder dit kost de label-span ~5mm extra wrapper-
             hoogte → 106mm @page-hoogte overflow → blanco vervolgpagina per
             sticker (root cause van de "1 gevuld + 1/2 leeg"-bug). */
          .sticker-print-area .sticker-wrapper > span {
            display: none !important;
          }
          /* Elke direct child = 1 sticker (sticker-wrapper of reststuk-
             sticker-label). Geen extra margin/padding op print, en niet
             breken middenin een sticker. */
          .sticker-print-area > * {
            margin: 0 !important;
            padding: 0 !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          /* Page-break TUSSEN stickers, niet ná de laatste (page-break-
             after op elke sticker veroorzaakte trailing blanco-pagina). */
          .sticker-print-area > *:not(:last-child) {
            break-after: page;
            page-break-after: always;
          }
          .sticker-label {
            margin: 0;
            border: none;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
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
