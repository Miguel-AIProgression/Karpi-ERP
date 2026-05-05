-- RPC bouw_order_voorstel
-- Simuleert allocatie voor een concept-order ZONDER echte claims aan te maken.
-- Gebruikt voorraad_beschikbaar_voor_artikel() per regel om beschikbaarheid te
-- bepalen. In T003: voorraad-only check (geen IO-lookup, geen lever_modus).
--
-- Input p_concept jsonb:
-- {
--   debiteur_nr: integer,
--   regels: [{
--     regel_id: text,
--     artikelnr: text,
--     aantal: integer,
--     lengte_cm: integer | null,
--     breedte_cm: integer | null
--   }]
-- }
--
-- Output jsonb:
-- {
--   lever_modus_vraag: boolean,
--   claim_summary: { totaal, voorraad, op_inkoop, wacht },
--   regels: [{ regel_id, artikelnr, gevraagd, beschikbaar_voorraad, status }]
-- }

create or replace function bouw_order_voorstel(p_concept jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_regels          jsonb;
  v_regel           jsonb;
  v_regel_id        text;
  v_artikelnr       text;
  v_gevraagd        integer;
  v_beschikbaar     numeric;
  v_status          text;
  v_uitvoer_regels  jsonb := '[]'::jsonb;
  v_totaal          integer := 0;
  v_voorraad_count  integer := 0;
  v_op_inkoop_count integer := 0;
  v_wacht_count     integer := 0;
begin
  v_regels := p_concept -> 'regels';

  if v_regels is null or jsonb_array_length(v_regels) = 0 then
    return jsonb_build_object(
      'lever_modus_vraag', false,
      'claim_summary', jsonb_build_object(
        'totaal', 0,
        'voorraad', 0,
        'op_inkoop', 0,
        'wacht', 0
      ),
      'regels', '[]'::jsonb
    );
  end if;

  for v_regel in select * from jsonb_array_elements(v_regels)
  loop
    v_regel_id   := v_regel ->> 'regel_id';
    v_artikelnr  := v_regel ->> 'artikelnr';
    v_gevraagd   := (v_regel ->> 'aantal')::integer;

    -- Vrije voorraad voor dit artikel (excl. geen bestaande orderregel)
    select voorraad_beschikbaar_voor_artikel(v_artikelnr, null)
    into v_beschikbaar;

    v_beschikbaar := coalesce(v_beschikbaar, 0);

    if v_beschikbaar >= v_gevraagd then
      v_status := 'voorraad';
      v_voorraad_count := v_voorraad_count + 1;
    else
      v_status := 'wacht_op_nieuwe_inkoop';
      v_wacht_count := v_wacht_count + 1;
    end if;

    v_totaal := v_totaal + 1;

    v_uitvoer_regels := v_uitvoer_regels || jsonb_build_object(
      'regel_id',             v_regel_id,
      'artikelnr',            v_artikelnr,
      'gevraagd',             v_gevraagd,
      'beschikbaar_voorraad', v_beschikbaar,
      'status',               v_status
    );
  end loop;

  return jsonb_build_object(
    'lever_modus_vraag', false,
    'claim_summary', jsonb_build_object(
      'totaal',     v_totaal,
      'voorraad',   v_voorraad_count,
      'op_inkoop',  v_op_inkoop_count,
      'wacht',      v_wacht_count
    ),
    'regels', v_uitvoer_regels
  );
end;
$$;

comment on function bouw_order_voorstel(jsonb) is
  'Simuleert order-allocatie (voorraad-only in T003). Geen echte claims. Retourneert scenario per regel.';
