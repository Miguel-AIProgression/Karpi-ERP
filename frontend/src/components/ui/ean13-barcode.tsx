// EAN-13 SVG-renderer.
//
// Encoding-tabel volgens GS1: 95 modules totaal — start-guard (3), 6 left
// digits (42), center-guard (5), 6 right digits (42), end-guard (3).
// De eerste van de 13 cijfers staat niet als bars maar bepaalt de
// L/G-pariteit van de 6 left digits.

const L_PATTERNS = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]

const G_PATTERNS = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]

const R_PATTERNS = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
]

// Per first-digit: L=0, G=1 voor de 6 left digits.
const FIRST_DIGIT_PATTERN: Record<string, string> = {
  '0': 'LLLLLL', '1': 'LLGLGG', '2': 'LLGGLG', '3': 'LLGGGL',
  '4': 'LGLLGG', '5': 'LGGLLG', '6': 'LGGGLL', '7': 'LGLGLG',
  '8': 'LGLGGL', '9': 'LGGLGL',
}

const START_GUARD = '101'
const CENTER_GUARD = '01010'
const END_GUARD = '101'

interface Ean13BarcodeProps {
  value: string
  height?: number
  className?: string
  style?: React.CSSProperties
  /** Toon de cijferreeks onder de bars. Default true. */
  showText?: boolean
}

function computeChecksum(twelve: string): string {
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    const d = Number(twelve[i])
    sum += i % 2 === 0 ? d : d * 3
  }
  const check = (10 - (sum % 10)) % 10
  return String(check)
}

function normaliseEan(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 13) return digits
  if (digits.length === 12) return digits + computeChecksum(digits)
  return null
}

/** Bouw de 95-bit moduleserie en return een array van zwart-bar-rechthoeken. */
function buildBars(ean: string): string {
  const firstDigit = ean[0]
  const leftPattern = FIRST_DIGIT_PATTERN[firstDigit]
  let modules = START_GUARD
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(ean[i + 1])
    const table = leftPattern[i] === 'L' ? L_PATTERNS : G_PATTERNS
    modules += table[digit]
  }
  modules += CENTER_GUARD
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(ean[i + 7])
    modules += R_PATTERNS[digit]
  }
  modules += END_GUARD
  return modules
}

export function Ean13Barcode({
  value,
  height = 60,
  className,
  style,
  showText = true,
}: Ean13BarcodeProps) {
  const ean = normaliseEan(value)
  if (!ean) {
    return (
      <div className={className} style={style ?? { height }}>
        <span className="text-[8px] text-slate-400">EAN ongeldig</span>
      </div>
    )
  }

  const modules = buildBars(ean)
  const totalModules = modules.length // 95
  // Marge links/rechts (quiet zone) — GS1-voorschrift = 9 modules. We doen 9
  // zodat de losse "eerste digit" links de quiet zone heeft die scanners
  // verwachten + voldoende ruimte voor het cijfer zelf.
  const quiet = 9
  const fullWidth = totalModules + 2 * quiet

  // Tekst-zone onderaan: ~13 modules hoog. Digit-bars stoppen daar; guard-bars
  // (start/center/end) zakken 5 modules in de tekst-zone door — leesbaarheid +
  // scanner-herkenning.
  const textZoneHeight = showText ? 13 : 0
  const digitsHeight = height - textZoneHeight
  const guardHeight = digitsHeight + (showText ? 5 : 0)
  const textY = height - 3  // baseline net boven onderrand

  const bars: Array<{ x: number; width: number; h: number }> = []
  let runLen = 0
  for (let i = 0; i < totalModules; i += 1) {
    if (modules[i] === '1') {
      runLen += 1
    } else if (runLen > 0) {
      const x = quiet + (i - runLen)
      const isGuard = isInGuardRange(i - runLen, runLen)
      bars.push({ x, width: runLen, h: isGuard ? guardHeight : digitsHeight })
      runLen = 0
    }
  }
  if (runLen > 0) {
    const x = quiet + (totalModules - runLen)
    const isGuard = isInGuardRange(totalModules - runLen, runLen)
    bars.push({ x, width: runLen, h: isGuard ? guardHeight : digitsHeight })
  }

  const firstDigit = ean[0]
  const leftGroup = ean.slice(1, 7)
  const rightGroup = ean.slice(7, 13)

  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${fullWidth} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`EAN-13 ${ean}`}
    >
      <rect width={fullWidth} height={height} fill="#fff" />
      {bars.map((bar, idx) => (
        <rect
          key={`${bar.x}-${idx}`}
          x={bar.x}
          y={0}
          width={bar.width}
          height={bar.h}
          fill="#111"
        />
      ))}
      {showText && (
        <g
          fontFamily="'Helvetica Neue', Arial, sans-serif"
          fontSize="11"
          fontWeight="500"
          fill="#111"
          textAnchor="middle"
          letterSpacing="0.5"
        >
          {/* Eerste digit: in linker quiet zone */}
          <text x={1} y={textY} textAnchor="start">{firstDigit}</text>
          {/* Linker groep: gecentreerd onder modules 3-44 */}
          <text x={quiet + 3 + 21} y={textY}>{leftGroup}</text>
          {/* Rechter groep: gecentreerd onder modules 50-91 */}
          <text x={quiet + 50 + 21} y={textY}>{rightGroup}</text>
        </g>
      )}
    </svg>
  )
}

/** Zit deze run binnen één van de drie guard-segmenten? */
function isInGuardRange(start: number, runLen: number): boolean {
  const end = start + runLen - 1
  // start-guard: modulen 0-2
  if (end <= 2) return true
  // center-guard: modulen 45-49
  if (start >= 45 && end <= 49) return true
  // end-guard: modulen 92-94
  if (start >= 92 && end <= 94) return true
  return false
}
