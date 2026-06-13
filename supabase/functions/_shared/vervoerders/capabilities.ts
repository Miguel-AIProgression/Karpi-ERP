// Vervoerder-capability-registry (ADR-0034): één pure descriptor per vervoerder
// die de DECLARATIEVE capability-as draagt — landbereik, preflight-eisen,
// default-afmetingen, protocoltak, batch-limiet. De keuze-as (welke vervoerder
// een zending krijgt) blijft data-driven via `vervoerder_selectie_regels`
// (ADR-0008/0030); deze registry beschrijft wat een vervoerder EIST en KAN.
//
// PUUR — geen DB, geen secrets — zodat de frontend hem via de re-export-shim
// deelt (ADR-0033). De `vervoerders`-tabel (mig 170) blijft de administratieve
// bron (actief/display_naam/FK); deze registry draagt het gedrag.
//
// Vierde vervoerder toevoegen = één rij hier + één format-adapter (+ routering
// als data). Géén sweep meer over preflight/defaults/colli-validatie.

export type ColliVeld = 'sscc' | 'lengte_cm' | 'breedte_cm' | 'gewicht_kg';

export interface DefaultAfmetingen {
  lengteCm: number;
  breedteCm: number;
  hoogteCm: number;
  gewichtKg: number;
}

export interface VerzendCapability {
  /** Carrier-code = PK in `vervoerders` + FK in `vervoerder_selectie_regels`. */
  code: string;
  /** Hoe de adapter aflevert. Vervangt het mislabelde `vervoerders.type`
   *  ('api'/'edi') — Verhoek/Rhenus zijn SFTP, geen EDI. */
  protocol: 'rest' | 'sftp';
  /** ISO-2 landen die de vervoerder bedient; `null` = onbegrensd (routering /
   *  selectie-regels bepalen het bereik, geen harde preflight-land-check). */
  landbereik: string[] | null;
  preflight: {
    /** HST belt vóór aflevering → telefoon (10–15 cijfers) verplicht. */
    vereistTelefoon: boolean;
    /** Harde land-check tegen `landbereik` in de preflight (HST). SFTP-
     *  vervoerders: false — de routering dekt het bereik al. */
    vereistLandInBereik: boolean;
    /** Naam/adres/postcode/plaats — komen op label/vrachtbrief. Alle carriers. */
    vereistAdresvelden: boolean;
    /** ≥1 colli verplicht (Rhenus: mapping eist een item-segment, incident
     *  0455395). HST heeft een aggregate-fallback en eist dit niet. */
    vereistColli: boolean;
    /** Per-colli velden die > 0 / niet-leeg moeten zijn vóór verzending. */
    colliVelden: ColliVeld[];
  };
  /** Afmetingen die de adapter mag invullen als de colli ze niet draagt.
   *  `null` = géén default toegestaan → ontbrekende dims falen de preflight
   *  i.p.v. verzonnen te worden (Verhoek/Rhenus). */
  defaultAfmetingen: DefaultAfmetingen | null;
  /** Max. transportorders per orchestrator-run (anti-timeout). */
  maxPerRun: number;
}

// HST — REST/JSON, bedient NL, belt vóór aflevering, mag pallet-default-
// afmetingen invullen (tapijtrollen zonder gemeten maat). Geen colli-preflight:
// de payload-builder valt terug op één aggregate-regel als er geen colli's zijn.
const HST: VerzendCapability = {
  code: 'hst_api',
  protocol: 'rest',
  landbereik: ['NL'],
  preflight: {
    vereistTelefoon: true,
    vereistLandInBereik: true,
    vereistAdresvelden: true,
    vereistColli: false,
    colliVelden: [],
  },
  defaultAfmetingen: { lengteCm: 120, breedteCm: 80, hoogteCm: 20, gewichtKg: 1 },
  maxPerRun: 25,
};

// Verhoek — AA2.0-XML via SFTP. Routering bepaalt het bereik (geen land-check);
// telefoon niet verplicht. Per colli verplicht: sscc + lengte + breedte +
// gewicht (Verhoek-planning eist afmetingen). Géén default-afmetingen.
const VERHOEK: VerzendCapability = {
  code: 'verhoek_sftp',
  protocol: 'sftp',
  landbereik: null,
  preflight: {
    vereistTelefoon: false,
    vereistLandInBereik: false,
    vereistAdresvelden: true,
    vereistColli: false,
    colliVelden: ['sscc', 'lengte_cm', 'breedte_cm', 'gewicht_kg'],
  },
  defaultAfmetingen: null,
  maxPerRun: 25,
};

// Rhenus — GS1-XML via SFTP. Als Verhoek, maar breedte NIET verplicht (legacy
// geeft rollen geen width) én ≥1 colli verplicht (mapping eist een item-segment,
// incident 0455395).
const RHENUS: VerzendCapability = {
  code: 'rhenus_sftp',
  protocol: 'sftp',
  landbereik: null,
  preflight: {
    vereistTelefoon: false,
    vereistLandInBereik: false,
    vereistAdresvelden: true,
    vereistColli: true,
    colliVelden: ['sscc', 'gewicht_kg', 'lengte_cm'],
  },
  defaultAfmetingen: null,
  maxPerRun: 25,
};

export const VERZEND_CAPABILITIES: Record<string, VerzendCapability> = {
  [HST.code]: HST,
  [VERHOEK.code]: VERHOEK,
  [RHENUS.code]: RHENUS,
};

/** Descriptor voor een carrier-code, of `null` als de vervoerder geen
 *  capability-profiel heeft (→ geen preflight, alles toegestaan). */
export function capabilityVoor(code: string): VerzendCapability | null {
  return VERZEND_CAPABILITIES[code] ?? null;
}
