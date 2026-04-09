import { useState, useMemo } from 'react'
import type { SnijStuk } from '@/lib/types/productie'
import { cn } from '@/lib/utils/cn'
import { isRondeVorm } from '@/lib/utils/vorm-labels'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnijVisualisatieProps {
  rolBreedte: number   // cm
  rolLengte: number    // cm
  stukken: SnijStuk[]
  restLengte: number   // cm
  afvalPct: number
  reststukBruikbaar: boolean
  className?: string
}

interface Tooltip {
  x: number
  y: number
  stuk: SnijStuk
}

// ---------------------------------------------------------------------------
// Color palette — 10 distinct, deterministic per order_nr
// ---------------------------------------------------------------------------

const ORDER_COLORS = [
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
] as const

function hashOrderNr(orderNr: string): number {
  let hash = 0
  for (let i = 0; i < orderNr.length; i++) {
    hash = ((hash << 5) - hash + orderNr.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function orderColor(orderNr: string): string {
  return ORDER_COLORS[hashOrderNr(orderNr) % ORDER_COLORS.length]
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PADDING = 30        // px around the roll in SVG space
const SCALE_BAR_H = 24    // height of the bottom scale bar area
const INFO_W = 130         // info overlay width
const INFO_H = 64          // info overlay height

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SnijVisualisatie({
  rolBreedte,
  rolLengte,
  stukken,
  restLengte,
  afvalPct,
  reststukBruikbaar,
  className,
}: SnijVisualisatieProps) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  // Totals
  const gebruiktM2 = useMemo(
    () =>
      stukken.reduce((sum, s) => {
        const area =
          isRondeVorm(s.vorm)
            ? Math.PI * (s.breedte_cm / 200) * (s.lengte_cm / 200)
            : (s.breedte_cm * s.lengte_cm) / 10_000
        return sum + area
      }, 0),
    [stukken],
  )

  // SVG viewBox dimensions (roll + padding + scale bar)
  const svgW = rolBreedte + PADDING * 2
  const svgH = rolLengte + PADDING * 2 + SCALE_BAR_H

  // Used length = roll length minus rest
  const gebruikteLengte = rolLengte - restLengte

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Snijplan visualisatie: ${stukken.length} stukken op rol ${rolBreedte}x${rolLengte} cm`}
      >
        {/* ---- Roll background ---- */}
        <rect
          x={PADDING}
          y={PADDING}
          width={rolBreedte}
          height={rolLengte}
          fill="#f8fafc"
          stroke="#cbd5e1"
          strokeWidth={1}
          rx={2}
        />

        {/* ---- Remnant area (dashed) ---- */}
        {restLengte > 0 && (
          <g>
            <rect
              x={PADDING}
              y={PADDING + gebruikteLengte}
              width={rolBreedte}
              height={restLengte}
              fill={reststukBruikbaar ? '#f0fdf4' : '#fafafa'}
              stroke={reststukBruikbaar ? '#86efac' : '#d1d5db'}
              strokeWidth={1}
              strokeDasharray="6 3"
            />
            <text
              x={PADDING + rolBreedte / 2}
              y={PADDING + gebruikteLengte + restLengte / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(12, restLengte * 0.4)}
              fill="#94a3b8"
              fontWeight={500}
            >
              {Math.round(restLengte)} cm rest
            </text>
          </g>
        )}

        {/* ---- Cut pieces ---- */}
        {stukken.map((stuk, i) => {
          const color = orderColor(stuk.order_nr)
          const px = PADDING + stuk.x_cm
          const py = PADDING + stuk.y_cm
          // lengte_cm = X dimension (across roll width), breedte_cm = Y dimension (along roll length)
          const w = stuk.lengte_cm   // SVG width = X extent
          const h = stuk.breedte_cm  // SVG height = Y extent
          const labelSize = Math.min(10, w * 0.08, h * 0.12)
          const showLabels = w > 30 && h > 20

          return (
            <g
              key={`${stuk.order_regel_id}-${i}`}
              onMouseEnter={(e) => {
                const svg = e.currentTarget.closest('svg')
                if (!svg) return
                const pt = svg.createSVGPoint()
                pt.x = e.clientX
                pt.y = e.clientY
                const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse())
                setTooltip({ x: svgPt.x, y: svgPt.y, stuk })
              }}
              onMouseLeave={() => setTooltip(null)}
              className="cursor-pointer"
            >
              {isRondeVorm(stuk.vorm) ? (
                <ellipse
                  cx={px + w / 2}
                  cy={py + h / 2}
                  rx={w / 2}
                  ry={h / 2}
                  fill={color}
                  fillOpacity={0.25}
                  stroke={color}
                  strokeWidth={1.5}
                />
              ) : (
                <rect
                  x={px}
                  y={py}
                  width={w}
                  height={h}
                  fill={color}
                  fillOpacity={0.25}
                  stroke="white"
                  strokeWidth={2}
                  rx={1}
                />
              )}

              {/* Colored left edge accent */}
              {!isRondeVorm(stuk.vorm) && (
                <rect
                  x={px}
                  y={py}
                  width={3}
                  height={h}
                  fill={color}
                  rx={1}
                />
              )}

              {/* Labels inside piece */}
              {showLabels && (
                <>
                  <text
                    x={px + w / 2}
                    y={py + h / 2 - labelSize * 0.4}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={labelSize}
                    fontWeight={600}
                    fill="#1e293b"
                  >
                    {w}x{h}
                  </text>
                  <text
                    x={px + w / 2}
                    y={py + h / 2 + labelSize * 0.8}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(7, labelSize * 0.75)}
                    fill="#475569"
                  >
                    {stuk.klant_naam.length > 14
                      ? stuk.klant_naam.slice(0, 12) + '...'
                      : stuk.klant_naam}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* ---- Info overlay (top-right) ---- */}
        <g>
          <rect
            x={svgW - PADDING - INFO_W - 4}
            y={PADDING + 4}
            width={INFO_W}
            height={INFO_H}
            rx={4}
            fill="white"
            fillOpacity={0.92}
            stroke="#e2e8f0"
            strokeWidth={0.5}
          />
          <text
            x={svgW - PADDING - INFO_W + 4}
            y={PADDING + 20}
            fontSize={9}
            fill="#64748b"
          >
            Gebruikt: {gebruiktM2.toFixed(1)} m²
          </text>
          <text
            x={svgW - PADDING - INFO_W + 4}
            y={PADDING + 36}
            fontSize={9}
            fill={afvalPct > 15 ? '#dc2626' : '#64748b'}
            fontWeight={afvalPct > 15 ? 600 : 400}
          >
            Afval: {afvalPct.toFixed(1)}%
          </text>
          <text
            x={svgW - PADDING - INFO_W + 4}
            y={PADDING + 52}
            fontSize={9}
            fill={reststukBruikbaar ? '#16a34a' : '#64748b'}
          >
            Rest: {(restLengte / 100).toFixed(1)} m
            {reststukBruikbaar ? ' (bruikbaar)' : ''}
          </text>
        </g>

        {/* ---- Bottom scale bar ---- */}
        <g>
          <line
            x1={PADDING}
            y1={PADDING + rolLengte + 12}
            x2={PADDING + rolBreedte}
            y2={PADDING + rolLengte + 12}
            stroke="#94a3b8"
            strokeWidth={1}
          />
          {/* End ticks */}
          <line
            x1={PADDING}
            y1={PADDING + rolLengte + 6}
            x2={PADDING}
            y2={PADDING + rolLengte + 18}
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <line
            x1={PADDING + rolBreedte}
            y1={PADDING + rolLengte + 6}
            x2={PADDING + rolBreedte}
            y2={PADDING + rolLengte + 18}
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={PADDING + rolBreedte / 2}
            y={PADDING + rolLengte + SCALE_BAR_H + 2}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {rolBreedte} cm
          </text>
        </g>

        {/* ---- Tooltip ---- */}
        {tooltip && (
          <g>
            <rect
              x={tooltip.x + 8}
              y={tooltip.y - 48}
              width={150}
              height={56}
              rx={4}
              fill="white"
              stroke="#cbd5e1"
              strokeWidth={0.5}
              filter="drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))"
            />
            <text x={tooltip.x + 14} y={tooltip.y - 34} fontSize={9} fontWeight={600} fill="#0f172a">
              {tooltip.stuk.order_nr}
            </text>
            <text x={tooltip.x + 14} y={tooltip.y - 22} fontSize={8} fill="#475569">
              {tooltip.stuk.klant_naam}
            </text>
            <text x={tooltip.x + 14} y={tooltip.y - 10} fontSize={8} fill="#475569">
              {tooltip.stuk.lengte_cm}x{tooltip.stuk.breedte_cm} cm
              {tooltip.stuk.vorm !== 'rechthoek' ? ` (${tooltip.stuk.vorm})` : ''}
            </text>
            <text x={tooltip.x + 14} y={tooltip.y + 2} fontSize={8} fill="#94a3b8">
              {tooltip.stuk.afleverdatum
                ? `Lever: ${new Date(tooltip.stuk.afleverdatum).toLocaleDateString('nl-NL')}`
                : 'Geen afleverdatum'}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
