// Spiegelt de DB-CHECK `vervoerders_type_check` (mig 424, geverifieerd
// ongewijzigd sinds — mig 170: api/edi; mig 207: +print; mig 374: +sftp;
// mig 424: +eigen): 5 waarden.
//
// De oude, onderling afwijkende `VervoerderType`-unions (audit 2026-07-02) —
// `registry.ts` miste 'print'; `queries/vervoerders.ts` miste 'sftp' en
// 'eigen' (terwijl 2 van de 3 live carriers sftp zijn!) — importeren nu
// allemaal hier.
//
// NIET hetzelfde als capabilities.ts' `protocol` ('rest'|'sftp') — dat is
// het transport-protocol van de adapter, dit is de administratieve
// vervoerders.type-kolom.
export const VERVOERDER_TYPES = ['api', 'edi', 'print', 'sftp', 'eigen'] as const
export type VervoerderType = (typeof VERVOERDER_TYPES)[number]
