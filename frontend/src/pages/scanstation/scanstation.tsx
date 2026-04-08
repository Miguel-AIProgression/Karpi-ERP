import { useState, useCallback, useRef } from 'react'
import { Camera, Package, CheckCircle2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ScanInput, type ScanFeedback } from '@/components/ui/scan-input'
import { ScannedItemCard } from '@/components/scanstation/scanned-item-card'
import { cn } from '@/lib/utils/cn'
import { SNIJPLAN_STATUS_COLORS } from '@/lib/utils/constants'
import {
  useLookupScancode,
  useLogScanEvent,
  useOpenstaandItems,
  useOpboekenItem,
} from '@/hooks/use-scanstation'
import type { ScannedItem } from '@/lib/types/productie'

const STATION = 'inpak-1'

export function ScanstationPage() {
  const [scannedItem, setScannedItem] = useState<ScannedItem | null>(null)
  const [ingepaktCount, setIngepaktCount] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>('idle')
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>()

  const lookup = useLookupScancode()
  const logEvent = useLogScanEvent()
  const { data: openstaand, isLoading: openstaandLoading } = useOpenstaandItems()
  const opboeken = useOpboekenItem()

  const flashFeedback = useCallback((type: ScanFeedback) => {
    setScanFeedback(type)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setScanFeedback('idle'), 600)
  }, [])

  const handleScan = useCallback((code: string) => {
    setScanError(null)
    lookup.mutate(code, {
      onSuccess: (item) => {
        if (!item) {
          setScanError(`Scancode "${code}" niet gevonden`)
          setScannedItem(null)
          flashFeedback('error')
          return
        }
        setScannedItem(item)
        flashFeedback('success')
        logEvent.mutate({ scancode: code, actie: 'gereed', station: STATION })
      },
      onError: () => {
        setScanError('Fout bij het opzoeken van de scancode')
        setScannedItem(null)
        flashFeedback('error')
      },
    })
  }, [lookup, logEvent, flashFeedback])

  const handleOpboeken = useCallback(() => {
    if (!scannedItem || scannedItem.type !== 'snijplan') return

    opboeken.mutate(scannedItem.id, {
      onSuccess: () => {
        logEvent.mutate({ scancode: scannedItem.scancode, actie: 'gereed', station: STATION })
        setScannedItem({ ...scannedItem, status: 'Ingepakt' })
        setIngepaktCount((c) => c + 1)
      },
    })
  }, [scannedItem, opboeken, logEvent])

  const openstaandItems = openstaand ?? []

  const handleOpboekenFromTable = useCallback((item: { id: number; scancode: string }) => {
    opboeken.mutate(item.id, {
      onSuccess: () => {
        logEvent.mutate({ scancode: item.scancode, actie: 'gereed', station: STATION })
        setIngepaktCount((c) => c + 1)
      },
    })
  }, [opboeken, logEvent])

  return (
    <>
      <PageHeader
        title="Scanstation Inpak"
        description="Scan QR-code op sticker &rarr; automatisch ingepakt & geboekt"
        actions={
          <div className="flex items-center gap-2 bg-teal-50 text-teal-700 px-4 py-2 rounded-full text-base font-semibold">
            <CheckCircle2 size={20} />
            {ingepaktCount} ingepakt
          </div>
        }
      />

      {/* Scan input — full width, prominent */}
      <div className="mb-6">
        <ScanInput
          onScan={handleScan}
          placeholder="Scan QR-code of barcode..."
          disabled={lookup.isPending}
          feedback={scanFeedback}
        />
        {scanError && (
          <p className="mt-2 text-base text-red-600 font-medium">{scanError}</p>
        )}
      </div>

      {/* 2-column layout: camera + scanned item */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Camera placeholder */}
        <div className="bg-slate-900 rounded-[var(--radius)] border border-slate-700 min-h-[280px] flex flex-col items-center justify-center text-slate-400">
          <Camera size={48} className="mb-3 opacity-50" />
          <p className="text-lg mb-4">Camera staat uit</p>
          <button className="min-h-[48px] px-6 rounded-[var(--radius)] bg-slate-700 text-slate-200 text-base font-medium hover:bg-slate-600 transition-colors">
            Start scannen
          </button>
        </div>

        {/* Scanned item details */}
        <ScannedItemCard
          item={scannedItem}
          isLoading={lookup.isPending}
          onOpboeken={handleOpboeken}
          isOpboeking={opboeken.isPending}
        />
      </div>

      {/* Openstaand table */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Package size={20} className="text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">
            Openstaand ({openstaandItems.length})
          </h2>
        </div>

        {openstaandLoading ? (
          <div className="p-12 text-center text-slate-400">
            <Loader2 size={24} className="animate-spin mx-auto mb-2" />
            Laden...
          </div>
        ) : openstaandItems.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-base">
            Geen openstaande items — alles is ingepakt!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-sm text-slate-500">
                  <th className="px-5 py-3 font-medium">Sticker</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Kleur</th>
                  <th className="px-5 py-3 font-medium">Maat</th>
                  <th className="px-5 py-3 font-medium">Klant</th>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Actie</th>
                </tr>
              </thead>
              <tbody>
                {openstaandItems.map((item) => {
                  const colors = SNIJPLAN_STATUS_COLORS[item.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
                  return (
                    <tr
                      key={`${item.type}-${item.id}`}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3 text-sm font-mono text-slate-600">{item.scancode}</td>
                      <td className="px-5 py-3 text-sm text-slate-800">{item.kwaliteit_code}</td>
                      <td className="px-5 py-3 text-sm text-slate-800">{item.kleur_code}</td>
                      <td className="px-5 py-3 text-sm text-slate-800">{item.maat} cm</td>
                      <td className="px-5 py-3 text-sm text-slate-800">{item.klant_naam}</td>
                      <td className="px-5 py-3 text-sm text-slate-800">{item.order_nr}</td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          colors.bg,
                          colors.text
                        )}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleOpboekenFromTable(item)}
                          disabled={opboeken.isPending}
                          className={cn(
                            'min-h-[44px] px-4 rounded-[var(--radius-sm)] text-sm font-semibold transition-colors',
                            'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                          )}
                        >
                          Opboeken
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
