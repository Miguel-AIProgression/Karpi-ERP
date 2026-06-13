// Lokaal hulpscript: genereer een Rhenus-proef-XML uit een bestaande zending.
// NIET deployen — alleen `deno run` vanaf de werkplek. Handig om vóór de
// rondreis dims/gewicht-gaten in onze data te zien en het bestand visueel te
// diffen tegen docs/rhenus/voorbeelden/RHE260521001-excerpt.xml.
//
// Gebruik:
//   deno run --allow-net --allow-env --allow-write \
//     supabase/functions/rhenus-send/genereer-proef-xml.ts ZEND-2026-0042
//
// Vereist env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bouwRhenusBestandsnaam, bouwRhenusXml, valideerRhenusColli } from './xml-builder.ts';
import { DEFAULT_RHENUS_OPTIES } from './types.ts';
import type { BedrijfInput, RhenusColliInput, ZendingInput } from './types.ts';

const zendingNr = Deno.args[0];
if (!zendingNr) {
  console.error('Gebruik: deno run ... genereer-proef-xml.ts <ZEND-nummer>');
  Deno.exit(1);
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const { data: zending, error: zErr } = await supabase
  .from('zendingen')
  .select('id, zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, verzenddatum')
  .eq('zending_nr', zendingNr)
  .single();
if (zErr || !zending) { console.error(`Zending ${zendingNr} niet gevonden: ${zErr?.message}`); Deno.exit(1); }

const { data: order } = await supabase.from('orders').select('order_nr, klant_referentie').eq('id', zending.order_id).single();
const { data: bedrijfRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
const { data: cfgRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'rhenus').single();

const { data: colliRows, error: cErr } = await supabase
  .from('zending_colli')
  .select('colli_nr, sscc, gewicht_kg, order_regels:order_regel_id ( maatwerk_lengte_cm, maatwerk_breedte_cm, producten:order_regels_artikelnr_fkey ( lengte_cm, breedte_cm ) )')
  .eq('zending_id', zending.id)
  .order('colli_nr', { ascending: true });
if (cErr) { console.error(`Colli-query faalde: ${cErr.message}`); Deno.exit(1); }

// deno-lint-ignore no-explicit-any
const colli: RhenusColliInput[] = (colliRows ?? []).map((r: any) => ({
  colli_nr: r.colli_nr,
  sscc: r.sscc,
  gewicht_kg: r.gewicht_kg,
  lengte_cm: r.order_regels?.maatwerk_lengte_cm ?? r.order_regels?.producten?.lengte_cm ?? null,
  breedte_cm: r.order_regels?.maatwerk_breedte_cm ?? r.order_regels?.producten?.breedte_cm ?? null,
}));

const problemen = valideerRhenusColli(colli);
if (problemen.length > 0) {
  console.warn('LET OP — onvolledige colli-data (kies evt. een andere zending):');
  for (const p of problemen) console.warn(`  - ${p.melding}`);
  if (colli.length === 0) Deno.exit(1); // 0 colli: builder gooit toch (incident 0455395)
}

const opties = { ...DEFAULT_RHENUS_OPTIES, ...(cfgRow?.waarde ?? {}) };
const xml = bouwRhenusXml({
  zending: zending as ZendingInput,
  order: { order_nr: order?.order_nr ?? '', klant_referentie: order?.klant_referentie ?? null },
  bedrijf: bedrijfRow!.waarde as BedrijfInput,
  opties,
  colli,
  nu: new Date(),
});

const bestandsnaam = bouwRhenusBestandsnaam(opties.bestandsnaam_prefix, zending.zending_nr, new Date());
await Deno.writeTextFile(bestandsnaam, xml);
console.log(`Geschreven: ${bestandsnaam} (${colli.length} colli)`);
