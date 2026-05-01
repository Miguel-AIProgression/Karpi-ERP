import type { ReactNode } from 'react'

// SVG-omtrekken per vorm-code. Gebruikt currentColor zodat parent
// component (VormTegel) de kleur via tekstkleur kan instellen.
// 8 vormen: rechthoek, rond, ovaal, organisch_a, organisch_b_sp, pebble,
// ellips, afgeronde_hoeken. Cloud niet — geen maatwerk-vorm in dit plan.
export const VORM_ICONS: Record<string, ReactNode> = {
  rechthoek: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><rect x="10" y="10" width="60" height="40" fill="currentColor" rx="2"/></svg>
  ),
  rond: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><circle cx="40" cy="30" r="22" fill="currentColor"/></svg>
  ),
  ovaal: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><ellipse cx="40" cy="30" rx="30" ry="18" fill="currentColor"/></svg>
  ),
  organisch_a: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M15 20 Q5 35 20 50 Q40 60 60 50 Q75 35 65 20 Q55 5 35 8 Q20 12 15 20 Z" fill="currentColor"/></svg>
  ),
  organisch_b_sp: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M65 20 Q75 35 60 50 Q40 60 20 50 Q5 35 15 20 Q25 5 45 8 Q60 12 65 20 Z" fill="currentColor"/></svg>
  ),
  pebble: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M20 15 Q5 30 15 48 Q35 58 60 48 Q72 38 65 22 Q50 8 30 12 Q22 13 20 15 Z" fill="currentColor"/></svg>
  ),
  ellips: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><ellipse cx="40" cy="30" rx="32" ry="14" fill="currentColor"/></svg>
  ),
  afgeronde_hoeken: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><rect x="10" y="10" width="60" height="40" rx="14" fill="currentColor"/></svg>
  ),
}
