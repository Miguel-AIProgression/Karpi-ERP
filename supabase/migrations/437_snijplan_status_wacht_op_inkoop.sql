-- Migratie 437: nieuwe snijplan-status 'Wacht op inkoop'
--
-- Eerste stap van de "snijplan-tekort koppelen aan openstaande rol-inkoop"-
-- feature (plan: snijplan-tekorten-koppelen-aan-inkoop). Postgres staat
-- ALTER TYPE ... ADD VALUE niet toe in dezelfde transactie als gebruik van
-- die nieuwe waarde — daarom een eigen migratie, vóór mig 438 die de waarde
-- daadwerkelijk gebruikt.
--
-- Betekenis: een snijplan-stuk zonder fysieke rol, maar waarvoor de packer
-- (auto-plan-groep, tweede pas) heeft vastgesteld dat het past binnen een
-- openstaande inkooporder-regel voor exact die kwaliteit+kleur. `rol_id`
-- blijft NULL; `verwacht_inkooporder_regel_id` (mig 438) wijst naar de
-- inkooporder_regel in plaats van naar een echte rol.

ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'Wacht op inkoop' AFTER 'Wacht';
