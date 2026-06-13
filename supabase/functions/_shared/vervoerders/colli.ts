// Gedeelde colli-preflight (ADR-0034): welke per-colli velden verplicht zijn en
// of een lege zending is toegestaan, leest deze generieke validator uit de
// capability-descriptor (`colliVelden` + `vereistColli`). De carrier levert
// alleen de MELDINGSTEKST aan — die is bewust vervoerder-specifiek (Verhoek-
// planning vs. Rhenus-incident 0455395). Eén iteratie-structuur i.p.v. twee
// bijna-identieke `valideerXColli`-functies.
//
// Puur — geen DB/secrets. Faalt een eis → de orchestrator zet de rij op Fout
// mét deze meldingen, zónder upload (kansloze-poging-principe ADR-0030).

import type { ColliVeld, VerzendCapability } from './capabilities.ts';

export interface ColliInput {
  colli_nr: number;
  sscc: string | null;
  gewicht_kg: number | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
}

export interface ColliProbleem {
  colli_nr: number;
  veld: ColliVeld | 'aantal';
  melding: string;
}

export interface ColliMeldingen {
  /** Melding bij een zending zonder colli (alleen relevant als
   *  `preflight.vereistColli`). */
  geenColli: string;
  /** Per verplicht veld een meldingsbouwer (krijgt het colli-nummer). */
  perVeld: Record<ColliVeld, (colliNr: number) => string>;
}

function veldOntbreekt(c: ColliInput, veld: ColliVeld): boolean {
  if (veld === 'sscc') return !c.sscc || c.sscc.trim() === '';
  const waarde = c[veld];
  return !waarde || waarde <= 0;
}

export function valideerColli(
  colli: ColliInput[],
  cap: VerzendCapability,
  meldingen: ColliMeldingen,
): ColliProbleem[] {
  if (cap.preflight.vereistColli && colli.length === 0) {
    return [{ colli_nr: 0, veld: 'aantal', melding: meldingen.geenColli }];
  }
  const problemen: ColliProbleem[] = [];
  for (const c of colli) {
    for (const veld of cap.preflight.colliVelden) {
      if (veldOntbreekt(c, veld)) {
        problemen.push({ colli_nr: c.colli_nr, veld, melding: meldingen.perVeld[veld](c.colli_nr) });
      }
    }
  }
  return problemen;
}
