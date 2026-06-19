import { describe, it, expect } from 'vitest'
import { buildCbsExportTsv } from '../lib/cbs-export-tsv'
import type { CbsExportRij } from '../queries/cbs-export'

const RIJ: CbsExportRij = {
  factuur_regel_id: 1,
  factuur_id: 1,
  factuur_nr: 'FACT-2026-0001',
  factuurdatum: '2026-06-10',
  partner_id: 'DE153337780',
  land_bestemming: 'DE',
  land_oorsprong: 'NL',
  transactie: '11',
  vervoerswijze: '3',
  leveringsvoorwaarden: '',
  goederencode: '57024200',
  netto_gewicht_kg: 16,
  bijzondere_maatstaf: 0,
  factuurwaarde: 37,
  factuurvaluta: 'EUR',
  eigen_administratienummer: 'FACT-2026-0001',
}

describe('buildCbsExportTsv', () => {
  it('header matcht de Basta-export 1-op-1 (13 kolommen + trailing leeg)', () => {
    const { tekst } = buildCbsExportTsv({ rijen: [], vanDatum: '2026-06-01', totDatum: '2026-06-30' })
    const header = tekst.split('\r\n')[0]
    expect(header).toBe(
      'Partner ID\tLand van herkomst/bestemming\tLand van oorsprong\tTransactie\t' +
        'Vervoerswijze\tLeveringsvoorwaarden\tGoederencode\tNetto gewicht\t' +
        'Bijzondere maatstaf\tFactuurwaarde\tFactuurvaluta\t' +
        'Factuurwaarde vreemde valuta\tEigen administratienummer\t',
    )
  })

  it('numerieke velden 10-cijferig zero-padded, CRLF-regeleinde', () => {
    const { tekst } = buildCbsExportTsv({ rijen: [RIJ], vanDatum: '2026-06-01', totDatum: '2026-06-30' })
    const regels = tekst.split('\r\n')
    expect(regels[1]).toBe(
      'DE153337780\tDE\tNL\t11\t3\t\t57024200\t0000000016\t0000000000\t0000000037\tEUR\t\tFACT-2026-0001\t',
    )
    expect(tekst.endsWith('\r\n')).toBe(true)
  })

  it('ontbrekende goederencode → lege kolom (rij niet uitgesloten)', () => {
    const { tekst } = buildCbsExportTsv({
      rijen: [{ ...RIJ, goederencode: null }],
      vanDatum: '2026-06-01',
      totDatum: '2026-06-30',
    })
    const kolommen = tekst.split('\r\n')[1].split('\t')
    expect(kolommen[6]).toBe('') // Goederencode-kolom
  })

  it('bestandsnaam volgt CBS_INTRASTAT_VAN_..._TOT_....txt', () => {
    const { bestandsnaam } = buildCbsExportTsv({ rijen: [], vanDatum: '2026-06-01', totDatum: '2026-06-30' })
    expect(bestandsnaam).toBe('CBS_INTRASTAT_VAN_20260601_TOT_20260630.txt')
  })
})
