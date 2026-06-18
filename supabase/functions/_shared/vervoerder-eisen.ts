// Gedeelde pre-flight validator: kent de adres-/contact-eisen van de logistieke
// partijen vóór verzending. Sinds ADR-0034 leest deze de eisen declaratief uit
// de capability-registry (`vervoerders/capabilities.ts`) i.p.v. per-carrier
// `if`-takken te dragen — één plek voegt een vervoerder toe. Puur — geen
// DB/secrets — zodat zowel de edge functions (laatste poort) als de frontend
// (waarschuwingsvlag, via re-export-shim frontend/src/lib/orders/
// vervoerder-eisen.ts, ADR-0033) dezelfde uitkomst gebruiken.

import { capabilityVoor } from './vervoerders/capabilities.ts';
import { landNaarIso2Strikt } from './adres-split.ts';

export interface VerzendContext {
  vervoerder_code: string;
  afl_land: string | null;
  afl_telefoon: string | null;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
}

export interface VerzendProbleem {
  code: 'TELEFOON_ONTBREEKT' | 'ADRESVELD_LEEG' | 'ADRES_ONSPLITSBAAR' | 'LAND_BUITEN_BEREIK';
  veld: string;
  melding: string;
}

export interface VerzendValidatie {
  ok: boolean;
  problemen: VerzendProbleem[];
}

// HST bedient in V1 alleen NL. Bron-van-waarheid is nu de capability-registry;
// deze export blijft als alias voor bestaande consumers/tests.
export const HST_LANDEN_BEREIK = capabilityVoor('hst_api')?.landbereik ?? ['NL'];

function leeg(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

function telefoonGeldig(tel: string | null | undefined): boolean {
  if (leeg(tel)) return false;
  const cijfers = (tel as string).replace(/\D/g, '');
  return cijfers.length >= 10 && cijfers.length <= 15;
}

export function valideerVoorVervoerder(ctx: VerzendContext): VerzendValidatie {
  const problemen: VerzendProbleem[] = [];
  const cap = capabilityVoor(ctx.vervoerder_code);

  // Onbekende vervoerder → geen capability-profiel → geen pre-flight (ok).
  if (!cap) {
    return { ok: true, problemen };
  }

  const { preflight, landbereik } = cap;

  // Volgorde (telefoon → adres → land) bewaard t.o.v. de oude `if`-takken:
  // consumers/tests lezen `problemen[0]`.
  if (preflight.vereistTelefoon && !telefoonGeldig(ctx.afl_telefoon)) {
    problemen.push({
      code: 'TELEFOON_ONTBREEKT',
      veld: 'afl_telefoon',
      melding: 'Telefoonnummer (10–15 cijfers) ontbreekt — HST belt vóór aflevering.',
    });
  }

  if (
    preflight.vereistAdresvelden &&
    (leeg(ctx.afl_naam) || leeg(ctx.afl_adres) || leeg(ctx.afl_postcode) || leeg(ctx.afl_plaats))
  ) {
    problemen.push({
      code: 'ADRESVELD_LEEG',
      veld: 'afl_adres',
      melding: 'Naam, adres, postcode of plaats is leeg.',
    });
  }

  if (preflight.vereistLandInBereik) {
    // Normaliseer naar ISO-2 (`'BELGIË'`/`'Nederland'` → `'BE'`/`'NL'`) zodat de
    // bereik-check ook vrije-tekst-landen dekt — `afl_land` is een vrij TEXT-veld
    // en staat in de praktijk zowel als 'BE' als 'BELGIË' (en 'NL'/'NEDERLAND').
    // landbereik bevat ISO-2-codes. Onbekend land → null → buiten bereik.
    const iso2 = landNaarIso2Strikt(ctx.afl_land);
    if (!iso2 || !(landbereik ?? []).includes(iso2)) {
      problemen.push({
        code: 'LAND_BUITEN_BEREIK',
        veld: 'afl_land',
        melding: `HST bedient ${(ctx.afl_land ?? '').trim() || '(leeg)'} niet — kies handmatig een vervoerder.`,
      });
    }
  }

  return { ok: problemen.length === 0, problemen };
}
