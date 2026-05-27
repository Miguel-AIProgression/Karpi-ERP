// Optionele klant-facing tapijt-stickers bij het printen van vervoerderslabels.
// Per klant opt-in via `debiteuren.tapijt_sticker_bij_standaard` (mig 303);
// data uit view `zending_regel_sticker_data`.
//
// Per zending_regel `aantal × 2` stickers: één 'Sticker tapijt' (op het tapijt)
// en één 'Sticker orderdossier' (in dossier), identiek aan de maatwerk-bulk-
// pagina (`pages/snijplanning/stickers-bulk.tsx`). Layout via gedeelde
// `StickerLayout`-component — geen vertakking tussen maatwerk en standaard.
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import type { ZendingRegelStickerData } from '@/modules/logistiek/queries/zending-stickers'

interface TapijtStickersSectieProps {
  stickers: ZendingRegelStickerData[]
}

export function TapijtStickersSectie({ stickers }: TapijtStickersSectieProps) {
  if (stickers.length === 0) return null

  return (
    <div className="tapijt-stickers flex flex-col items-start gap-4">
      {stickers.flatMap((sticker) => {
        const aantal = Math.max(1, Math.trunc(Number(sticker.aantal ?? 1)))
        const out: React.ReactNode[] = []
        for (let i = 0; i < aantal; i += 1) {
          out.push(
            <StickerLayout
              key={`${sticker.zending_regel_id}-${i}-tapijt`}
              sticker={sticker}
              label={
                aantal > 1
                  ? `Sticker tapijt (${i + 1}/${aantal})`
                  : 'Sticker tapijt'
              }
            />,
            <StickerLayout
              key={`${sticker.zending_regel_id}-${i}-dossier`}
              sticker={sticker}
              label={
                aantal > 1
                  ? `Sticker orderdossier (${i + 1}/${aantal})`
                  : 'Sticker orderdossier'
              }
            />,
          )
        }
        return out
      })}
    </div>
  )
}

/** Aantal individuele stickers in een lijst — totaal aantal pages voor de
 *  print-job. Gebruikt voor de "X stickers" label op de knop. */
export function totaalAantalTapijtStickers(
  stickers: ZendingRegelStickerData[],
): number {
  return stickers.reduce(
    (sum, s) => sum + Math.max(1, Math.trunc(Number(s.aantal ?? 1))) * 2,
    0,
  )
}
