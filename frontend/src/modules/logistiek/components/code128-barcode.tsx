const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

interface Code128BarcodeProps {
  value: string
  height?: number
  className?: string
}

function encodeCode128C(value: string): number[] {
  const digits = value.replace(/\D/g, '')
  const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`
  const codes = [105, 102]

  for (let i = 0; i < evenDigits.length; i += 2) {
    codes.push(Number(evenDigits.slice(i, i + 2)))
  }

  const checksum = codes.reduce((sum, code, index) => {
    if (index === 0) return code
    return sum + code * index
  }, 0) % 103

  return [...codes, checksum, 106]
}

export function Code128Barcode({ value, height = 54, className }: Code128BarcodeProps) {
  const codes = encodeCode128C(value)
  let x = 0
  const bars: Array<{ x: number; width: number }> = []

  for (const code of codes) {
    const pattern = CODE_128_PATTERNS[code]
    if (!pattern) continue

    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i])
      if (i % 2 === 0) bars.push({ x, width })
      x += width
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${x} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect width={x} height={height} fill="#fff" />
      {bars.map((bar, index) => (
        <rect key={`${bar.x}-${index}`} x={bar.x} y={0} width={bar.width} height={height} fill="#111" />
      ))}
    </svg>
  )
}
