-- RPC bouw_order_voorstel (T004 update)
-- Uitbreiding van T003: IO-claim-simulatie + lever_modus_vraag.
--
-- Nieuw:
--  - uitwisselbaar_keuzes: handmatige keuzes voor uitwisselbare producten
--  - IO-simulatie: zoekt openstaande inkooporder_regels als voorraad tekort schiet
--  - lever_modus_vraag: true als debiteur deelleveringen heeft EN er tekort is
--
-- GEEN echte claims worden aangemaakt — puur simulatie.
--
-- Input p_concept jsonb:
-- {
--   "debiteur_nr": 12345,
--   "uitwisselbaar_keuzes": [           -- optioneel, [] als leeg
--     {"regel_id": "r1", "artikelnr": "ALT_PRODUCT", "aantal": 2}
--   ],
--   "regels": [{
--     "regel_id": "r1",
--     "artikelnr": "FREZ50-200X140",
--     "aantal": 5,
--     "lengte_cm": 200,
--     "breedte_cm": 140
--   }]
-- }
--
-- Output jsonb:
-- {
--   "lever_modus_vraag": boolean,
--   "claim_summary": { totaal, voorraad, op_inkoop, uitwisselbaar, wacht },
--   "regels": [{
--     "regel_id", "artikelnr", "gevraagd",
--     "beschikbaar_voorraad", "op_inkoop", "wacht", "uitwisselbaar",
--     "status", "eerste_io_datum"
--   }]
-- }

create or replace function bouw_order_voorstel(p_concept jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_debiteur_nr          integer;
  v_deelleveringen       boolean;
  v_regels               jsonb;
  v_uitwisselbaar_keuzes jsonb;
  v_regel                jsonb;
  v_regel_id             text;
  v_artikelnr            text;
  v_gevraagd             integer;

  -- Per-regel allocatie variabelen
  v_handmatig_geclaimd   integer;
  v_resterend            integer;
  v_voorraad_beschikbaar integer;
  v_uit_voorraad         integer;
  v_op_inkoop            integer;
  v_wacht                integer;
  v_uitwisselbaar        integer;
  v_status               text;
  v_eerste_io_datum      date;

  -- IO-simulatie
  v_io_rec               record;
  v_io_ruimte            integer;

  -- Uitvoer aggregaten
  v_uitvoer_regels       jsonb := '[]'::jsonb;
  v_totaal               integer := 0;
  v_voorraad_count       integer := 0;
  v_op_inkoop_count      integer := 0;
  v_uitwisselbaar_count  integer := 0;
  v_wacht_count          integer := 0;

  -- lever_modus logica
  v_heeft_tekort         boolean := false;
  v_lever_modus_vraag    boolean := false;
begin
  -- Lege input snel afhandelen
  v_regels := p_concept -> 'regels';
  if v_regels is null or jsonb_array_length(v_regels) = 0 then
    return jsonb_build_object(
      'lever_modus_vraag', false,
      'claim_summary', jsonb_build_object(
        'totaal',        0,
        'voorraad',      0,
        'op_inkoop',     0,
        'uitwisselbaar', 0,
        'wacht',         0
      ),
      'regels', '[]'::jsonb
    );
  end if;

  -- Debiteur ophalen voor lever_modus_vraag
  v_debiteur_nr := (p_concept ->> 'debiteur_nr')::integer;
  if v_debiteur_nr is not null then
    select deelleveringen_toegestaan
    into   v_deelleveringen
    from   debiteuren
    where  debiteur_nr = v_debiteur_nr;
  end if;
  v_deelleveringen := coalesce(v_deelleveringen, false);

  -- Uitwisselbaar_keuzes ophalen (kan null / leeg zijn)
  v_uitwisselbaar_keuzes := coalesce(p_concept -> 'uitwisselbaar_keuzes', '[]'::jsonb);

  -- Per-regel allocatie
  for v_regel in select * from jsonb_array_elements(v_regels)
  loop
    v_regel_id   := v_regel ->> 'regel_id';
    v_artikelnr  := v_regel ->> 'artikelnr';
    v_gevraagd   := (v_regel ->> 'aantal')::integer;

    -- Handmatig geclaimd via uitwisselbaar_keuzes voor deze regel
    select coalesce(sum((keuze ->> 'aantal')::integer), 0)
    into   v_handmatig_geclaimd
    from   jsonb_array_elements(v_uitwisselbaar_keuzes) as keuze
    where  keuze ->> 'regel_id' = v_regel_id;

    v_uitwisselbaar := v_handmatig_geclaimd;

    -- Resterend na handmatige uitwisselbaar-claims
    v_resterend := greatest(v_gevraagd - v_handmatig_geclaimd, 0);

    -- Stap 1: vrije voorraad eigen artikel
    select coalesce(voorraad_beschikbaar_voor_artikel(v_artikelnr, null), 0)
    into   v_voorraad_beschikbaar;

    v_uit_voorraad := least(v_voorraad_beschikbaar, v_resterend);
    v_resterend    := v_resterend - v_uit_voorraad;

    -- Stap 2: simuleer IO-dekking als er nog tekort is
    v_op_inkoop       := 0;
    v_eerste_io_datum := null;

    if v_resterend > 0 then
      for v_io_rec in
        select ir.id as io_regel_id,
               io.verwacht_datum
        from   inkooporder_regels ir
        join   inkooporders       io on io.id = ir.inkooporder_id
        where  ir.artikelnr = v_artikelnr
          and  ir.eenheid   = 'stuks'
          and  io.status    in ('Besteld', 'Deels ontvangen')
        order by io.verwacht_datum nulls last, ir.id asc
      loop
        if v_resterend <= 0 then
          exit;
        end if;

        -- Vrije ruimte op deze IO-regel (minus al bestaande claims)
        select coalesce(io_regel_ruimte(v_io_rec.io_regel_id), 0)
        into   v_io_ruimte;

        if v_io_ruimte > 0 then
          declare
            v_te_claimen integer;
          begin
            v_te_claimen := least(v_io_ruimte, v_resterend);
            v_op_inkoop  := v_op_inkoop + v_te_claimen;
            v_resterend  := v_resterend - v_te_claimen;

            -- Bewaar datum van eerste IO die bijdraagt
            if v_eerste_io_datum is null then
              v_eerste_io_datum := v_io_rec.verwacht_datum;
            end if;
          end;
        end if;
      end loop;
    end if;

    -- Wat na voorraad + IO overblijft → wacht op nieuwe inkoop
    v_wacht := v_resterend;

    -- Status bepalen
    if v_wacht > 0 then
      v_status := 'wacht_op_nieuwe_inkoop';
      v_heeft_tekort := true;
    elsif v_op_inkoop > 0 then
      v_status := 'op_inkoop';
      v_heeft_tekort := true;
    else
      v_status := 'voorraad';
    end if;

    -- Tellers bijhouden (per regel, niet per stuk)
    v_totaal := v_totaal + 1;
    case v_status
      when 'voorraad'              then v_voorraad_count  := v_voorraad_count  + 1;
      when 'op_inkoop'             then v_op_inkoop_count := v_op_inkoop_count + 1;
      when 'wacht_op_nieuwe_inkoop' then v_wacht_count    := v_wacht_count     + 1;
    end case;
    if v_uitwisselbaar > 0 then
      v_uitwisselbaar_count := v_uitwisselbaar_count + 1;
    end if;

    -- Regel toevoegen aan uitvoer
    v_uitvoer_regels := v_uitvoer_regels || jsonb_build_object(
      'regel_id',             v_regel_id,
      'artikelnr',            v_artikelnr,
      'gevraagd',             v_gevraagd,
      'beschikbaar_voorraad', v_voorraad_beschikbaar,
      'op_inkoop',            v_op_inkoop,
      'wacht',                v_wacht,
      'uitwisselbaar',        v_uitwisselbaar,
      'status',               v_status,
      'eerste_io_datum',      v_eerste_io_datum
    );
  end loop;

  -- lever_modus_vraag: true als er tekort is EN debiteur staat deelleveringen toe
  v_lever_modus_vraag := v_heeft_tekort and v_deelleveringen;

  return jsonb_build_object(
    'lever_modus_vraag', v_lever_modus_vraag,
    'claim_summary', jsonb_build_object(
      'totaal',        v_totaal,
      'voorraad',      v_voorraad_count,
      'op_inkoop',     v_op_inkoop_count,
      'uitwisselbaar', v_uitwisselbaar_count,
      'wacht',         v_wacht_count
    ),
    'regels', v_uitvoer_regels
  );
end;
$$;

comment on function bouw_order_voorstel(jsonb) is
  'Simuleert order-allocatie (T004: IO-simulatie + lever_modus_vraag). Geen echte claims. '
  'Retourneert scenario per regel inclusief op_inkoop, wacht, uitwisselbaar en eerste_io_datum.';
