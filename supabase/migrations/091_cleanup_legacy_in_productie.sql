-- Migration 091: cleanup legacy status 'In productie' naar 'Gepland'.
--
-- Na migratie 089 bestaan alleen 'Gepland' (gepland, aanpasbaar) en
-- 'Snijden' (fysiek gestart). 'In productie' was een pre-harmonisatie
-- status die bleef hangen op rollen waar ooit `start_productie_rol` was
-- aangeroepen (via de legacy auto-planning flow). Die stukken zijn nu
-- dood: hun rol heeft status 'in_snijplan' maar `snijden_gestart_op IS
-- NULL`, dus ze zouden semantisch 'Gepland' moeten zijn.
--
-- Fix: converteer alle 'In productie' -> 'Gepland'. Als de bijbehorende rol
-- toch nog een snijden_gestart_op had (onwaarschijnlijk maar mogelijk in
-- oudere data), blijft die ongemoeid — de stukken krijgen dan 'Gepland'
-- en start_snijden_rol promoveert ze weer naar 'Snijden' bij de volgende
-- echte start.

UPDATE snijplannen
SET status = 'Gepland'
WHERE status = 'In productie';
