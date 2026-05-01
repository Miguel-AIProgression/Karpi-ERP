const KARPI_GS1_COMPANY_PREFIX = '8715954'

export function gs1CheckDigit(digitsWithoutCheck: string): string {
  let sum = 0
  let multiplyByThree = true

  for (let i = digitsWithoutCheck.length - 1; i >= 0; i -= 1) {
    const digit = Number(digitsWithoutCheck[i])
    sum += digit * (multiplyByThree ? 3 : 1)
    multiplyByThree = !multiplyByThree
  }

  return String((10 - (sum % 10)) % 10)
}

export function generateSscc(zendingId: number, colliIndex: number): string {
  const serial = `${zendingId}${colliIndex}`.replace(/\D/g, '').padStart(9, '0').slice(-9)
  const base = `0${KARPI_GS1_COMPANY_PREFIX}${serial}`
  return `${base}${gs1CheckDigit(base)}`
}
