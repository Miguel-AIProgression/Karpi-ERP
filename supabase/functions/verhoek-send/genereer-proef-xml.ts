// Lokaal hulpscript: genereer een Verhoek-proef-XML uit een bestaande zending.
// NIET deployen — alleen `deno run` vanaf de werkplek.
//
// Gebruik:
//   deno run --allow-net --allow-env --allow-write \
//     supabase/functions/verhoek-send/genereer-proef-xml.ts ZEND-2026-0042
//
// Vereist env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { fetchZendingColli } from '../_shared/vervoerders/fetch-zending-colli.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BedrijfInput, ZendingInput } from './types.ts';

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
  .select('id, zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, opmerkingen, verzenddatum')
  .eq('zending_nr', zendingNr)
  .single();
if (zErr || !zending) { console.error(`Zending ${zendingNr} niet gevonden: ${zErr?.message}`); Deno.exit(1); }

const { data: order } = await supabase.from('orders').select('order_nr').eq('id', zending.order_id).single();
const { data: bedrijfRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
const { data: cfgRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'verhoek').single();

const { colli, error: cErr } = await fetchZendingColli(supabase, zending.id);
if (cErr) { console.error(`Colli-query faalde: ${cErr}`); Deno.exit(1); }

const problemen = valideerVerhoekColli(colli);
if (problemen.length > 0) {
  console.warn('LET OP — onvolledige colli-data (kies evt. een andere zending):');
  for (const p of problemen) console.warn(`  - ${p.melding}`);
}

const xml = bouwVerhoekXml({
  zending: zending as ZendingInput,
  order: { order_nr: order?.order_nr ?? '' },
  bedrijf: bedrijfRow!.waarde as BedrijfInput,
  opties: { ...DEFAULT_VERHOEK_OPTIES, ...(cfgRow?.waarde ?? {}) },
  colli,
});

const bestandsnaam = bouwVerhoekBestandsnaam(zending.zending_nr, new Date());
await Deno.writeTextFile(bestandsnaam, xml);
console.log(`Geschreven: ${bestandsnaam} (${colli.length} colli)`);
