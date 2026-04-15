export interface AfleverdatumInput {
  orderdatum?: Date
  heeftStandaardMaat: boolean
  heeftMaatwerk: boolean
  standaardMaatWerkdagen: number
  maatwerkWeken: number
}

export interface AfleverdatumResult {
  standaardDatum: string | null
  maatwerkDatum: string | null
  langsteDatum: string | null
  heeftGemengd: boolean
}

function plusDagen(basis: Date, dagen: number): string {
  const d = new Date(basis)
  d.setDate(d.getDate() + dagen)
  return d.toISOString().slice(0, 10)
}

export function berekenAfleverdatum(input: AfleverdatumInput): AfleverdatumResult {
  const basis = input.orderdatum ?? new Date()
  const standaardDatum = input.heeftStandaardMaat
    ? plusDagen(basis, input.standaardMaatWerkdagen)
    : null
  const maatwerkDatum = input.heeftMaatwerk
    ? plusDagen(basis, input.maatwerkWeken * 7)
    : null

  let langsteDatum: string | null = null
  if (standaardDatum && maatwerkDatum) {
    langsteDatum = standaardDatum > maatwerkDatum ? standaardDatum : maatwerkDatum
  } else {
    langsteDatum = standaardDatum ?? maatwerkDatum
  }

  return {
    standaardDatum,
    maatwerkDatum,
    langsteDatum,
    heeftGemengd: input.heeftStandaardMaat && input.heeftMaatwerk,
  }
}
